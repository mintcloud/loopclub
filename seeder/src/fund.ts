// loopclub seeder funder — a one-shot top-up that refills the seeder's USDm
// from the rent the Loopclub contract has already collected.
//
// The bot (src/index.ts) holds a custodial wallet that pays rent on every
// toggle(). Left alone it bleeds USDm and eventually can't jam. Meanwhile the
// contract accumulates the *unattributed* slice of every rent/sale (rounding
// dust + the rent paid into toggle(), which is never auto-routed). The owner
// can pull that slice out with `sweepUnattributed(to, amount)`. This script is
// the loop that closes: read the seeder balance, and when it dips below a low
// watermark, sweep just enough contract USDm into it to reach the target.
//
// It is a SEPARATE process from the bot and signs with the OWNER key (the only
// key allowed to sweep) — never the seeder key. Run it on a systemd timer (see
// deploy/loopclub-funder.timer) so the seeder "never runs out of USDm".
//
// Safety: the contract's USDm balance is NOT all sweepable — pending secondary
// royalties (depositRoyalty minus claimRoyalty) are earmarked for holders and
// must stay put. We track that reserve by replaying RoyaltyDeposited /
// RoyaltyClaimed events incrementally (cached in a state file) and never sweep
// into it, plus an extra configurable buffer.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  formatUnits,
  getAddress,
  isHex,
} from 'viem'
import type { Address, Hex, PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { usdmAbi } from './abi.js'

// Same deterministic CREATE2 Multicall3 every EVM chain ships with.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

// Loopclub was deployed at this block on MegaETH mainnet (docs/deployments.md).
// We never need to scan royalty events before it existed.
const DEFAULT_DEPLOY_BLOCK = 17_164_882n

// The slice of the Loopclub ABI the funder touches: owner() to sanity-check the
// signing key, sweepUnattributed() to pull rent, and the two royalty events we
// replay to size the untouchable reserve.
const loopclubFunderAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'sweepUnattributed',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'RoyaltyDeposited',
    inputs: [
      { name: 'seriesId', type: 'uint256', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoyaltyClaimed',
    inputs: [
      { name: 'seriesId', type: 'uint256', indexed: true },
      { name: 'holder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const

// ───────────────────────── Config ─────────────────────────

interface FunderConfig {
  ownerKey: Hex
  seederAddress: Address
  rpcUrl: string
  chainId: number
  loopclubAddress: Address
  paymentTokenAddress: Address

  /** Top up only when the seeder USDm balance is below this (USDm wei). */
  lowWatermark: bigint
  /** Sweep enough to bring the seeder up to this balance (USDm wei). */
  target: bigint
  /** Never send a tx for less than this — not worth the gas (USDm wei). */
  minSweep: bigint
  /** Always leave at least this much sweepable USDm in the contract (USDm wei). */
  reserveBuffer: bigint

  /** First block to scan for royalty events (contract deploy block). */
  deployBlock: bigint
  /** getLogs window size — keep under the RPC's range cap. */
  logChunk: bigint
  /** Where to cache the royalty-scan cursor + running totals. */
  statePath: string
  /** Log the decision but send no tx. */
  dryRun: boolean
}

function required(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) throw new Error(`Missing required env var ${name}`)
  return v.trim()
}

// Parse a whole-or-decimal USDm amount from env into 18-dec wei, without a
// float round-trip (so "0.5" and "1000000" are both exact).
function usdmEnv(name: string, dfltWholeUsdm: string): bigint {
  const raw = (process.env[name]?.trim() || dfltWholeUsdm)
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`env ${name} must be a non-negative USDm amount, got "${raw}"`)
  }
  const [whole = '0', frac = ''] = raw.split('.')
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18)
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded || '0')
}

