import { createPublicClient, http } from 'viem'
import { megaethTestnet, config } from './config'

export const publicClient = createPublicClient({
  chain: megaethTestnet,
  transport: http(config.rpcUrl),
})
