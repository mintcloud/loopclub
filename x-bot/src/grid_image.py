"""
Render a loopclub grid (as returned by the loopclub MCP `describe_loop` /
`build_loop` tools) into a branded PNG for X posts.

No browser dependency — works entirely from the asciiGrid + instruments JSON
the MCP tool already returns. Colors match design-system/tokens/colors.css.

Usage:
    python3 grid_image.py --json loop.json --out out.png --title "open verse 001"
"""

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = "#020205"
PANEL = "#0d0d1a"
BORDER = "#2a2a44"
TEXT = "#e6e6f0"
MUTED = "#8888a0"

TRACK_COLORS = {
    "kick": "#ff5c7c",
    "snare": "#ffaf5c",
    "clap": "#ff8a5c",
    "hat": "#5cffc6",
    "open-hat": "#5cffaf",
    "cowbell": "#b98cff",
    "crash": "#ff5cd6",
    "ride": "#5c9fff",
    "synth": "#5cb6ff",
}

TRACK_ORDER = ["kick", "snare", "clap", "hat", "open-hat", "cowbell", "crash", "ride", "synth"]

FONT_CANDIDATES = [
    "/home/theo/.local/share/fonts/GeistMono[wght].ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]
FONT_CANDIDATES_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def _font(size: int, bold: bool = False):
    candidates = FONT_CANDIDATES if bold else FONT_CANDIDATES_REGULAR + FONT_CANDIDATES
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def parse_ascii_grid(ascii_grid: str):
    """Parse the MCP asciiGrid string into {track: [16 cell labels]}."""
    rows = {}
    for line in ascii_grid.split("\n"):
        for track in TRACK_ORDER:
            if line.startswith(track.ljust(9)) or line.startswith(track + " "):
                body = line[9:]
                cells = re.findall(r".{2}", body)
                rows[track] = [c.strip() or "" for c in cells][:16]
    return rows


def render(data: dict, out_path: str, title: str = "", subtitle: str = ""):
    rows = parse_ascii_grid(data["asciiGrid"])
    active_tracks = [t for t in TRACK_ORDER if t in rows]

    cell = 44
    label_w = 130
    pad = 40
    header_h = 90 if title else 20
    footer_h = 50 if subtitle else 20
    width = label_w + cell * 16 + pad * 2
    height = header_h + cell * len(active_tracks) + footer_h + pad * 2

    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    title_font = _font(30, bold=True)
    label_font = _font(16)
    small_font = _font(14)

    y = pad
    if title:
        draw.text((pad, y), title, fill=TEXT, font=title_font)
        y += 46
        draw.text((pad, y), "app.loopclub.xyz", fill=MUTED, font=small_font)
        y += 34
    y0_grid = y

    # beat markers (1..4) above the grid, every 4 steps
    for beat in range(4):
        bx = label_w + pad + beat * 4 * cell
        draw.text((bx + 4, y), str(beat + 1), fill=MUTED, font=small_font)
    y += 24

    for ti, track in enumerate(active_tracks):
        ry = y + ti * cell
        color = TRACK_COLORS.get(track, "#e6e6f0")
        draw.text((pad, ry + cell // 2 - 9), track, fill=TEXT, font=label_font)
        for step in range(16):
            cx = label_w + pad + step * cell
            # subtle beat separators every 4 steps
            if step % 4 == 0:
                draw.line([(cx, ry), (cx, ry + cell)], fill=BORDER, width=1)
            label = rows[track][step] if step < len(rows[track]) else ""
            lit = label not in ("", "·")
            box = [cx + 4, ry + 4, cx + cell - 4, ry + cell - 4]
            if lit:
                draw.rounded_rectangle(box, radius=6, fill=color)
                if len(label) <= 2 and any(ch.isalpha() for ch in label):
                    draw.text((cx + 8, ry + cell // 2 - 8), label, fill=BG, font=small_font)
            else:
                draw.rounded_rectangle(box, radius=6, outline=BORDER, width=1)

    if subtitle:
        draw.text((pad, height - pad - 22), subtitle, fill=MUTED, font=small_font)

    img.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True, help="path to describe_loop/build_loop JSON output")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--subtitle", default="")
    args = ap.parse_args()

    data = json.loads(Path(args.json).read_text())
    path = render(data, args.out, args.title, args.subtitle)
    print(f"saved {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
