// Per-owner identity colours. Each address hashes to a stable hue so a
// contributor keeps the same colour everywhere in the UI for a session.

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function sameAddr(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
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
