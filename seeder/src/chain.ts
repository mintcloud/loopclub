// viem clients for the seeder. One public client for reads/multicall/events,
// one wallet client carrying the custodial key for toggle()/approve().
//
// Mirrors frontend/src/viemClient.ts: HTTP public client for snapshots and
// receipts, an optional WebSocket "event client" for the CellRented push.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  webSocket,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { SeederConfig } from './config.js'

// Same deterministic CREATE2 Multicall3 address as every other EVM chain — lets
// us snapshot all 144 cells in two batched round-trips.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export function megaethChain(cfg: SeederConfig) {
  return defineChain({
    id: cfg.chainId,
    name: 'MegaETH Mainnet',
    nativeCurrency: { name: 'MegaETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    contracts: { multicall3: { address: MULTICALL3 } },
    testnet: false,
  })
}

export interface Clients {
  chain: ReturnType<typeof megaethChain>
  publicClient: PublicClient
  /** WebSocket push client when WS_RPC_URL is set; else the HTTP client. */
  eventClient: PublicClient
  walletClient: WalletClient
  account: Address
}

export function makeClients(cfg: SeederConfig): Clients {
  const chain = megaethChain(cfg)
  const account = privateKeyToAccount(cfg.privateKey)

  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) }) as PublicClient
  const eventClient = (
    cfg.wsRpcUrl
      ? createPublicClient({ chain, transport: webSocket(cfg.wsRpcUrl) })
      : publicClient
  ) as PublicClient

  const walletClient = createWalletClient({ chain, account, transport: http(cfg.rpcUrl) })

  return { chain, publicClient, eventClient, walletClient, account: account.address }
}
