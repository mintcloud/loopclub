import { createPublicClient, http, webSocket } from 'viem'
import { megaethMainnet, config } from './config'

// HTTP client — reads, multicall snapshots, receipts, block-number polling.
export const publicClient = createPublicClient({
  chain: megaethMainnet,
  transport: http(config.rpcUrl),
})

// Event client — used for the live CellRented subscription. When VITE_WS_RPC_URL
// is set this is a true WebSocket push (eth_subscribe); otherwise it reuses the
// HTTP client, and watchContractEvent degrades to a tight getLogs poll.
export const eventClient = config.wsRpcUrl
  ? createPublicClient({ chain: megaethMainnet, transport: webSocket(config.wsRpcUrl) })
  : publicClient

export const usingWebSocket = Boolean(config.wsRpcUrl)
