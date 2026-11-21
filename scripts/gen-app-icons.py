#!/usr/bin/env python3
"""Alternative app icons of the launcher: the Millida mark in 3D, each with its own scene.

Masters are 1024x1024 frames rendered by the three.js page scripts/voxel-art/icons.ts: the
tile fills most of the frame and the scene (sparks, flame, crystals, crown, ingots, portal)
runs to the edges. They are kept as JPG in scripts/voxel-art/icons/<id>.jpg. Default (the
bundle icon) stays as it is; only its picture for the picker is written.

Run from the repository root (needs Pillow: python3 -m pip install pillow):

    npx vite                                                   # in another terminal
    PAGE=icons node scripts/voxel-art/save.mjs /tmp/icons      # PNG masters into a scratch folder
    python3 scripts/gen-app-icons.py --masters /tmp/icons      # PNG -> JPG masters, then build
    python3 scripts/gen-app-icons.py                           # build from the committed JPG masters
    python3 scripts/gen-app-icons.py --sheet /tmp/sheet.png    # optional: contact sheet of the shipped files

save.mjs needs the chromium path in CHROME= when the default headless shell is not installed.

Writes src-tauri/icons/alt/<id>/{32x32,128x128,256x256,512x512,runtime-256}.png, icon.ico,
icon.icns (iconutil on macOS) and public/app-icons/<id>.png for the picker.

Sizes: 16–32 px are a flat recolour of the bundle icon (src-tauri/icons/icon.png), where a
scene would only be noise; from 64 px up the 3D master is used.

Silhouette is a superellipse (the macOS corner). Two margins:
- macOS (.icns, PNG, runtime): body 824 of 1024 with a shadow (Apple grid);
- Windows (.ico) and the picker: body 944 of 1024, shorter shadow.
"""
import functools
import glob
import os
import shutil
import subprocess
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE_ICON = os.path.join(ROOT, "src-tauri", "icons", "icon.png")
BUNDLE_ICO = os.path.join(ROOT, "src-tauri", "icons", "icon.ico")
MASTERS = os.path.join(ROOT, "scripts", "voxel-art", "icons")
ALT = ["spark", "flame", "amethyst", "legend", "gold", "diamond", "emerald", "quartz", "obsidian"]
ALL = ["default"] + ALT  # default — только картинка витрины, штатная иконка сборки не меняется
M = 1024
FLAT_MAX = 32  # до этого размера — плоская иконка, крупнее — 3D
SOURCE_TILE = (94, 198, 77)

# Цвета плитки и глифа для плоских размеров (те же, что в шапке альтернативных иконок).
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


@functools.lru_cache(maxsize=None)
def squircle(size, n=5.0, ss=4):
    """Маска суперэллипса |x|^n + |y|^n = 1 со сглаживанием."""
    big = size * ss
    im = Image.new("L", (big, big), 0)
    px = im.load()
    r = big / 2
    for y in range(big):
        v = abs((y + 0.5 - r) / r) ** n
        if v >= 1:
            continue
        w = (1 - v) ** (1 / n) * r
        x0, x1 = int(round(r - w)), int(round(r + w))
        for x in range(x0, x1):
            px[x, y] = 255
    return im.resize((size, size), Image.LANCZOS)


def compose(master, body, shadow_y, shadow_blur, shadow_a):
    art = master.convert("RGB").resize((body, body), Image.LANCZOS)
    mask = squircle(body)
    # Тонкая светлая кромка — край читается на тёмном доке и панели задач.
    inner = mask.filter(ImageFilter.MinFilter(5))
    ring = ImageChops.subtract(mask, inner).point(lambda v: int(v * 0.16))
    art = Image.composite(Image.new("RGB", (body, body), (255, 255, 255)), art, ring)
    out = Image.new("RGBA", (M, M), (0, 0, 0, 0))
    off = (M - body) // 2
    sh = Image.new("L", (M, M), 0)
    sh.paste(mask, (off, off + shadow_y))
    sh = sh.filter(ImageFilter.GaussianBlur(shadow_blur)).point(lambda v: int(v * shadow_a))
    out.paste(Image.new("RGBA", (M, M), (0, 0, 0, 255)), (0, 0), sh)
    tile = art.convert("RGBA")
    tile.putalpha(mask)
    out.alpha_composite(tile, (off, off))
    return out


