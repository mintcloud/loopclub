// ───── Step 4 · Session keys ("fast mode") ─────
//
// A session key is an ephemeral keypair generated in the browser. The user
// authorises it ONCE with their Privy embedded wallet; after that, every cell
// toggle is signed locally by the session key — no Privy iframe round-trip, no
// popup machinery — and submitted straight to the ZeroDev bundler.
//
// What this does NOT do: it does not replace Privy. Privy still owns login and
// the embedded wallet (the root signer). It does not change the smart-wallet
// address — see the address guard below. record()/press()/claimRoyalty() still
// go through the Privy client; only toggle() takes the fast path.
//
// Safety model:
//   • Privy stays the root of trust. The session key is a *scoped, expiring*
//     delegate, authorised by one signature from the Privy embedded wallet.
//   • On-chain scope: a ZeroDev call policy pins the session key to exactly
//     loopclub.toggle() on exactly the loopclub contract. It cannot move
//     USDm, press, claim royalties, or touch any other contract.
//   • Time scope: a timestamp policy expires the key after SESSION_KEY_TTL_MS.
//   • Address guard: the ZeroDev Kernel account we build here is only used if
//     its counterfactual address byte-matches the live Privy smart wallet. A
//     mismatch (e.g. Privy on a different Kernel version) disables fast mode
//     and falls back to the Privy client — it can NEVER route funds to a
//     different account.
//
// The whole feature is gated by config.enableSessionKeys + config.zerodevRpcUrl.

import { createKernelAccount, createKernelAccountClient } from '@zerodev/sdk'
import { createZeroDevPaymasterClient } from '@zerodev/sdk'
import {
  KERNEL_V3_0,
  KERNEL_V3_1,
  KERNEL_V3_2,
  KERNEL_V3_3,
  getEntryPoint,
} from '@zerodev/sdk/constants'
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator'
import {
  deserializePermissionAccount,
  serializePermissionAccount,
  toPermissionValidator,
} from '@zerodev/permissions'
import { toECDSASigner } from '@zerodev/permissions/signers'
import { CallPolicyVersion, toCallPolicy, toTimestampPolicy } from '@zerodev/permissions/policies'
import {
  http,
  toFunctionSelector,
  type Account,
  type Chain,
  type Hex,
  type Transport,
  type WalletClient,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { config, megaethMainnet, SESSION_KEY_STORAGE, SESSION_KEY_TTL_MS } from './config'
import { publicClient } from './viemClient'

// EntryPoint 0.7 — what Privy's Kernel smart wallets run on.
const ENTRY_POINT = getEntryPoint('0.7')

// Counterfactual account index. Privy's smart wallet uses index 0; so do we, so
// the addresses derive identically.
const ACCOUNT_INDEX = 0n

// Privy doesn't expose which Kernel version it provisions. We probe these in
// order and keep whichever one reproduces the live Privy smart-wallet address.
const KERNEL_CANDIDATES = [KERNEL_V3_1, KERNEL_V3_3, KERNEL_V3_2, KERNEL_V3_0] as const
type KernelVersion = (typeof KERNEL_CANDIDATES)[number]

// The only function the session key may call, on the only contract it may call.
const TOGGLE_SELECTOR = toFunctionSelector('function toggle(uint8,uint16,uint16)')

export class SessionKeyAddressMismatch extends Error {
  constructor(
    public readonly privyAddress: string,
    public readonly kernelAddress: string,
  ) {
    super(
      `Session-key kernel address ${kernelAddress} does not match the Privy ` +
        `smart wallet ${privyAddress}. Fast mode disabled — toggles fall back ` +
        `to the Privy signing path. (Privy is likely on a Kernel version this ` +
        `build doesn't probe; widen KERNEL_CANDIDATES.)`,
    )
    this.name = 'SessionKeyAddressMismatch'
  }
}

// A live, armed session: a ZeroDev Kernel client whose UserOps are signed by
// the in-browser session key.
export type SessionContext = {
  client: Awaited<ReturnType<typeof buildKernelClient>>
  smartAddress: Hex
  expiresAt: number
}

// True when the feature is wired enough to attempt arming.
export function sessionKeysConfigured(): boolean {
  return config.enableSessionKeys && Boolean(config.zerodevRpcUrl)
}

const addrEq = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

// The Privy embedded wallet, as a viem WalletClient with a guaranteed account —
// the shape ZeroDev's ECDSA validator accepts as a root signer.
type OwnerSigner = WalletClient<Transport, Chain | undefined, Account>

// ───── localStorage persistence ─────
// We store the serialized permission account (which embeds the session private
// key) so a returning user inside the TTL window is armed again with zero
// signatures. The key is bounded by the on-chain call + timestamp policies, so
// the localStorage exposure is small and self-limiting.

type StoredSession = {
  approval: string
  expiresAt: number
  smartAddress: string
  kernelVersion: string
  chainId: number
}

export function peekStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY_STORAGE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed.approval || !parsed.expiresAt || !parsed.smartAddress) return null
    return parsed
  } catch {
    return null
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY_STORAGE)
  } catch {
    // localStorage unavailable — nothing to clear
  }
}

