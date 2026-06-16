#!/usr/bin/env python3
"""Generate the raster texture assets for the loopclub design system.

The chrome surfaces were pure CSS vector gradients — perfectly even, which is
exactly what reads as machine-made. These textures get layered over the
gradients (background-blend-mode) so every chrome surface picks up the uneven,
photographic quality of the wordmark's liquid mercury.

Pure stdlib (zlib PNG writer) — no PIL/numpy. Deterministic seeds, so the
assets are reproducible: `python3 scripts/gen-textures.py` from design-system/.

Outputs into assets/textures/ (all 8-bit grayscale, tileable):
  liquid-metal.png       512px  mercury reflection bands — blend over chrome fills
  liquid-metal-soft.png  512px  same bands at ~40% amplitude — phone-size chrome
  brushed-metal.png      512px  horizontal brushed streaks — the grid faceplate
  brushed-metal-soft.png 512px  same streaks at ~40% amplitude — phone faceplate
  grain.png              160px  film grain — full-stage overlay at ~5% opacity
"""

import math
import os
import random
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'textures')


def write_png_gray(path, size, pixels):
    """pixels: flat list of ints 0-255, row-major, size×size."""
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0)  # 8-bit grayscale
    raw = b''.join(
        b'\x00' + bytes(pixels[y * size:(y + 1) * size]) for y in range(size)
    )
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))
    print(f'  wrote {os.path.relpath(path)} ({size}x{size})')


def make_lattice(nx, ny, seed):
    rnd = random.Random(seed)
    return [[rnd.random() for _ in range(nx)] for _ in range(ny)]


def smoothstep(t):
    return t * t * (3.0 - 2.0 * t)


def value_noise(u, v, lat):
    """Tileable bilinear value noise; u, v in [0,1)."""
    ny, nx = len(lat), len(lat[0])
    fx, fy = u * nx, v * ny
    x0, y0 = int(fx) % nx, int(fy) % ny
    x1, y1 = (x0 + 1) % nx, (y0 + 1) % ny
    tx, ty = smoothstep(fx % 1.0), smoothstep(fy % 1.0)
    a = lat[y0][x0] * (1 - tx) + lat[y0][x1] * tx
    b = lat[y1][x0] * (1 - tx) + lat[y1][x1] * tx
    return a * (1 - ty) + b * ty


def fbm(u, v, lattices):
    total, amp_sum = 0.0, 0.0
    amp = 1.0
    for lat in lattices:
        total += value_noise(u, v, lat) * amp
        amp_sum += amp
        amp *= 0.5
    return total / amp_sum


def liquid_metal(size=512, seed=909, amplitude=150, name='liquid-metal.png'):
    """Mercury reflection: smooth blobs run through a banding curve, so the
    contour lines become alternating light/dark reflection streaks — the same
    visual grammar as the wordmark's letterforms.

    amplitude sets the swing around mid-gray (mid-gray is the soft-light
    identity, so amplitude is effectively the strength of the effect). The
    soft variant keeps the same bands but bites ~40% as hard — on phone-size
    buttons the full-strength troughs land under the label ink and eat it."""
    lattices = [make_lattice(n, n, seed + i) for i, n in enumerate((2, 4, 8))]
    px = []
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            n = fbm(u, v, lattices)
            # More band repetitions + a vertical phase drift so the streaks
            # agree with the top-lit 180deg chrome gradients they sit over.
            band = 0.5 + 0.5 * math.sin((n * 9.0 + v * 0.9) * math.tau)
            m = band ** 1.3
            # specular kick where a band peaks — the hard glint chrome has
            spec = max(0.0, band - 0.94) / 0.06
            m = min(1.0, m + spec * 0.55)
            px.append(max(0, min(255, int(128 + (m - 0.5) * amplitude))))
    write_png_gray(os.path.join(OUT_DIR, name), size, px)


def brushed_metal(size=512, seed=303, amplitude=110, name='brushed-metal.png'):
    """Anisotropic streaks — slow variation along x, fast across y, reads as
    horizontally brushed graphite for the deck faceplate.

    amplitude sets the swing around mid-gray (the soft-light identity), so it is
    the strength of the brushing. The soft variant keeps the same streaks at
    ~40% so the faceplate frames the LED window on phone-size viewports without
    the troughs going contrasty enough to fight the cells."""
    lattices = [
        make_lattice(4, 96, seed),
        make_lattice(8, 192, seed + 1),
        make_lattice(2, 384, seed + 2),
    ]
    px = []
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            n = fbm(u, v, lattices)
            px.append(max(0, min(255, int(128 + (n - 0.5) * amplitude))))
    write_png_gray(os.path.join(OUT_DIR, name), size, px)


def grain(size=160, seed=707):
    rnd = random.Random(seed)
    px = [rnd.randint(0, 255) for _ in range(size * size)]
    write_png_gray(os.path.join(OUT_DIR, 'grain.png'), size, px)


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    liquid_metal()
    liquid_metal(amplitude=60, name='liquid-metal-soft.png')
    brushed_metal()
    brushed_metal(amplitude=44, name='brushed-metal-soft.png')
    grain()
