import { describe, expect, test } from 'bun:test'

Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
})

const m = await import('./millidaCatalog')
type CatalogFile = import('./millidaCatalog').CatalogFile

// Ссылку millida:// может открыть любая страница: разбор обязан пропускать
// только адреса сайта и отбрасывать всё остальное целиком.
describe('parseInstallLink', () => {
  const q = (s = '') => new URLSearchParams(s)

  test('мод с версией и загрузчиком', () => {
    expect(m.parseInstallLink('install', 'mods/iris-shaders', q('version=1.21.1&loader=fabric'))).toEqual({
      section: 'mods',
      slug: 'iris-shaders',
      versions: ['1.21.1'],
      loaders: ['fabric'],
    })
  })

  test('повторяющиеся параметры читаются все, дубли схлопываются', () => {
    const r = m.parseInstallLink('install', 'mods/x', q('version=1.20.1&version=1.21&version=1.21&loader=Forge'))
    expect(r?.versions).toEqual(['1.20.1', '1.21'])
    expect(r?.loaders).toEqual(['forge'])
  })

  test('старая ссылка сборки сайта — это раздел modpacks', () => {
    expect(m.parseInstallLink('modpack', 'immortal', q())?.section).toBe('modpacks')
    expect(m.parseInstallLink('modpack', 'immortal', q())?.slug).toBe('immortal')
  })

  test('скин адресуется ником — регистр и подчёркивание разрешены', () => {
    expect(m.parseInstallLink('install', 'skins/jeb_', q())?.slug).toBe('jeb_')
  })

  test('скин каталога: подпись и модель рук из ссылки сайта', () => {
    const r = m.parseInstallLink('install', 'skins/8f55e8d219558973', q('name=%D0%A0%D0%BE%D0%B7%D0%BE%D0%B2%D0%B0%D1%8F&model=slim'))
    expect(r).toEqual({ section: 'skins', slug: '8f55e8d219558973', versions: [], loaders: [], name: 'Розовая', slim: true })
  })

  test('подпись скина очищается и обрезается, модель — только slim', () => {
    const r = m.parseInstallLink('install', 'skins/jeb_', q('name=' + encodeURIComponent('a\n<b>' + 'x'.repeat(100)) + '&model=weird'))
    expect(r?.name).toBe('a b ' + 'x'.repeat(56))
    expect(r?.slim).toBeUndefined()
  })

  test('подпись и модель у модов не читаются', () => {
    const r = m.parseInstallLink('install', 'mods/x', q('name=evil&model=slim'))
    expect(r && 'name' in r).toBe(false)
    expect(r && 'slim' in r).toBe(false)
  })

  const bad: [string, string, string][] = [
    ['install', 'plugins/essentials', 'раздел, который в игру не ставится'],
    ['install', 'mods', 'нет slug'],
    ['install', 'mods/a/b', 'лишний сегмент'],
    ['install', 'mods/..', 'выход из пути'],
    ['install', 'mods/%2e%2e', 'выход из пути в кодировке'],
    ['install', 'mods/a%2Fb', 'слэш внутри slug'],
    ['install', 'mods/-x', 'slug с дефиса'],
    ['modpack', 'a/b', 'лишний сегмент у старой ссылки'],
    ['join', 'mods/x', 'чужое действие'],
  ]
  for (const [action, rest, why] of bad) {
    test('отказ: ' + why, () => expect(m.parseInstallLink(action, rest, q())).toBeNull())
  }

  test('мусор в версии и загрузчике отбрасывается, ссылка остаётся', () => {
    const r = m.parseInstallLink('install', 'mods/x', q('version=1.21%20evil&loader=../x&version=1.20.1'))
    expect(r?.versions).toEqual(['1.20.1'])
    expect(r?.loaders).toEqual([])
  })
})

describe('modrinthSlugOf', () => {
  test('ссылка на проект Modrinth', () => {
    expect(m.modrinthSlugOf('https://modrinth.com/mod/iris')).toBe('iris')
    expect(m.modrinthSlugOf('https://modrinth.com/resourcepack/marlowww')).toBe('marlowww')
  })
  test('не Modrinth — не угадываем', () => {
    expect(m.modrinthSlugOf('https://www.curseforge.com/minecraft/mc-mods/jei')).toBeNull()
    expect(m.modrinthSlugOf('https://modrinth.com.evil.net/mod/iris')).toBeNull()
    expect(m.modrinthSlugOf('http://modrinth.com/mod/iris')).toBeNull()
    expect(m.modrinthSlugOf(null)).toBeNull()
  })
})

const file = (p: Partial<CatalogFile>): CatalogFile => ({
  id: 'f',
  version: '1',
  gameVersions: [],
  primaryGameVersion: null,
  loaders: [],
  fileName: 'a.jar',
  size: 1,
  sha1: null,
  mirrored: false,
  origin: null,
  releasedAt: null,
  downloads: 0,
  ...p,
})

