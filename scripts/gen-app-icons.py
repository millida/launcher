#!/usr/bin/env python3
"""Собирает альтернативные иконки приложения Millida из 3D-рендеров.

Рисунки (06.10.2026) — знак Millida, выдавленный в 3D и снятый в разных
материалах: scripts/voxel-art/icons.ts. Кадры 1024×1024 «в край» лежат в
scripts/voxel-art/icons/<id>.jpg. Перерисовать их:

    npx vite   # из корня репозитория
    PAGE=icons node scripts/voxel-art/save.mjs /tmp/icons
    python3 scripts/gen-app-icons.py --masters /tmp/icons   # PNG → JPG-мастера и сборка

Запуск без аргументов собирает иконки из лежащих мастеров:
src-tauri/icons/alt/<id>/{32x32,128x128,256x256,512x512}.png, icon.ico,
icon.icns (iconutil на macOS) и public/app-icons/<id>.png для витрины.

Два уровня детализации: от 256 px — сцена с материалом (<id>.jpg), до 128 px —
упрощённый кадр <id>-small.jpg: плитка во весь кадр, глиф в тёмной кайме, без
россыпей — знак читается с 16 px и не сливается с обоями.

Силуэт — суперэллипс (скругление macOS). Два варианта полей:
- macOS: тело 824 из 1024 с тенью (сетка Apple) — PNG и .icns, их же ставит Dock;
- Windows и витрина: тело 944 из 1024, тень короче — .ico и public/app-icons.

Лестница (06.10.2026): Искра — 5 друзей, Пламя — 10, Аметист — 25,
Легенда — 50; Золото — PLUS, Алмаз — Diamond.
"""
import os
import shutil
import subprocess
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTERS = os.path.join(ROOT, "scripts", "voxel-art", "icons")
ALT = ["spark", "flame", "amethyst", "legend", "gold", "diamond"]
ALL = ["default"] + ALT  # default — только картинка витрины, штатная иконка сборки не меняется
M = 1024


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


# До 128 px включительно — чёткий кадр: Dock (64 pt на Retina = 128 px), панель
# задач, ярлыки. Крупнее — сцена (Finder, Launchpad, витрина).
SMALL_MAX = 128


class Icon:
    """Крупный и мелкий кадр одного варианта полей; размер сам выбирает кадр."""

    def __init__(self, big, small):
        self.big, self.small = big, small

    def at(self, s, bold=False):
        return (self.small if bold or s <= SMALL_MAX else self.big).resize((s, s), Image.LANCZOS)


def sized(icon, s):
    return icon.at(s)


def export(name, mac, win):
    pub = os.path.join(ROOT, "public", "app-icons")
    os.makedirs(pub, exist_ok=True)
    sized(win, 256).save(os.path.join(pub, f"{name}.png"), optimize=True)
    if name not in ALT:
        return
    out = os.path.join(ROOT, "src-tauri", "icons", "alt", name)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    for s in (32, 128, 256, 512):
        sized(mac, s).save(os.path.join(out, f"{s}x{s}.png"), optimize=True)
    # Картинка, которую ядро ставит в Dock/окно/панель задач в рантайме: чёткий кадр.
    mac.at(256, bold=True).save(os.path.join(out, "runtime-256.png"), optimize=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [sized(win, x) for x in sizes]
    frames[-1].save(os.path.join(out, "icon.ico"), sizes=[(x, x) for x in sizes], append_images=frames[:-1])
    iconset = os.path.join(out, "icon.iconset")
    os.makedirs(iconset)
    for base in (16, 32, 128, 256, 512):
        sized(mac, base).save(os.path.join(iconset, f"icon_{base}x{base}.png"))
        sized(mac, base * 2).save(os.path.join(iconset, f"icon_{base}x{base}@2x.png"))
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(out, "icon.icns")], check=True)
    shutil.rmtree(iconset)


def variants(name):
    big = Image.open(os.path.join(MASTERS, f"{name}.jpg"))
    small = Image.open(os.path.join(MASTERS, f"{name}-small.jpg"))
    mac = Icon(compose(big, 824, 12, 22, 0.5), compose(small, 824, 12, 22, 0.5))
    win = Icon(compose(big, 944, 8, 12, 0.42), compose(small, 944, 8, 12, 0.42))
    return mac, win


def sheet(path):
    """Лист проверки: каждая иконка 256 (macOS-поля) и 64/32 (Windows-поля) на тёмном и светлом."""
    W = 300
    sh = Image.new("RGBA", (len(ALL) * W, 420), (28, 30, 34, 255))
    ImageDraw.Draw(sh).rectangle((0, 340, len(ALL) * W, 420), fill=(236, 236, 240, 255))
    for i, n in enumerate(ALL):
        mac, win = variants(n)
        sh.alpha_composite(sized(mac, 256), (i * W + 22, 10))
        sh.alpha_composite(sized(win, 64), (i * W + 60, 272))
        sh.alpha_composite(sized(win, 32), (i * W + 150, 288))
        sh.alpha_composite(sized(win, 64), (i * W + 60, 348))
        sh.alpha_composite(sized(win, 32), (i * W + 150, 364))
    sh.save(path)


def import_masters(src):
    os.makedirs(MASTERS, exist_ok=True)
    for n in ALL:
        for suf in ("", "-small"):
            Image.open(os.path.join(src, f"{n}{suf}.png")).convert("RGB").save(os.path.join(MASTERS, f"{n}{suf}.jpg"), quality=93, subsampling=0)


def main():
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "--masters":
        import_masters(args[1])
        args = args[2:]
    if len(args) >= 2 and args[0] == "--sheet":
        sheet(args[1])
        return 0
    for n in ALL:
        export(n, *variants(n))
        print("ok", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
