// The subset of the Loopclub + USDm ABIs the seeder touches. Mirrors
// frontend/src/abi.ts exactly for the functions/events used here — the seeder
// reads the live grid (cellOwner / cellExpiryLoop / currentLoop), prices rent
// (rentPerLoop), rents (toggle), and approves USDm (approve / allowance).

export const loopclubAbi = [
  { type: 'function', name: 'currentLoop', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
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
  {
    type: 'function',
    name: 'maxRentDurationLoops',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
  {
    // cellData is the 16-bit synth word; for synth cells (id >= 128) v1 stores
    // bits 0-6 (MIDI note 0-127). Ignored for drum cells.
    type: 'function',
    name: 'toggle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'cellId', type: 'uint8' },
      { name: 'durationLoops', type: 'uint16' },
      { name: 'cellData', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'CellRented',
    inputs: [
      { name: 'cellId', type: 'uint8', indexed: true },
      { name: 'renter', type: 'address', indexed: true },
      { name: 'expiryLoop', type: 'uint64', indexed: false },
      { name: 'cellData', type: 'uint16', indexed: false },
    ],
    anonymous: false,
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
