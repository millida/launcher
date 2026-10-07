#!/usr/bin/env python3
"""Фон сезона пропуска: пиксельный пейзаж слоями для параллакса.

Рисует четыре слоя 960x120 (небо с солнцем и лучами, дальние горы, холмы с
замком, передний край) в public/season/. В интерфейсе слои масштабируются
с image-rendering: pixelated. Палитра сезона — «закат углей»: фиолетовое
небо, оранжевый горизонт, золотое солнце справа (за героем).

Запуск: python3 scripts/season-art.py
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 960, 120
# Небо выше слоёв земли: фон тянется на весь блок пропуска.
SH = 320
OUT = Path(__file__).resolve().parent.parent / 'public' / 'season'
OUT.mkdir(parents=True, exist_ok=True)
SUN = (700, 266)

SKY = ['#140b2e', '#1d0f3d', '#2a1450', '#3d1a5c', '#562062', '#742a62', '#93385d', '#b34b52', '#d06344', '#e9843c', '#f5a63d']


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky():
    rnd = random.Random(7)
    im = Image.new('RGBA', (W, SH))
    px = im.load()
    bands = [hexrgb(c) for c in SKY]
    horizon = SH - 28
    for y in range(SH):
        t = min(1, y / horizon)
        i = min(len(bands) - 1, int(t * (len(bands) - 1) + 0.5))
        # Ступенчатые полосы с дизерингом на стыке — пиксельный закат.
        for x in range(W):
            j = i
            frac = t * (len(bands) - 1) - int(t * (len(bands) - 1))
            if 0.35 < frac < 0.65 and (x + y) % 2 == 0:
                j = min(len(bands) - 1, int(t * (len(bands) - 1)) + 1)
            c = bands[j]
            # Тёплый ореол вокруг солнца.
            d = math.hypot(x - SUN[0], (y - SUN[1]) * 1.4)
            glow = max(0, 1 - d / 300)
            glow = round(glow * 5) / 5
            c = mix(c, (255, 196, 92), glow * 0.45)
            px[x, y] = c + (255,)
    # Лучи: клинья от солнца, светлее неба через пиксель.
    for k in range(18):
        a0 = math.pi + k * (math.pi / 17) + 0.03
        a1 = a0 + 0.07
        for y in range(0, SUN[1]):
            for x in range(W):
                ang = math.atan2(y - SUN[1], x - SUN[0]) % (2 * math.pi)
                if a0 <= ang <= a1 and (x // 2 + y // 2) % 2 == 0:
                    r, g, b, _ = px[x, y]
                    d = math.hypot(x - SUN[0], y - SUN[1])
                    f = max(0, 1 - d / 640) * 0.24
                    px[x, y] = mix((r, g, b), (255, 220, 150), f) + (255,)
    # Звёзды — только в верхней холодной части.
    for _ in range(320):
        x, y = rnd.randrange(W), rnd.randrange(0, 170)
        if math.hypot(x - SUN[0], y - SUN[1]) < 120:
            continue
        c = (255, 255, 255) if rnd.random() < 0.3 else (190, 170, 255)
        px[x, y] = mix(px[x, y][:3], c, 0.55 + rnd.random() * 0.4) + (255,)
    d = ImageDraw.Draw(im)
    # Солнце: квадратный диск с кольцами — пиксельно.
    for r, col in [(19, '#ffcf6b'), (15, '#ffe08f'), (11, '#fff1c4')]:
        d.rectangle([SUN[0] - r, SUN[1] - r + 3, SUN[0] + r, SUN[1] + r - 3], fill=col)
        d.rectangle([SUN[0] - r + 3, SUN[1] - r, SUN[0] + r - 3, SUN[1] + r], fill=col)
    im.save(OUT / 'sky.png')


def ridge(seed, base, amp, step, rough):
    rnd = random.Random(seed)
    ys = []
    y = base
    for x in range(0, W + step, step):
        y += rnd.randint(-rough, rough)
        y = max(base - amp, min(base + amp // 3, y))
        ys += [y] * step
    return ys[:W]


def layer(name, seed, base, amp, step, rough, col, edge, extra=None):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = im.load()
    ys = ridge(seed, base, amp, step, rough)
    c = hexrgb(col)
    e = hexrgb(edge)
    for x in range(W):
        for y in range(ys[x], H):
            px[x, y] = (e if y < ys[x] + 1 else c) + (255,)
    if extra:
        extra(im, ys)
    im.save(OUT / name)


def castle(im, ys):
    d = ImageDraw.Draw(im)
    col = '#2a1238'
    x0 = 420
    g = min(ys[x0:x0 + 60])
    d.rectangle([x0, g - 16, x0 + 58, g + 2], fill=col)
    for tx, th in [(x0 - 4, 30), (x0 + 22, 40), (x0 + 50, 26)]:
        d.rectangle([tx, g - th, tx + 10, g], fill=col)
        for k in range(0, 12, 4):
            d.rectangle([tx + k, g - th - 3, tx + k + 1, g - th], fill=col)
    for k in range(x0, x0 + 58, 5):
        d.rectangle([k, g - 19, k + 2, g - 16], fill=col)
    # Окна горят.
    for wx, wy in [(x0 + 25, g - 32), (x0 + 3, g - 22), (x0 + 53, g - 18), (x0 + 40, g - 10)]:
        d.rectangle([wx, wy, wx + 1, wy + 2], fill='#ffb347')
    d.rectangle([x0 + 26, g - 46, x0 + 26, g - 40], fill=col)
    d.rectangle([x0 + 27, g - 46, x0 + 31, g - 43], fill='#f5a63d')


def trees(im, ys):
    rnd = random.Random(11)
    d = ImageDraw.Draw(im)
    col = '#120818'
    for _ in range(52):
        x = rnd.randrange(0, W)
        if 300 < x < 800 and rnd.random() < 0.6:
            continue
        g = ys[min(W - 1, x)]
        h = rnd.randint(8, 18)
        d.rectangle([x, g - h, x + 1, g], fill=col)
        for k in range(0, h - 3, 3):
            w = max(1, (h - k) // 3)
            d.rectangle([x - w, g - h + k + 2, x + 1 + w, g - h + k + 3], fill=col)


def ground(im, ys):
    px = im.load()
    for x in range(W):
        y = ys[x]
        # Кромка травы подсвечена закатом.
        if y < H:
            px[x, y] = hexrgb('#5b2a3a') + (255,)
        if y + 1 < H and x % 3 != 0:
            px[x, y + 1] = hexrgb('#3a1a30') + (255,)


sky()
layer('far.png', 3, 80, 26, 6, 4, '#5e2a63', '#7a3a6c')
layer('mid.png', 5, 96, 16, 5, 3, '#38173f', '#4a2050', castle)
layer('near.png', 9, 110, 8, 4, 2, '#1a0b22', '#2a1230', lambda im, ys: (trees(im, ys), ground(im, ys)))
print('season art ->', OUT)