describe('pickFile', () => {
  const files = [
    file({ id: 'neo', gameVersions: ['1.21.1'], loaders: ['neoforge'], mirrored: true }),
    file({ id: 'fab-author', gameVersions: ['1.21.1'], loaders: ['fabric'] }),
    file({ id: 'fab-ours', gameVersions: ['1.21.1'], loaders: ['fabric'], mirrored: true }),
    file({ id: 'old', gameVersions: ['1.20.1'], loaders: ['fabric', 'forge'], mirrored: true }),
  ]

  test('из подходящих берём файл с нашего зеркала', () => {
    expect(m.pickFile(files, '1.21.1', 'fabric', 'mod')?.id).toBe('fab-ours')
  })
  test('Fabric-мод встаёт в Quilt', () => {
    expect(m.pickFile(files, '1.21.1', 'quilt', 'mod')?.id).toBe('fab-ours')
  })
  test('ванилла модов не запускает', () => {
    expect(m.pickFile(files, '1.21.1', 'vanilla', 'mod')).toBeNull()
  })
  test('под другую версию — ничего, а не «примерно подходящее»', () => {
    expect(m.pickFile(files, '1.19.2', 'fabric', 'mod')).toBeNull()
  })
  test('у ресурспака загрузчик не проверяется', () => {
    const rp = [file({ id: 'rp', gameVersions: ['1.21.1'], loaders: ['minecraft'] })]
    expect(m.pickFile(rp, '1.21.1', 'forge', 'resourcepack')?.id).toBe('rp')
  })
  test('список версий для вопроса «ставить всё равно?»', () => {
    expect(m.knownVersions(files)).toBe('1.21.1, 1.20.1')
  })
})

