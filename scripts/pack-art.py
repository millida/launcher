"""Пиксель-арт пакетов рубинов (06.10.2026): 9 картинок, от горсти к хранилищу.

Рисуется кодом на сетке 32×32 (клетка = 4 px, итог 128×128, прозрачный фон):
рубины, золото, кожа, дерево, сталь и общий тёмный контур. Запуск:
    python3 scripts/pack-art.py public/packs
Нужен Pillow.
"""
import sys
from PIL import Image

N = 32
SCALE = 4
PAL = {
    'K': (27, 31, 28, 255),     # контур
    'r': (232, 54, 79, 255),    # рубин
    'R': (158, 27, 51, 255),    # тень рубина
    'p': (255, 122, 140, 255),  # светлая грань
    'w': (255, 222, 228, 255),  # блик
    'y': (245, 179, 1, 255),    # золото
    'Y': (184, 134, 11, 255),   # тень золота
    'l': (255, 226, 122, 255),  # блик золота
    'b': (150, 98, 48, 255),    # кожа/дерево
    'B': (100, 62, 28, 255),    # тень дерева
    'n': (190, 132, 70, 255),   # свет дерева
    's': (130, 138, 150, 255),  # сталь
    'S': (78, 84, 96, 255),     # тень стали
    't': (178, 186, 196, 255),  # свет стали
}


class Canvas:
    def __init__(self):
        self.px = [[None] * N for _ in range(N)]

    def put(self, x, y, c):
        if 0 <= x < N and 0 <= y < N and c:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def art(self, x0, y0, rows):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch != '.':
                    self.put(x0 + dx, y0 + dy, ch)

    def outline(self):
        out = [row[:] for row in self.px]
        for y in range(N):
            for x in range(N):
                if self.px[y][x] is None and any(
                    0 <= x + dx < N and 0 <= y + dy < N and self.px[y + dy][x + dx] not in (None, 'K')
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                ):
                    out[y][x] = 'K'
        self.px = out

    def save(self, path):
        im = Image.new('RGBA', (N * SCALE, N * SCALE), (0, 0, 0, 0))
        for y in range(N):
            for x in range(N):
                c = self.px[y][x]
                if c:
                    for i in range(SCALE):
                        for j in range(SCALE):
                            im.putpixel((x * SCALE + i, y * SCALE + j), PAL[c])
        im.save(path)


GEM = ['.prr.', 'pwrrR', 'prrrR', '.rrR.', '..R..']
GEM_BIG = ['..prrr..', '.pwprrR.', 'ppwrrrRR', 'prrrrrrR', '.rrrrRR.', '..rrRR..', '...RR...']


def gem(c, x, y):
    c.art(x, y, GEM)


def pile(c, cx, base, rows):
    """Пирамида рубинов: rows — сколько в ряду снизу вверх."""
    for i, n in enumerate(rows):
        y = base - 4 - i * 4
        x0 = cx - (n * 5) // 2 + (i % 2) * 2
        for k in range(n):
            gem(c, x0 + k * 5, y)


def pouch(c, x, y, w, h):
    """Кожаный мешок: тело, горловина, завязка золотом."""
    for row in range(h):
        k = min(row, h - 1 - row, 3)
        inset = max(0, 3 - k)
        c.rect(x + inset, y + row, x + w - 1 - inset, y + row, 'b')
        c.put(x + inset, y + row, 'n')
        c.put(x + w - 1 - inset, y + row, 'B')
    c.rect(x + 2, y + h - 2, x + w - 3, y + h - 1, 'B')
    c.rect(x + w // 2 - 3, y - 2, x + w // 2 + 2, y, 'b')
    c.rect(x + w // 2 - 3, y + 1, x + w // 2 + 2, y + 1, 'y')
    c.put(x + w // 2 - 3, y + 1, 'l')


def chest(c, x, y, w, h, lid_open=True):
    """Сундук: дерево, золотые полосы и замок; открыт — рубины сверху."""
    c.rect(x, y, x + w - 1, y + h - 1, 'b')
    c.rect(x, y, x + w - 1, y, 'n')
    c.rect(x, y + h - 1, x + w - 1, y + h - 1, 'B')
    for gx in (x + 1, x + w - 2):
        c.rect(gx, y, gx, y + h - 1, 'y')
    c.rect(x, y + 2, x + w - 1, y + 2, 'Y')
    c.rect(x + w // 2 - 1, y + 2, x + w // 2, y + 4, 'y')
    c.put(x + w // 2 - 1, y + 3, 'K')
    if lid_open:
        c.rect(x, y - 5, x + w - 1, y - 4, 'B')
        c.rect(x, y - 6, x + w - 1, y - 6, 'n')
        c.rect(x + 1, y - 5, x + 1, y - 4, 'y')
        c.rect(x + w - 2, y - 5, x + w - 2, y - 4, 'y')


def vault(c, x, y, s):
    """Дверь хранилища: стальной круг, золотой штурвал."""
    r = s // 2
    cx, cy = x + r, y + r
    for yy in range(y, y + s):
        for xx in range(x, x + s):
            d = (xx - cx + 0.5) ** 2 + (yy - cy + 0.5) ** 2
            if d <= r * r:
                c.put(xx, yy, 't' if (xx - cx) + (yy - cy) < -r // 2 else 'S' if (xx - cx) + (yy - cy) > r // 2 else 's')
    for d in range(-3, 4):
        c.put(cx + d, cy, 'y')
        c.put(cx, cy + d, 'y')
    c.rect(cx - 1, cy - 1, cx, cy, 'l')


def big(c, x, y):
    c.art(x, y, GEM_BIG)


def bigpile(c, cx, base, rows):
    """Пирамида крупных рубинов (8×7): rows — сколько в ряду снизу вверх."""
    for i, n in enumerate(rows):
        y = base - 7 - i * 5
        x0 = cx - (n * 7) // 2 + (i % 2) * 3
        for k in range(n):
            big(c, x0 + k * 7, y)


def make(i):
    c = Canvas()
    if i == 0:  # горсть
        big(c, 6, 18); big(c, 17, 19); big(c, 12, 12)
    elif i == 1:  # кучка
        bigpile(c, 16, 29, [3, 2, 1])
    elif i == 2:  # большая кучка
        bigpile(c, 16, 30, [4, 3, 2, 1])
    elif i == 3:  # мешочек
        pouch(c, 6, 11, 20, 19)
        big(c, 9, 4); big(c, 16, 5)
    elif i == 4:  # мешок и россыпь
        pouch(c, 2, 10, 20, 20)
        bigpile(c, 25, 31, [1])
        big(c, 5, 3); big(c, 12, 2); gem(c, 20, 5); gem(c, 26, 20)
    elif i == 5:  # сундучок
        chest(c, 5, 17, 22, 13)
        bigpile(c, 16, 17, [2, 1])
    elif i == 6:  # большой сундук
        chest(c, 2, 16, 28, 14)
        bigpile(c, 16, 16, [3, 2, 1])
    elif i == 7:  # два сундука
        chest(c, 1, 20, 15, 10)
        chest(c, 15, 16, 16, 13)
        bigpile(c, 8, 20, [1])
        bigpile(c, 23, 16, [2, 1])
    else:  # хранилище
        vault(c, 1, 1, 24)
        bigpile(c, 17, 31, [3, 2, 1])
    c.outline()
    return c


NAMES = ['handful', 'pouch', 'purse', 'casket', 'chests', 'hoard', 'trove', 'treasury', 'vault']

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'public/packs'
    for i, name in enumerate(NAMES):
        make(i).save(f'{out}/{name}.png')
    print('ok', len(NAMES))
