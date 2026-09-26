import { describe, expect, it } from 'bun:test'
import { appendMr, cardFromMrHit, millidaExhausted, mrCategory, mrHasMore, mrTail, mrTarget, nextLoad, titleKey } from './mrTail'
import type { SiteCard, SiteSlug } from './site'
import type { ModHit } from '../../state/mods'

const site = (slug: string, title: string, extra: Partial<SiteCard> = {}): SiteCard => ({
  slug,
  section: 'mods',
  title,
  summary: '',
  cover: null,
  icon: null,
  side: null,
  author: null,
  downloads: null,
  versions: [],
  loaders: [],
  categories: [],
  publishedAt: null,
  updatedAt: null,
  ...extra,
})

const hit = (slug: string, title: string, extra: Partial<ModHit> = {}): ModHit => ({
  title,
  author: 'someone',
  desc: 'desc',
  dl: 1000,
  cats: [],
  slug,
  pid: 'P-' + slug,
  ...extra,
})

const mr = (slug: string, title: string, extra: Partial<ModHit> = {}): SiteCard => cardFromMrHit(hit(slug, title, extra), 'mods')!

const none = () => undefined

describe('раздел каталога → поиск Modrinth', () => {
  const cases: [SiteSlug, string | null, { type: string; category: string | null } | null, string][] = [
    ['modpacks', null, { type: 'modpack', category: null }, 'сборки — главная жалоба: без хвоста их осталась тысяча'],
    ['mods', null, { type: 'mod', category: null }, 'модов в каталоге Millida меньше семисот'],
    ['texture-packs', null, { type: 'resourcepack', category: null }, 'ресурс-паки на Modrinth — resourcepack'],
    ['shaders', null, { type: 'shader', category: null }, 'шейдеры'],
    ['data-packs', null, { type: 'datapack', category: null }, 'дата-паки'],
    ['maps', null, null, 'карт на Modrinth нет — хвост из CurseForge не строим'],
    ['plugins', null, null, 'плагины живут в каталоге сервера, в «Ресурсах» их нет'],
    ['mods', 'магия', { type: 'mod', category: 'magic' }, 'русская категория переводится в категорию Modrinth'],
    ['mods', 'чат', null, 'значок без категории Modrinth: без фильтра хвост показал бы всё подряд'],
    ['texture-packs', '16x', { type: 'resourcepack', category: '16x' }, 'разрешение ресурс-пака — та же категория на Modrinth'],
    ['mods', 'неизвестная', null, 'непереводимая категория — хвоста нет, чтобы не обмануть фильтр'],
  ]
  for (const [section, category, want, why] of cases)
    it(`${section} + ${category ?? '—'}: ${why}`, () => {
      expect(mrTarget(section, category)).toEqual(want)
    })

  it('mrCategory не отдаёт имена значков вместо категорий', () => {
    expect(mrCategory('защита')).toBeNull()
    expect(mrCategory('Оптимизация')).toBe('optimization')
  })
})

describe('ключ названия для поиска дублей', () => {
  const cases: [string, string, string][] = [
    ['Sodium — скачать мод на Fabric', 'sodium', 'хвост «скачать мод» сайта не мешает узнать Sodium'],
    ['Battle Towers — дата-пак для Minecraft', 'battletowers', 'хвост «— дата-пак для Minecraft»'],
    ['Immortal 3.0.1', 'immortal', 'номер версии в названии сборки Millida'],
    ["YUNG's Better Witch Huts для Minecraft", 'yungsbetterwitchhuts', 'апостроф и «для Minecraft»'],
    ['Create: Above and Beyond', 'createaboveandbeyond', 'двоеточие и пробелы'],
  ]
  for (const [title, want, why] of cases)
    it(`${title}: ${why}`, () => {
      expect(titleKey(title)).toBe(want)
    })
})

