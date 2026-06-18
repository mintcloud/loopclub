// Per-owner identity colours. Each address hashes to a stable hue so a
// contributor keeps the same colour everywhere in the UI for a session.

import { config } from './config'

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function sameAddr(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

// The cold-start seeder bot. Its rented cells show as "robodj" instead of a raw
// 0x… address so a cold visitor sees a named house DJ keeping the grid alive,
// not an anonymous wallet. Address comes from config.botAddress (see config.ts).
export const BOT_NAME = 'robodj'

export function isBot(addr: string | null | undefined): boolean {
  return sameAddr(addr, config.botAddress)
}

// Human-readable label for a renter address: "robodj" for the seeder bot,
// otherwise the truncated 0x… form.
export function labelFor(addr: string): string {
  return isBot(addr) ? BOT_NAME : shortAddr(addr)
}

// FNV-1a hash of the lowercased address → hue in [0, 360).
export function hueForAddress(addr: string): number {
  let h = 0x811c9dc5
  const s = addr.toLowerCase()
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h % 360) + 360) % 360
}

// A bright, readable fill colour for another player's cell / chip.
export function ownerColor(addr: string): string {
  return `hsl(${hueForAddress(addr)} 72% 62%)`
}
