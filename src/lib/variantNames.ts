/**
 * Вещь-расцветка (модель v3.1, решение владельца 24.09.2026, 19:37): каждая
 * расцветка — отдельная вещь со своим именем, рангом и ценой, своя карточка в
 * магазине и в гардеробе. Код — «КОД~имя» у вещей с двумя и больше
 * расцветками (базовая тоже), иначе код самой вещи.
 *
 * Имя: базовая — имя вещи, остальные — имя вещи + существительное в
 * родительном падеже по цвету («Плащ заката»). Служба присылает своё имя
 * (variants[].title); здесь — зеркало variants.catalog.ts службы для старой
 * службы и демо.
 */

export const VARIANT_SEP = '~'

const TITLE_WORDS: [RegExp, string][] = [
  [/rainbow/, 'радуги'],
  [/prism|chroma/, 'призмы'],
  [/galaxy|cosmic|space|star/, 'галактики'],
  [/holo/, 'голограммы'],
  [/aurora/, 'северного сияния'],
  [/void/, 'пустоты'],
  [/aether/, 'эфира'],
  [/herobrine/, 'Херобрина'],
  [/wither/, 'иссушения'],
  [/(^|_)ender|end($|_)/, 'Края'],
  [/portal/, 'портала'],
  [/soul/, 'душ'],
  [/magma|lava/, 'магмы'],
  [/fire|flame|blaze/, 'огня'],
  [/(^|_)ice($|_)|frost|snow/, 'инея'],
  [/lightning|thunder|storm/, 'грозы'],
  [/neon/, 'неона'],
  [/glow|light($|_)/, 'сияния'],
  [/blood/, 'крови'],
  [/acid|toxic|poison/, 'яда'],
  [/diamond/, 'алмаза'],
  [/emerald/, 'изумруда'],
  [/amethyst/, 'аметиста'],
  [/netherite/, 'незерита'],
  [/obsidian/, 'обсидиана'],
  [/copper/, 'меди'],
  [/iron|silver|steel/, 'луны'],
  [/gold/, 'солнца'],
  [/crimson|scarlet|ruby/, 'багрянца'],
  [/red/, 'заката'],
  [/orange|amber/, 'пламени'],
  [/yellow|lemon/, 'полудня'],
  [/lime/, 'лайма'],
  [/green|mint|forest/, 'леса'],
  [/teal|cyan|aqua|turquoise/, 'лагуны'],
  [/light_blue|sky/, 'неба'],
  [/navy|dark_blue/, 'шторма'],
  [/blue/, 'глубин'],
  [/purple|violet|lavender/, 'сумерек'],
  [/magenta|pink|rose/, 'сакуры'],
  [/white|pearl/, 'снега'],
  [/black|dark|shadow/, 'ночи'],
  [/gray|grey|ash/, 'пепла'],
  [/brown|wood|choco/, 'коры'],
]

const TITLE_SPARE = ['рассвета', 'бури', 'тумана', 'прилива', 'полуночи', 'грёз', 'вьюги', 'зари', 'миража', 'эха', 'бездны', 'зенита']

/** Имена всех расцветок вещи по порядку; уникальны внутри вещи. */
export function variantTitles(baseName: string, names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name, index) => {
    if (index === 0) return baseName
    const text = name.toLowerCase()
    const words = TITLE_WORDS.filter(([re]) => re.test(text)).map(([, w]) => w)
    const spare = [...TITLE_SPARE.slice(index % TITLE_SPARE.length), ...TITLE_SPARE]
    const word = [...words, ...spare].find((w) => !used.has(w)) ?? String(index + 1)
    used.add(word)
    return baseName + ' ' + word
  })
}

export const variantCode = (code: string, name: string) => code + VARIANT_SEP + name

/** Код карточки → код вещи и имя расцветки ('' — вещь без расцветок). */
export function splitVariantCode(id: string): { code: string; variant: string } {
  const at = id.indexOf(VARIANT_SEP)
  return at < 0 ? { code: id, variant: '' } : { code: id.slice(0, at), variant: id.slice(at + 1) }
}
