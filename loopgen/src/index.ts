// loopclub-loopgen — the shared musical brain.
//
//   LoopSpec  ⇄  Wire { pattern, synthData }  ⇄  deep-link
//   (human IR)      (on-chain wire format)        (transport)
//
// Pure TS, zero runtime deps. Consumed by the MCP server, the frontend
// (decode + previewCells + Basic Pitch), and the seeder bot.

export * from './constants.js'
export * from './types.js'
export * from './pitch.js'
export * from './codec.js'
export * from './link.js'
export * from './ascii.js'
export * from './music.js'
export * from './basicpitch.js'