function num(name: string, dflt: number): number {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return dflt
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got "${v}"`)
  return n
}

function bool(name: string, dflt: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') return dflt
  return v.trim().toLowerCase() === 'true'
}

function ownerKey(): Hex {
  const raw = required('OWNER_PRIVATE_KEY')
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
  if (!isHex(key) || key.length !== 66) {
    throw new Error('OWNER_PRIVATE_KEY must be a 32-byte hex string (0x + 64 chars)')
  }
  return key
}

function loadConfig(): FunderConfig {
  return {
    ownerKey: ownerKey(),
    seederAddress: getAddress(required('SEEDER_ADDRESS')),
    rpcUrl: process.env.RPC_URL?.trim() || 'https://mainnet.megaeth.com/rpc',
    chainId: num('CHAIN_ID', 4326),
    loopclubAddress: getAddress(
      process.env.LOOPCLUB_ADDRESS?.trim() || '0x1030D1a60e248E280294d1b04394f706904E3631',
    ),
    paymentTokenAddress: getAddress(
      process.env.PAYMENT_TOKEN_ADDRESS?.trim() || '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7',
    ),

    lowWatermark: usdmEnv('FUND_LOW_USDM', '10'),
    target: usdmEnv('FUND_TARGET_USDM', '50'),
    minSweep: usdmEnv('FUND_MIN_SWEEP_USDM', '1'),
    reserveBuffer: usdmEnv('FUND_RESERVE_BUFFER_USDM', '0'),

    deployBlock: BigInt(process.env.FUND_DEPLOY_BLOCK?.trim() || DEFAULT_DEPLOY_BLOCK.toString()),
    logChunk: BigInt(num('FUND_LOG_CHUNK', 45_000)),
    statePath:
      process.env.FUND_STATE_PATH?.trim() || `${homedir()}/.config/loopclub/funder-state.json`,
    dryRun: bool('DRY_RUN', false),
  }
}

// ───────────────────────── Royalty reserve (incremental) ─────────────────────────

interface FunderState {
  /** Last block whose royalty events are folded into the totals below. */
  lastScannedBlock: string
  royaltyDepositedTotal: string
  royaltyClaimedTotal: string
}

function readState(path: string, deployBlock: bigint): FunderState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FunderState>
    return {
      lastScannedBlock: parsed.lastScannedBlock ?? (deployBlock - 1n).toString(),
      royaltyDepositedTotal: parsed.royaltyDepositedTotal ?? '0',
      royaltyClaimedTotal: parsed.royaltyClaimedTotal ?? '0',
    }
  } catch {
    // No state yet → start the scan at the deploy block, totals zero.
    return {
      lastScannedBlock: (deployBlock - 1n).toString(),
      royaltyDepositedTotal: '0',
      royaltyClaimedTotal: '0',
    }
  }
}

function writeState(path: string, state: FunderState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
}

// Replay RoyaltyDeposited / RoyaltyClaimed from the cached cursor to `latest`,
// chunked under the RPC range cap, and return the updated state. The
// outstanding (unclaimed) royalty is depositedTotal - claimedTotal — USDm that
// belongs to holders and must never be swept.
async function refreshRoyaltyReserve(
  client: PublicClient,
  cfg: FunderConfig,
  state: FunderState,
  latest: bigint,
): Promise<FunderState> {
  let deposited = BigInt(state.royaltyDepositedTotal)
  let claimed = BigInt(state.royaltyClaimedTotal)
  let from = BigInt(state.lastScannedBlock) + 1n

  if (from < cfg.deployBlock) from = cfg.deployBlock

  while (from <= latest) {
    const to = from + cfg.logChunk - 1n > latest ? latest : from + cfg.logChunk - 1n

    const depositLogs = await client.getLogs({
      address: cfg.loopclubAddress,
      event: loopclubFunderAbi[2], // RoyaltyDeposited
      fromBlock: from,
      toBlock: to,
    })
    for (const log of depositLogs) deposited += (log.args as { amount?: bigint }).amount ?? 0n

    const claimLogs = await client.getLogs({
      address: cfg.loopclubAddress,
      event: loopclubFunderAbi[3], // RoyaltyClaimed
      fromBlock: from,
      toBlock: to,
    })
    for (const log of claimLogs) claimed += (log.args as { amount?: bigint }).amount ?? 0n

    from = to + 1n
  }

  return {
    lastScannedBlock: latest.toString(),
    royaltyDepositedTotal: deposited.toString(),
    royaltyClaimedTotal: claimed.toString(),
  }
}

// ───────────────────────── Main ─────────────────────────

const fmt = (wei: bigint) => `${formatUnits(wei, 18)} USDm`

async function main(): Promise<void> {
  const cfg = loadConfig()
  const account = privateKeyToAccount(cfg.ownerKey)

  const chain = defineChain({
    id: cfg.chainId,
    name: 'MegaETH Mainnet',
    nativeCurrency: { name: 'MegaETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    contracts: { multicall3: { address: MULTICALL3 } },
    testnet: false,
  })

  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) }) as PublicClient
  const walletClient = createWalletClient({ chain, account, transport: http(cfg.rpcUrl) })

  // 0) The signer MUST be the contract owner — only it can sweep. Fail loud and
  //    early rather than letting the sweep revert with an opaque message.
  const onchainOwner = await publicClient.readContract({
    address: cfg.loopclubAddress,
    abi: loopclubFunderAbi,
    functionName: 'owner',
  })
  if (getAddress(onchainOwner) !== getAddress(account.address)) {
    throw new Error(
      `OWNER_PRIVATE_KEY is ${account.address} but the contract owner is ${onchainOwner} — ` +
        `only the owner can sweepUnattributed. Wrong key.`,
    )
  }

  // 1) Does the seeder even need topping up?
  const seederBalance = (await publicClient.readContract({
    address: cfg.paymentTokenAddress,
    abi: usdmAbi,
    functionName: 'balanceOf',
    args: [cfg.seederAddress],
  })) as bigint

  console.log(`[funder] seeder ${cfg.seederAddress} balance: ${fmt(seederBalance)}`)
  console.log(`[funder] low watermark: ${fmt(cfg.lowWatermark)}, target: ${fmt(cfg.target)}`)

  if (seederBalance >= cfg.lowWatermark) {
    console.log(`[funder] above watermark — nothing to do.`)
    return
  }

  // 2) How much USDm is actually sweepable from the contract right now?
  const latest = await publicClient.getBlockNumber()
  const prevState = readState(cfg.statePath, cfg.deployBlock)
  const state = await refreshRoyaltyReserve(publicClient, cfg, prevState, latest)
  writeState(cfg.statePath, state)

  const outstandingRoyalty =
    BigInt(state.royaltyDepositedTotal) - BigInt(state.royaltyClaimedTotal)
  const reserve = (outstandingRoyalty > 0n ? outstandingRoyalty : 0n) + cfg.reserveBuffer

  const contractBalance = (await publicClient.readContract({
    address: cfg.paymentTokenAddress,
    abi: usdmAbi,
    functionName: 'balanceOf',
    args: [cfg.loopclubAddress],
  })) as bigint

  const sweepable = contractBalance > reserve ? contractBalance - reserve : 0n
  console.log(
    `[funder] contract balance: ${fmt(contractBalance)}, ` +
      `royalty reserve: ${fmt(outstandingRoyalty > 0n ? outstandingRoyalty : 0n)}` +
      (cfg.reserveBuffer > 0n ? ` + buffer ${fmt(cfg.reserveBuffer)}` : '') +
      `, sweepable: ${fmt(sweepable)}`,
  )

  // 3) Size the sweep: enough to hit target, capped by what's safely sweepable.
  const need = cfg.target - seederBalance
  let amount = need < sweepable ? need : sweepable

  if (amount <= 0n) {
    console.log(`[funder] nothing safely sweepable — contract is dry. Skipping.`)
    return
  }
  if (amount < cfg.minSweep) {
    console.log(
      `[funder] sweepable ${fmt(amount)} below min ${fmt(cfg.minSweep)} — not worth gas. Skipping.`,
    )
    return
  }

  console.log(`[funder] → sweepUnattributed(${cfg.seederAddress}, ${fmt(amount)})`)
  if (cfg.dryRun) {
    console.log(`[funder] DRY_RUN — no tx sent.`)
    return
  }

  const hash = await walletClient.writeContract({
    address: cfg.loopclubAddress,
    abi: loopclubFunderAbi,
    functionName: 'sweepUnattributed',
    args: [cfg.seederAddress, amount],
    account,
    chain,
  })
  console.log(`[funder] tx sent: ${hash} — waiting for receipt…`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`sweep tx ${hash} reverted`)
  }

  const after = (await publicClient.readContract({
    address: cfg.paymentTokenAddress,
    abi: usdmAbi,
    functionName: 'balanceOf',
    args: [cfg.seederAddress],
  })) as bigint
  console.log(`[funder] done. seeder balance now ${fmt(after)} (block ${receipt.blockNumber}).`)
}

main().catch((err) => {
  console.error(`[funder] FATAL:`, err instanceof Error ? err.message : err)
  process.exit(1)
})