function writeStoredSession(s: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY_STORAGE, JSON.stringify(s))
  } catch {
    // localStorage unavailable (private mode / quota) — session still works
    // for this page lifetime, it just won't survive a reload.
  }
}

// ───── Kernel client construction ─────

function requireZerodevRpc(): string {
  if (!config.zerodevRpcUrl) {
    throw new Error('VITE_ZERODEV_RPC_URL is not set — cannot arm fast mode')
  }
  return config.zerodevRpcUrl
}

// Wrap a built Kernel account in a client that bundles + sponsors UserOps via
// ZeroDev. Same bundler/paymaster the Privy wallet uses, so gas stays sponsored
// — Step 4 only swaps the *signing* layer, not the paymaster.
async function buildKernelClient(account: Awaited<ReturnType<typeof createKernelAccount>>) {
  const rpc = requireZerodevRpc()
  const paymaster = createZeroDevPaymasterClient({
    chain: megaethMainnet,
    transport: http(rpc),
  })
  return createKernelAccountClient({
    account,
    chain: megaethMainnet,
    bundlerTransport: http(rpc),
    client: publicClient,
    paymaster,
  })
}

// ───── Address detection ─────
// Build a sudo-only Kernel account for each candidate version and return the
// one whose address matches the live Privy smart wallet. The "regular"
// (session-key) validator never affects the counterfactual address, so probing
// sudo-only is sufficient and cheap.

type KernelMatch = {
  kernelVersion: KernelVersion
  sudoValidator: Awaited<ReturnType<typeof signerToEcdsaValidator>>
}

async function detectKernelVersion(
  ownerSigner: OwnerSigner,
  expectedAddress: Hex,
): Promise<KernelMatch | null> {
  for (const kernelVersion of KERNEL_CANDIDATES) {
    try {
      const sudoValidator = await signerToEcdsaValidator(publicClient, {
        signer: ownerSigner,
        entryPoint: ENTRY_POINT,
        kernelVersion,
      })
      const probe = await createKernelAccount(publicClient, {
        plugins: { sudo: sudoValidator },
        entryPoint: ENTRY_POINT,
        kernelVersion,
        index: ACCOUNT_INDEX,
      })
      if (addrEq(probe.address, expectedAddress)) {
        console.info('[sessionKey] kernel address matches ✓', {
          kernelVersion,
          address: probe.address,
        })
        return { kernelVersion, sudoValidator }
      }
      console.debug('[sessionKey] probe miss', { kernelVersion, probed: probe.address })
    } catch (e) {
      console.warn('[sessionKey] probe failed for', kernelVersion, e)
    }
  }
  return null
}

// ───── Arm ─────
// One Privy signature. Generates a fresh session key, scopes it, has the Privy
// embedded wallet sign the permission-enable data, persists it, and returns a
// ready-to-use Kernel client.

