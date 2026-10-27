"""Builds perf-profiles.json: pinned performance mods per loader x game version.
Usage: python3 -I scripts/perf-pins-gen.py <dir with v-<slug>.json from Modrinth /v2/project/<slug>/version> <out.json>
Rules: Fabulously Optimized INCLUDED-MODS (27.10.2026) + PERF-research 27.10 (B13-B15, G2.3).
Reads downloaded Modrinth version lists (data only)."""
import json, sys, datetime
RAW = sys.argv[1]
OUT = sys.argv[2]

def versions(slug):
    return json.load(open(f'{RAW}/v-{slug}.json', encoding='utf-8'))

def line(v):
    p = [int(x) for x in v.replace('-', '.').split('.') if x.isdigit()]
    return tuple(p + [0] * (3 - len(p)))[:3]

TARGETS = {
    'fabric': ['1.16.5', '1.19.2', '1.20', '1.20.1', '1.20.4', '1.21', '1.21.1', '1.21.4', '1.21.5', '1.21.8', '1.21.10', '1.21.11', '26.1', '26.1.2', '26.2', '26.3'],
    'forge': ['1.12.2', '1.16.5', '1.18.2', '1.19.2', '1.20.1', '1.21.1', '1.21.11', '26.2', '26.3'],
    'neoforge': ['1.21.1', '1.21.11', '26.1.2', '26.2', '26.3'],
}

def rules(loader, mc):
    """(slot, [slug candidates], extra) in install order; renderer first."""
    v = line(mc)
    out = []
    if loader == 'forge' and mc == '1.12.2':
        return [('memory', ['vintagefix'], {}), ('renderer', ['nothirium'], {'optifineClash': True})]
    if loader == 'fabric':
        out.append(('renderer', ['sodium'], {'optifineClash': True}))
        out.append(('logic', ['lithium'], {}))
    elif loader == 'neoforge':
        out.append(('renderer', ['sodium'], {'optifineClash': True}))
        out.append(('logic', ['lithium'], {}))
    elif loader == 'forge' and v <= (1, 20, 1):
        out.append(('renderer', ['embeddium'], {'optifineClash': True}))
    out.append(('memory', ['ferrite-core'], {}))
    out.append(('render2', ['immediatelyfast'], {'optifineClash': True}))
    # ModernFix: FO на Fabric — 1.20.x, 1.21.1, 1.21.4; форк mVUS — 1.21.11 и 26.x. Forge/NeoForge — ModernFix где есть.
    if loader == 'fabric':
        if (1, 20, 0) <= v <= (1, 21, 4) and mc not in ('1.21',):
            out.append(('startup', ['modernfix'], {}))
        elif v >= (1, 21, 11):
            out.append(('startup', ['modernfix-mvus'], {}))
    else:
        out.append(('startup', ['modernfix'], {}))
    if v < (1, 21, 2):
        out.append(('background', ['dynamic-fps'], {}))
    if v >= (1, 19, 4) and loader in ('fabric', 'neoforge', 'forge'):
        out.append(('quit', ['fastquit'], {}))
    if v >= (1, 17, 1) and loader == 'fabric':
        out.append(('language', ['language-reload'], {}))
    out.append(('mouse', ['ixeris'], {'os': 'windows'}))
    # Масштаб мира при чётком HUD (PERF-framegen FG-03): только «Картошка» и «Низкие»,
    # только стабильные релизы (беты под 1.21.11/26.x не ставим), не вместе с OptiFine,
    # шейдерами и Distant Horizons.
    out.append(('scale', ['renderscale'], {'levels': ['potato', 'low'], 'stableOnly': True,
                                           'conflicts': ['optifine', 'optifabric', 'iris', 'oculus', 'distanthorizons']}))
    return out

def pick(slug, mc, loader, stable_only=False):
    lds = ['fabric'] if loader == 'fabric' else [loader]
    best = None
    for kind in (('release',) if stable_only else ('release', 'beta')):
        for ver in versions(slug):
            if ver.get('version_type') != kind:
                continue
            if mc not in ver.get('game_versions', []) or not any(l in ver.get('loaders', []) for l in lds):
                continue
            if best is None or ver['date_published'] > best['date_published']:
                best = ver
        if best:
            break
    return best

profiles = []
missing = []
for loader, mcs in TARGETS.items():
    for mc in mcs:
        mods = []
        for slot, slugs, extra in rules(loader, mc):
            got = None
            stable_only = extra.pop('stableOnly', False) if isinstance(extra, dict) else False
            for slug in slugs:
                ver = pick(slug, mc, loader, stable_only)
                if ver:
                    files = [f for f in ver['files'] if f.get('primary')] or ver['files'][:1]
                    got = {'slot': slot, 'slug': slug, 'version': ver['id'], 'number': ver['version_number'],
                           'sha1': files[0]['hashes']['sha1'] if files else None, 'stable': ver['version_type'] == 'release', **extra}
                    break
            if got:
                mods.append(got)
            elif slot != 'scale':
                missing.append(f'{loader} {mc} {slot} {slugs}')
        profiles.append({'loader': loader, 'game': mc, 'mods': mods})

doc = {
    'rev': 2,
    'updated': datetime.date.today().isoformat(),
    'source': 'Fabulously Optimized INCLUDED-MODS + PERF-research 27.10.2026; pins are Modrinth version ids',
    'never': ['lazydfu', 'starlight', 'krypton', 'rubidium', 'canary', 'vulkanmod', 'noisium', 'smooth-boot'],
    'manualOnly': ['entityculling', 'moreculling'],
    'profiles': profiles,
}
json.dump(doc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('profiles', len(profiles), 'mods', sum(len(p['mods']) for p in profiles))
print('missing:'); print('\n'.join(missing))
