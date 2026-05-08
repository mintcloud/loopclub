import { createPublicClient, http } from 'viem'
import { megaethMainnet, config } from './config'

export const publicClient = createPublicClient({
  chain: megaethMainnet,
  transport: http(config.rpcUrl),
})
