"""Риги режимов (владелец 30.09.2026, 15:42): вместо плоских значков 16x16 — рендеры
public/hero-rigs сайта в стиле Mojang. Один риг на режим, без повторов (правило
«рендер не повторяется дважды на странице»); OneBlock — свой баннер с rig-47.

python3 scripts/render-mode-rigs.py ~/dev/millida-web
пишет public/mode-art/rigs/<КОД>.webp лаунчера, <сайт>/public/catalog-art/modes/rigs/<КОД>.webp
и поле rig в оба манифеста (src/components/playhub/mode-art.json, <сайт>/src/lib/catalog-mode-art.json).
"""
import json, os, sys
from PIL import Image

RIGS = {
    'PVP': 46, 'SURVIVAL': 26, 'ANARCHY': 7, 'RP': 21, 'SKYBLOCK': 24, 'LIFESTEAL': 40,
    'BOXPVP': 34, 'COBBLEMON': 16, 'MINIGAMES': 12, 'CREATIVE': 44, 'TECHNICAL': 42,
    'GRIEF': 48, 'BEDWARS': 19, 'SKYWARS': 14, 'HUNGER_GAMES': 29, 'KITPVP': 27,
    'FACTIONS': 31, 'PRISON': 28, 'TOWNY': 8, 'MMORPG': 33, 'BUILD_BATTLE': 11,
    'PARKOUR': 32, 'HIDE_SEEK': 50, 'MURDER': 43, 'SPLEEF': 6, 'TNTRUN': 2, 'UHC': 17,
    'HARDCORE': 20, 'EARTH': 5, 'MANHUNT': 18, 'BINGO': 22, 'LUCKY': 36, 'VANILLA': 13,
}
MAX_H, MAX_W = 400, 440

# Плитка показывает риг «из угла»: у персонажей — верх до пояса (голова и
# оружие), у предметов и существ — целиком. Доли кадра: слева, сверху, справа, снизу.
UPPER = (0, 0, 1, 0.56)
CROP = {n: UPPER for n in (1, 6, 10, 11, 13, 14, 18, 20, 21, 26, 27, 28, 29, 31, 32, 33, 34, 40, 43, 44, 46, 48, 50)}
CROP.update({
    24: (0.3, 0, 0.7, 0.75),   # Стив над порталом Края — остров в пустоте
    27: (0.4, 0, 1, 0.6),      # правый из двоих, с оружием
    26: (0.3, 0, 1, 0.56),     # без летящей кирки слева
    18: (0.22, 0, 1, 0.56),
    2: (0.3, 0, 0.8, 0.85),    # крипер в центре толпы
})

def main():
    site = os.path.expanduser(sys.argv[1])
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assert len(set(RIGS.values())) == len(RIGS), 'риг повторяется'
    outs = [os.path.join(here, 'public/mode-art/rigs'), os.path.join(site, 'public/catalog-art/modes/rigs')]
    for d in outs:
        os.makedirs(d, exist_ok=True)
    dims = {}
    for code, n in RIGS.items():
        im = Image.open(os.path.join(site, 'public/hero-rigs/hero-%d.png' % n)).convert('RGBA')
        im = im.crop(im.getbbox())
        l, t, r, b = CROP.get(n, (0, 0, 1, 1))
        im = im.crop((round(l * im.width), round(t * im.height), round(r * im.width), round(b * im.height)))
        im = im.crop(im.getbbox())
        k = min(MAX_H / im.height, MAX_W / im.width, 1)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        dims[code] = (im.width, im.height)
        for d in outs:
            im.save(os.path.join(d, code + '.webp'), 'WEBP', quality=84, method=6)
    for path in [os.path.join(here, 'src/components/playhub/mode-art.json'), os.path.join(site, 'src/lib/catalog-mode-art.json')]:
        with open(path) as f:
            data = json.load(f)
        for code, v in data.items():
            if code in RIGS:
                w, h = dims[code]
                v['rig'] = {'src': 'hero-%d' % RIGS[code], 'w': w, 'h': h}
        with open(path, 'w') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')

main()