describe('хвост Modrinth: дубли и когда он виден', () => {
  const items = [
    site('sodium-dlya-minecraft', 'Sodium — скачать мод на Fabric'),
    site('immortal', 'Immortal 3.0.1', { launcherOnly: true }),
    site('no-pumpkin-blur-2', 'No Pumpkin Blur для Minecraft'),
    site('irisshaders-mirror', 'Совсем другое имя'),
  ]
  const resolved = (c: SiteCard) => (c.slug === 'irisshaders-mirror' ? hit('iris', 'Iris Shaders') : undefined)
  const tailSlugs = (pool: SiteCard[], page: number, pages: number, peek = resolved) => mrTail(items, pool, page, pages, peek).map((c) => c.slug)

  const pool = [
    mr('sodium', 'Sodium'),
    mr('immortal-pack', 'Immortal'),
    mr('no-pumpkin-blur', 'No Pumpkin Blur'),
    mr('iris', 'Iris Shaders'),
    mr('lithium', 'Lithium'),
  ]

  const cases: [string, number, number, string[]][] = [
    ['страницы Millida не кончились — хвоста нет, платные и наши остаются первыми', 1, 3, []],
    ['последняя страница Millida — хвост без дублей', 3, 3, ['lithium']],
    ['поиск без находок Millida (pages=0) — сразу Modrinth', 1, 0, ['lithium']],
    ['до первого ответа (page=0) ничего не показываем', 0, 0, []],
  ]
  for (const [why, page, pages, want] of cases)
    it(why, () => {
      expect(tailSlugs(pool, page, pages)).toEqual(want)
    })

  it('без узнанного источника дубль по другому имени проходит — узнанный источник его снимает', () => {
    expect(tailSlugs([mr('iris', 'Iris Shaders')], 1, 1, none)).toEqual(['iris'])
    expect(tailSlugs([mr('iris', 'Iris Shaders')], 1, 1)).toEqual([])
  })

  it('совпадение по номеру проекта снимает дубль даже при другом адресе', () => {
    const peek = (c: SiteCard) => (c.slug === 'irisshaders-mirror' ? hit('whatever', 'x', { pid: 'YL57xq9U' }) : undefined)
    expect(tailSlugs([mr('iris-renamed', 'Renamed', { pid: 'YL57xq9U' })], 1, 1, peek)).toEqual([])
  })

  it('millidaExhausted: страница 0 — ещё не загружено', () => {
    expect(millidaExhausted(0, 0)).toBe(false)
    expect(millidaExhausted(2, 2)).toBe(true)
  })
})

describe('подгрузка: сначала Millida, потом Modrinth', () => {
  const cases: [{ page: number; pages: number; mrMore: boolean }, ReturnType<typeof nextLoad>, string][] = [
    [{ page: 1, pages: 5, mrMore: true }, 'millida', 'пока есть страницы Millida, Modrinth ждёт'],
    [{ page: 5, pages: 5, mrMore: true }, 'modrinth', 'Millida кончилась — дальше страницы Modrinth'],
    [{ page: 5, pages: 5, mrMore: false }, null, 'кончились оба — кнопки «Показать ещё» нет'],
    [{ page: 1, pages: 0, mrMore: true }, 'modrinth', 'поиск без находок Millida листает Modrinth'],
  ]
  for (const [st, want, why] of cases)
    it(why, () => {
      expect(nextLoad(st)).toBe(want)
    })

  const more: [number, number, number, boolean, string][] = [
    [0, 20, 500, true, 'полная страница и есть ещё'],
    [480, 20, 500, false, 'дошли до total_hits'],
    [0, 7, 500, false, 'неполная страница — конец выдачи'],
    [0, 0, 0, false, 'пустой ответ'],
  ]
  for (const [offset, got, total, want, why] of more)
    it(`mrHasMore(${offset}, ${got}, ${total}): ${why}`, () => {
      expect(mrHasMore(offset, got, total, 20)).toBe(want)
    })

  it('appendMr не дублирует строку, сдвинутую между страницами выдачи', () => {
    const merged = appendMr([mr('a', 'A'), mr('b', 'B')], [mr('b', 'B'), mr('c', 'C')])
    expect(merged.map((c) => c.slug)).toEqual(['a', 'b', 'c'])
  })
})

describe('находка Modrinth → строка ленты', () => {
  it('ставится старым путём Modrinth: строка несёт готовую находку', () => {
    const h = hit('sodium', 'Sodium', { gameVers: ['1.20.1', '24w10a', '1.21.1'], cats: ['optimization', 'fabric'], loaders: ['fabric'] })
    const c = cardFromMrHit(h, 'mods')!
    expect(c.mrHit).toBe(h)
    expect(c.launcherOnly).toBe(false)
    expect(c.versions).toEqual(['1.21.1', '1.20.1'])
    expect(c.categories).toEqual(['оптимизация'])
    expect(c.downloads).toBeNull()
  })

  it('находка без адреса не превращается в строку', () => {
    expect(cardFromMrHit(hit('', 'x', { slug: undefined }), 'mods')).toBeNull()
  })
})