export async function armSession(opts: {
  ownerWalletClient: OwnerSigner
  expectedSmartAddress: Hex
}): Promise<SessionContext> {
  const { ownerWalletClient, expectedSmartAddress } = opts

  const match = await detectKernelVersion(ownerWalletClient, expectedSmartAddress)
  if (!match) {
    // We couldn't reproduce the Privy address with any probed Kernel version.
    // Refuse to arm — never sign with an account that isn't the user's.
    throw new SessionKeyAddressMismatch(expectedSmartAddress, '(no candidate matched)')
  }
  const { kernelVersion, sudoValidator } = match

  // Fresh ephemeral keypair — lives only in this browser, only in localStorage.
  const sessionPrivateKey = generatePrivateKey()
  const sessionSigner = await toECDSASigner({
    signer: privateKeyToAccount(sessionPrivateKey),
  })

  const expiresAt = Date.now() + SESSION_KEY_TTL_MS

  // Scope: toggle() on the loopclub contract only, valid until expiry.
  const permissionValidator = await toPermissionValidator(publicClient, {
    signer: sessionSigner,
    entryPoint: ENTRY_POINT,
    kernelVersion,
    policies: [
      toCallPolicy({
        policyVersion: CallPolicyVersion.V0_0_4,
        permissions: [{ target: config.loopclubAddress, selector: TOGGLE_SELECTOR }],
      }),
      toTimestampPolicy({ validUntil: Math.floor(expiresAt / 1000) }),
    ],
  })

  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator, regular: permissionValidator },
    entryPoint: ENTRY_POINT,
    kernelVersion,
    index: ACCOUNT_INDEX,
  })

  // Belt-and-braces: the full account (sudo + regular) must still resolve to
  // the Privy address. The regular validator shouldn't move it, but verify.
  if (!addrEq(account.address, expectedSmartAddress)) {
    throw new SessionKeyAddressMismatch(expectedSmartAddress, account.address)
  }

  // This is the ONE signature: the Privy embedded wallet signs the
  // permission-enable data. The serialized blob embeds the session key.
  const approval = await serializePermissionAccount(account, sessionPrivateKey)

  writeStoredSession({
    approval,
    expiresAt,
    smartAddress: account.address,
    kernelVersion,
    chainId: config.chainId,
  })

  return {
    client: await buildKernelClient(account),
    smartAddress: account.address as Hex,
    expiresAt,
  }
}

// ───── Restore ─────
// Returning-user path: rebuild the armed session from localStorage with NO
// signature. Returns null (and clears the slot) if the stored session is
// expired, for a different wallet/chain, or otherwise unusable.

export async function restoreSession(expectedSmartAddress: Hex): Promise<SessionContext | null> {
  const stored = peekStoredSession()
  if (!stored) return null

  const stale =
    stored.chainId !== config.chainId ||
    !addrEq(stored.smartAddress, expectedSmartAddress) ||
    // Drop sessions within 30s of expiry — not worth a half-second of life.
    stored.expiresAt <= Date.now() + 30_000

  if (stale) {
    clearStoredSession()
    return null
  }

  try {
    const account = await deserializePermissionAccount(
      publicClient,
      ENTRY_POINT,
      stored.kernelVersion as KernelVersion,
      stored.approval,
    )
    if (!addrEq(account.address, expectedSmartAddress)) {
      clearStoredSession()
      return null
    }
    return {
      client: await buildKernelClient(account),
      smartAddress: account.address as Hex,
      expiresAt: stored.expiresAt,
    }
  } catch (e) {
    console.warn('[sessionKey] restore failed — clearing stored session', e)
    clearStoredSession()
    return null
  }
}

// Send a single call (a toggle) through the session-key Kernel client. Returns
// the transaction hash, same shape as the Privy client's sendTransaction.
export async function sendViaSession(
  ctx: SessionContext,
  call: { to: Hex; data: Hex },
): Promise<Hex> {
  return ctx.client.sendTransaction({
    to: call.to,
    data: call.data,
    value: 0n,
  })
}