class Frames:
    """Четыре кадра одного варианта: 3D и плоский, поля macOS и Windows."""

    def __init__(self, name):
        big = Image.open(os.path.join(MASTERS, f"{name}.jpg")).convert("RGB")
        tile, glyph = (rgb(c) for c in PALETTE[name])
        flat = recolour(Image.open(BUNDLE_ICON).convert("RGBA"), tile, glyph).resize((M, M), Image.LANCZOS)
        # Прозрачные углы плитки заливаем её цветом, иначе они чернеют под маской.
        plain = Image.new("RGB", (M, M), tile)
        plain.paste(flat, (0, 0), flat)
        self.mac = compose(big, 824, 12, 22, 0.5)
        self.win = compose(big, 944, 8, 12, 0.42)
        self.mac_flat = compose(plain, 824, 12, 22, 0.5)
        self.win_flat = compose(plain, 944, 8, 12, 0.42)

    def mac_at(self, s):
        return sized(self.mac_flat if s <= FLAT_MAX else self.mac, s)


def sized(im, s):
    return im.resize((s, s), Image.LANCZOS)


def export(name, fr):
    pub = os.path.join(ROOT, "public", "app-icons")
    os.makedirs(pub, exist_ok=True)
    sized(fr.win, 256).save(os.path.join(pub, f"{name}.png"), optimize=True)
    out = os.path.join(ROOT, "src-tauri", "icons", "alt", name)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    sized(fr.mac_flat, 32).save(os.path.join(out, "32x32.png"), optimize=True)
    for s in (128, 256, 512):
        sized(fr.mac, s).save(os.path.join(out, f"{s}x{s}.png"), optimize=True)
    # Картинка, которую ядро ставит в Dock/окно/панель задач в рантайме.
    sized(fr.mac, 256).save(os.path.join(out, "runtime-256.png"), optimize=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [sized(fr.win_flat, s) if s <= FLAT_MAX else sized(fr.win, s) for s in sizes]
    frames[-1].save(os.path.join(out, "icon.ico"), sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    iconset = os.path.join(out, "icon.iconset")
    os.makedirs(iconset)
    for base in (16, 32, 128, 256, 512):
        fr.mac_at(base).save(os.path.join(iconset, f"icon_{base}x{base}.png"))
        fr.mac_at(base * 2).save(os.path.join(iconset, f"icon_{base}x{base}@2x.png"))
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(out, "icon.icns")], check=True)
    shutil.rmtree(iconset)


def import_masters(src):
    """PNG (или JPG) из папки рендера — в JPG-мастера репозитория, 1024 px."""
    os.makedirs(MASTERS, exist_ok=True)
    for n in ALT:
        found = glob.glob(os.path.join(src, f"{n}.png")) + glob.glob(os.path.join(src, f"{n}.jpg"))
        if not found:
            sys.exit(f"no master for {n} in {src}")
        im = Image.open(found[0]).convert("RGB")
        if im.size != (M, M):
            sys.exit(f"{found[0]}: expected {M}x{M}, got {im.size}")
        im.save(os.path.join(MASTERS, f"{n}.jpg"), quality=93, subsampling=0)


def sheet(path):
    """Лист проверки по файлам, которые уходят в сборку: витрина 256, ico 32 и 16 px."""
    W = 262
    TOP = 268
    H = TOP + 96
    sh = Image.new("RGBA", (len(ALL) * W, H), (28, 30, 34, 255))
    ImageDraw.Draw(sh).rectangle((0, TOP, len(ALL) * W, H), fill=(236, 236, 240, 255))
    for i, n in enumerate(ALL):
        pic = Image.open(os.path.join(ROOT, "public", "app-icons", f"{n}.png")).convert("RGBA")
        sh.alpha_composite(pic, (i * W + 3, 6))
        ico = BUNDLE_ICO if n == "default" else os.path.join(ROOT, "src-tauri", "icons", "alt", n, "icon.ico")
        for s, y in ((32, TOP + 12), (16, TOP + 56)):
            im = Image.open(ico)
            im.size = (s, s)
            im.load()
            sh.alpha_composite(im.convert("RGBA"), (i * W + 40, y))
    sh.save(path)


def main(argv):
    if "--masters" in argv:
        import_masters(argv[argv.index("--masters") + 1])
    if "--sheet" in argv:
        sheet(argv[argv.index("--sheet") + 1])
        return 0
    src = Image.open(BUNDLE_ICON).convert("RGBA")
    os.makedirs(os.path.join(ROOT, "public", "app-icons"), exist_ok=True)
    sized(src, 256).save(os.path.join(ROOT, "public", "app-icons", "default.png"), optimize=True)
    for name in ALT:
        export(name, Frames(name))
        print("ok", name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
