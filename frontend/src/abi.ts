export const loopchainAbi = [
  { type: 'function', name: 'currentLoop', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'livePattern', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'livePitches', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  {
    type: 'function',
    name: 'cellOwner',
    stateMutability: 'view',
    inputs: [{ type: 'uint8' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'cellExpiryLoop',
    stateMutability: 'view',
    inputs: [{ type: 'uint8' }],
    outputs: [{ type: 'uint64' }],
  },
  { type: 'function', name: 'rentPerLoop', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'mintPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'maxRentDurationLoops',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'toggle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'cellId', type: 'uint8' },
      { name: 'durationLoops', type: 'uint16' },
      { name: 'pitchIdx', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'record',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const usdmAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const
