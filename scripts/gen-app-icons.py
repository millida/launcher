#!/usr/bin/env python3
"""Alternative app icons of the launcher: the bundle icon (src-tauri/icons/icon.png) recoloured.

Every icon is flat, exactly the shape of the standard one: a tile colour and a glyph colour,
no scene, no shadow. The picker in Settings shows the same picture the core puts on the
window, the taskbar, the Dock and the shortcuts, so the player picks what they will see.

Run from the repository root:

    python scripts/gen-app-icons.py

Writes src-tauri/icons/alt/<id>/{32x32,128x128,256x256,512x512,runtime-256}.png, icon.ico,
icon.icns and public/app-icons/<id>.png (default.png is the bundle icon itself).
"""
import os
import sys
from PIL import Image, IcnsImagePlugin  # noqa: F401  (registers the ICNS writer)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE_ICON = os.path.join(ROOT, "src-tauri", "icons", "icon.png")
SOURCE_TILE = (90, 206, 102)

PALETTE = {
    "spark": ("#0b3a17", "#a8ff3a"),
    "flame": ("#d8321a", "#ffd84a"),
    "amethyst": ("#7d3ff0", "#ffffff"),
    "legend": ("#13227a", "#ffc547"),
    "gold": ("#f0a828", "#ffffff"),
    "diamond": ("#38c4f5", "#ffffff"),
    "emerald": ("#14b06e", "#ffffff"),
    "quartz": ("#ec6aa2", "#ffffff"),
    "obsidian": ("#1d1230", "#b98cff"),
}


def rgb(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def recolour(src, tile, glyph):
    """Antialiased edges keep their blend: the share of white in a source pixel is the share of glyph."""
    out = Image.new("RGBA", src.size)
    sp, op = src.load(), out.load()
    span = 255 - SOURCE_TILE[0]
    for y in range(src.height):
        for x in range(src.width):
            r, _, _, a = sp[x, y]
            f = min(1.0, max(0.0, (r - SOURCE_TILE[0]) / span))
            op[x, y] = tuple(round(tile[i] * (1 - f) + glyph[i] * f) for i in range(3)) + (a,)
    return out


def sized(im, s):
    return im.resize((s, s), Image.LANCZOS)


def export(name, icon):
    out = os.path.join(ROOT, "src-tauri", "icons", "alt", name)
    os.makedirs(out, exist_ok=True)
    for s in (32, 128, 256, 512):
        sized(icon, s).save(os.path.join(out, f"{s}x{s}.png"), optimize=True)
    sized(icon, 256).save(os.path.join(out, "runtime-256.png"), optimize=True)
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    sized(icon, 256).save(os.path.join(out, "icon.ico"), sizes=[(s, s) for s in ico_sizes])
    sized(icon, 1024).save(os.path.join(out, "icon.icns"))
    sized(icon, 256).save(os.path.join(ROOT, "public", "app-icons", f"{name}.png"), optimize=True)


def main():
    src = Image.open(BUNDLE_ICON).convert("RGBA")
    os.makedirs(os.path.join(ROOT, "public", "app-icons"), exist_ok=True)
    sized(src, 256).save(os.path.join(ROOT, "public", "app-icons", "default.png"), optimize=True)
    for name, (tile, glyph) in PALETTE.items():
        export(name, recolour(src, rgb(tile), rgb(glyph)))
        print("ok", name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
