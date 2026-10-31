"""Временные картинки пресетов графики: один кадр (public/lobby/world.webp),
обработанный честно под каждый уровень — туман по дальности прорисовки,
приглушённый свет без шейдеров, пикселизация «Картошки».
TODO: заменить реальными кадрами со стенда (одна сцена, пять пресетов, 1.21.1, 1920x1080).
Запуск: python3 scripts/gfx-preset-art.py  ->  public/presets/{potato,low,standard,high,epic}.webp
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'lobby' / 'world.webp'
OUT = ROOT / 'public' / 'presets'
W, H = 480, 270

# Горизонт кадра — доля высоты; дальше от зрителя = ближе к горизонту снизу.
HORIZON = 0.68
# Над горизонтом туман гаснет на этой доле высоты: небо остаётся небом.
SKY_FADE = 0.2


def base() -> Image.Image:
    im = Image.open(SRC).convert('RGB')
    w, h = im.size
    # Кадр 16:9 из центра: горы, лес и небо целиком.
    cw = min(w, int(h * 16 / 9))
    left = (w - cw) // 2
    return im.crop((left, 0, left + cw, h)).resize((W, H), Image.LANCZOS)


def depth() -> np.ndarray:
    """Грубая глубина: 0 у нижнего края, 1 на горизонте; выше горизонта гаснет к небу."""
    y = np.linspace(0, 1, H)[:, None]
    ground = np.clip((1 - y) / (1 - HORIZON), 0, 1) ** 1.6
    sky = np.clip(1 - (HORIZON - y) / SKY_FADE, 0, 1)
    d = np.where(y >= HORIZON, ground, sky)
    return np.repeat(d, W, axis=1)


def fog(im: Image.Image, reach: float) -> Image.Image:
    """Туман там, куда не дорисовывает дальность: reach — доля глубины, которая видна.
    Цвет тумана — цвет неба у горизонта, как в самой игре."""
    a = np.asarray(im).astype(np.float32)
    top = int(H * (HORIZON - SKY_FADE))
    FOG = a[top : int(H * HORIZON) - 4].reshape(-1, 3).mean(axis=0)
    d = depth()
    t = np.clip((d - reach) / max(1e-3, 1 - reach) * 1.8, 0, 1)[..., None]
    out = a * (1 - t) + FOG * t
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def flat(im: Image.Image, sat: float, contrast: float) -> Image.Image:
    """Без шейдеров: свет плоский, тёплого свечения нет."""
    im = ImageEnhance.Color(im).enhance(sat)
    im = ImageEnhance.Contrast(im).enhance(contrast)
    return im.filter(ImageFilter.UnsharpMask(radius=1, percent=40, threshold=2))


def pixelate(im: Image.Image, step: int) -> Image.Image:
    return im.resize((W // step, H // step), Image.BILINEAR).resize((W, H), Image.NEAREST)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = base()
    levels = {
        'epic': src,
        'high': fog(flat(src, 0.85, 0.95), 0.85),
        'standard': fog(flat(src, 0.8, 0.92), 0.6),
        'low': fog(flat(src, 0.7, 0.9), 0.3),
        'potato': pixelate(fog(flat(src, 0.6, 0.88), 0.15), 8),
    }
    for name, im in levels.items():
        path = OUT / f'{name}.webp'
        im.save(path, 'WEBP', quality=78, method=6)
        print(path.relative_to(ROOT), path.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