describe('compatibleBuilds', () => {
  const pr = (name: string, version: string, loader: string) => ({ name, version, fabric: loader === 'fabric', loader })
  const list = [pr('A', '1.21.1', 'fabric'), pr('B', '1.21.1', 'forge'), pr('C', '1.20.1', 'fabric'), pr('D', '1.21.1', 'vanilla')]
  const files = [file({ gameVersions: ['1.21.1', '1.20.1'], loaders: ['fabric'] })]

  test('мод — только сборки с его загрузчиком и версией', () => {
    expect(m.compatibleBuilds(list, files, 'mod')).toEqual(['A', 'C'])
  })
  test('ссылка сайта сужает до выбранной версии', () => {
    expect(m.compatibleBuilds(list, files, 'mod', ['1.20.1'])).toEqual(['C'])
  })
  test('ресурспаку загрузчик не важен', () => {
    expect(m.compatibleBuilds(list, files, 'resourcepack', [], ['fabric'])).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('карточка → строка', () => {
  test('заголовок под поиск превращается в имя', () => {
    expect(m.cleanTitle('Iris Shaders — скачать мод на Fabric')).toBe('Iris Shaders')
    expect(m.cleanTitle('Zoomify (Zoom) для Minecraft')).toBe('Zoomify (Zoom)')
    expect(m.cleanTitle('Immortal 3.0.1')).toBe('Immortal 3.0.1')
  })

  test('описание из блоков статьи — markdown для окна материала', () => {
    expect(
      m.blocksToMarkdown([
        { type: 'heading', text: 'Что внутри' },
        { type: 'paragraph', text: 'Текст.' },
        { type: 'list', items: ['раз', 'два'] },
      ]),
    ).toBe('## Что внутри\n\nТекст.\n\n- раз\n- два')
  })

  test('slug и раздел доходят до строки — по ним ставит «Добавить»', () => {
    const h = m.cardToHit(
      {
        slug: 'iris-shaders-dlya-minecraft',
        section: null,
        title: 'Iris Shaders — скачать мод на Fabric',
        summary: 'x',
        cover: null,
        icon: 'https://cdn.millida.trade/i.webp',
        side: null,
        author: 'coderbot',
        downloads: 30,
        sourceDownloads: 170365223,
        versions: [],
        loaders: [],
        categories: ['декор', 'оптимизация', 'утилиты'],
        filesCount: 1,
      },
      'mods',
    )
    expect(h.section).toBe('mods')
    expect(h.pid).toBe('millida:iris-shaders-dlya-minecraft')
    expect(h.dl).toBe(170365223)
    expect(h.cats).toEqual(['декор', 'оптимизация'])
  })
})

// План API → окно зависимостей. Сам материал в окно не идёт, пропажа — с
// объяснением, а план без самого материала — сигнал вернуться к старому пути.
describe('planToDepPlan', () => {
  const f = (slug: string, role: 'primary' | 'required' | 'optional') => ({
    slug,
    title: slug,
    role,
    fileName: slug + '.jar',
    url: 'https://cdn.millida.trade/' + slug + '.jar',
    sha1: 'a'.repeat(40),
    size: 1,
  })

  test('роли расходятся по своим спискам', () => {
    const p = m.planToDepPlan(
      { files: [f('iris', 'primary'), f('sodium', 'required'), f('modmenu', 'optional')], missing: [{ title: 'Kotlin' }, 'Cloth'] },
      'iris',
      'Iris',
    )!
    expect(p.required.map((n) => n.project_id)).toEqual(['sodium'])
    expect(p.optional.map((n) => n.project_id)).toEqual(['modmenu'])
    expect(p.missing.map((n) => n.title)).toEqual(['Kotlin', 'Cloth'])
    expect(p.missing.every((n) => !!n.problem), 'пропажа объясняет, что делать').toBe(true)
  })

  test('сам материал, пришедший как required, — всё равно он', () => {
    const p = m.planToDepPlan({ files: [f('iris', 'required'), f('sodium', 'required')], missing: [] }, 'iris', 'Iris')!
    expect(p.required.map((n) => n.project_id)).toEqual(['sodium'])
  })

  test('без самого материала плана нет — ставим старым путём', () => {
    expect(m.planToDepPlan({ files: [f('sodium', 'required')], missing: [] }, 'iris', 'Iris')).toBeNull()
    expect(m.planToDepPlan({} as never, 'iris', 'Iris')).toBeNull()
  })

  // Так отвечает сам бэкенд: карточка, файл и адрес — тремя ветками, а
  // необязательные зависимости — отдельным списком.
  const api = (slug: string, role: 'root' | 'dependency') => ({
    role,
    project: { slug, section: 'mods', title: slug + ' Mod', icon: 'https://millida.net/i/' + slug + '.png', pageUrl: null, projectRef: null },
    file: {
      id: 'f-' + slug,
      version: '1.20.1',
      versionId: 'v1',
      fileName: slug + '.jar',
      size: 42,
      sha1: 'a'.repeat(40),
      sha512: 'b'.repeat(128),
      gameVersions: ['1.20.1'],
      loaders: ['fabric'],
      releasedAt: null,
    },
    download: { url: 'https://api.millida.net/v2/catalog/files/f-' + slug + '/download', host: 'millida', bundled: true },
    installPath: 'mods',
    requiredBy: [],
    depth: 0,
    pinned: false,
  })

  test('план millida.install-plan/1 разбирается как свой', () => {
    const p = m.planToDepPlan(
      {
        schema: 'millida.install-plan/1',
        files: [api('iris', 'root'), api('sodium', 'dependency')],
        optional: [{ title: 'Mod Menu', file: api('modmenu', 'dependency') }],
        missing: [{ title: 'Fabric Language Kotlin' }],
      } as never,
      'iris',
      'Iris',
    )!
    expect(p, 'вложенный план больше не роняется в откат').not.toBeNull()
    expect(p.required.map((n) => n.project_id)).toEqual(['sodium'])
    expect(p.optional.map((n) => n.project_id)).toEqual(['modmenu'])
    expect(p.required[0].file_name).toBe('sodium.jar')
    expect(p.required[0].size).toBe(42)
    expect(p.missing.map((n) => n.title)).toEqual(['Fabric Language Kotlin'])
  })

  test('необязательная зависимость без файла в план не попадает', () => {
    const p = m.planToDepPlan(
      { files: [api('iris', 'root')], optional: [{ title: 'Нет версии', file: null }], missing: [] } as never,
      'iris',
      'Iris',
    )!
    expect(p.optional).toEqual([])
  })
})

describe('skinTextureUrl', () => {
  test('карточка каталога — файл из /skins/<id>/download', () => {
    expect(m.skinTextureUrl('8f55e8d219558973')).toBe('https://api.millida.net/v2/skins/8f55e8d219558973/download')
    expect(m.skinTextureUrl('u0123456789abcde')).toBe('https://api.millida.net/v2/skins/u0123456789abcde/download')
  })

  test('ник — текущий скин игрока через резолвер голов', () => {
    expect(m.skinTextureUrl('jeb_')).toBe('https://api.millida.net/v2/heads/skin/jeb_')
    expect(m.skinTextureUrl('Notch')).toBe('https://api.millida.net/v2/heads/skin/Notch')
  })

  test('16 hex в верхнем регистре — это ник, а не id карточки', () => {
    expect(m.isCatalogSkinId('8F55E8D219558973')).toBe(false)
  })
})

describe('cfFileIdOf', () => {
  const cases: { why: string; origin: string | null; want: number | null }[] = [
    { why: 'version picked on the site must reach CurseForge as the same file', origin: 'https://edge.forgecdn.net/files/8448/903/DeceasedCraft_Beta_DH_Edition-5.10.17.zip', want: 8448903 },
    { why: 'leading zeros of the second part are part of the id', origin: 'https://mediafilez.forgecdn.net/files/5123/7/pack.zip', want: 5123007 },
    { why: 'a non-forgecdn host must not pin a file', origin: 'https://evil.example/files/8448/903/x.zip', want: null },
    { why: 'plain http is not a CurseForge download', origin: 'http://edge.forgecdn.net/files/8448/903/x.zip', want: null },
    { why: 'no origin means latest file', origin: null, want: null },
  ]
  for (const c of cases) {
    test(c.why, () => {
      expect(m.cfFileIdOf(c.origin), `${c.origin} parsed wrong: ${c.why}`).toBe(c.want)
    })
  }
})
