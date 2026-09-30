/*
 * Страница материала каталога в лаунчере (владелец 30.09.2026: «любой пак,
 * любой ресурс должен открываться — у каждого своя страница: установить,
 * версии, описание, галерея»). Здесь — чистая логика страницы: выбор версии и
 * загрузчика, заглушка обложки, справка по читам. Без React и сети — под тесты.
 */

/** Файл материала в том виде, в каком его рисует страница (Millida, Modrinth, CurseForge, читы). */
export interface VerFile {
  id: string
  name: string
  gameVersions: string[]
  loaders: string[]
  size: number
  date: string | null
}

const RELEASE = /^\d+(?:\.\d+)+$/

/** Сравнение версий игры «от новой к старой»: 26.2 > 1.21.10 > 1.21.9; снапшоты — в конец. */
export function cmpGameVersion(a: string, b: string): number {
  const ra = RELEASE.test(a)
  const rb = RELEASE.test(b)
  if (ra !== rb) return ra ? -1 : 1
  if (!ra) return b.localeCompare(a)
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d) return d
  }
  return 0
}

/** Версии игры, под которые есть файлы: только релизы, если они есть, от новой к старой. */
export function versionOptions(files: VerFile[]): string[] {
  const all = [...new Set(files.flatMap((f) => f.gameVersions))]
  const rel = all.filter((v) => RELEASE.test(v))
  return (rel.length ? rel : all).sort(cmpGameVersion)
}

/** Загрузчики у файлов под эту версию (или у всех файлов, если версия не выбрана). */
export function loaderOptions(files: VerFile[], version: string | null): string[] {
  const fit = version ? files.filter((f) => f.gameVersions.includes(version)) : files
  return [...new Set(fit.flatMap((f) => f.loaders))].filter((l) => l && l !== 'minecraft')
}

/** Файлы под выбор: версия и загрузчик сужают список; пусто — значит, всё. */
export function filesFor(files: VerFile[], version: string | null, loader: string | null): VerFile[] {
  return files.filter(
    (f) => (!version || f.gameVersions.includes(version)) && (!loader || !f.loaders.length || f.loaders.includes(loader)),
  )
}

/**
 * Что выбрать при входе: версию и загрузчик сборки, в которую ставим, — если
 * под неё есть файл; иначе самую свежую версию и её первый загрузчик.
 */
export function defaultPick(files: VerFile[], build?: { version: string; loader: string } | null): { version: string | null; loader: string | null } {
  const vers = versionOptions(files)
  if (build && vers.includes(build.version)) {
    const ls = loaderOptions(files, build.version)
    if (!ls.length) return { version: build.version, loader: null }
    if (ls.includes(build.loader)) return { version: build.version, loader: build.loader }
  }
  const version = vers[0] || null
  const ls = loaderOptions(files, version)
  return { version, loader: build && ls.includes(build.loader) ? build.loader : ls[0] || null }
}

/** «1.16 — 26.2» по списку версий в любом порядке. */
export function spanOf(versions: string[]): string | null {
  const rel = versions.filter((v) => RELEASE.test(v))
  const list = (rel.length ? rel : versions).slice().sort(cmpGameVersion)
  if (!list.length) return null
  const newest = list[0]!
  const oldest = list[list.length - 1]!
  return newest === oldest ? newest : oldest + ' — ' + newest
}

/** «2,4 МБ» — размер файла коротко. */
export function sizeLabel(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' КБ'
  const mb = bytes / (1024 * 1024)
  return (mb >= 100 ? Math.round(mb).toString() : mb.toFixed(1).replace('.', ',')) + ' МБ'
}

/* ── Заглушка обложки: блок Minecraft на цвете раздела ─────────────── */

/** FNV-1a — одна и та же строка всегда даёт один и тот же блок. */
export function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Рендеры блоков Millida (`public/block-icons`), которые читаются на тёмном
 * фоне: без стекла-контура (11) и почти чёрных (4, 24).
 */
export const FALLBACK_BLOCKS = [1, 3, 5, 6, 7, 8, 9, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 26, 27, 28, 32, 33, 34, 36, 37, 38, 40, 42, 43, 44, 47, 48, 51, 52, 53, 54]

export const blockFor = (key: string): number => FALLBACK_BLOCKS[hashOf(key) % FALLBACK_BLOCKS.length]!

/** Тёмные подложки заглушки сервера — цвет от имени, как у плиток рейтинга. */
export const SERVER_TINTS = ['#2f5d3a', '#3b4f7a', '#6a3f7a', '#7a4a2f', '#2f6a6a', '#7a3f4f', '#5a5a2f', '#3f3f6a']

export const serverTint = (key: string): string => SERVER_TINTS[hashOf(key) % SERVER_TINTS.length]!

/* ── Читы: справка к кураторскому разделу ───────────────────────────
 * У `/catalog/curated/cheats` в ответе только slug и файлы. Название,
 * описание и официальный сайт — из редакционного справочника сайта
 * (`millida-web/src/lib/forum-cheats.ts`, сверка 11.09.2026), только
 * клиенты, чьи файлы лежат в кураторском разделе.
 */

export interface CheatInfo {
  name: string
  kind: string
  summary: string
  features: string[]
  tags: string[]
  officialUrl: string
}

export const CHEATS: Record<string, CheatInfo> = {
  wurst: {
    name: 'Wurst Client',
    kind: 'Мод под Fabric',
    summary:
      'Один из самых известных открытых чит-клиентов, обновляется почти каждую неделю под свежие версии игры. Ставится как обычный мод Fabric рядом с другими модами. Держит очень широкий набор функций — от X-Ray до автостроительства — и подходит скорее для одиночной игры и экспериментов, чем для современных анархий с сильным античитом.',
    features: ['X-Ray', 'Полёт и скорость', 'Автоатака и Killaura', 'AutoBuild и Nuker', 'Более 200 модулей'],
    tags: ['Открытый код', 'Fabric', 'Универсальный'],
    officialUrl: 'https://www.wurstclient.net/',
  },
  'meteor-client': {
    name: 'Meteor Client',
    kind: 'Мод под Fabric',
    summary:
      'Открытый утилитарный клиент под свежие версии Fabric, ставший заменой Impact и SalHack для игроков анархий вроде 2b2t. Тесно дружит с Baritone (автопоиск пути и автодобыча). Активно поддерживается сообществом, поэтому быстро выходит под новые версии игры.',
    features: ['Совместимость с Baritone', 'ESP и трейсеры', 'Авто-тоталы (Crystal PvP)', 'Дюп-хелперы', 'Гибкий модуль-менеджер'],
    tags: ['Открытый код', 'Fabric', 'Анархия', 'Утилита'],
    officialUrl: 'https://meteorclient.com/',
  },
  baritone: {
    name: 'Baritone',
    kind: 'Мод-утилита (Forge / Fabric)',
    summary:
      'Строго говоря, не чит, а система автопилота: Baritone умеет сам прокладывать путь по миру, копать заданную руду и идти к координатам. Его встраивают в другие клиенты (Impact, Meteor) или подключают отдельным модом. Полезен и в честной одиночной игре — например для автоматической добычи ресурсов.',
    features: ['Автопоиск пути', 'Автодобыча руды', 'Следование за координатами', 'Автостроительство по схеме'],
    tags: ['Открытый код', 'Утилита', 'Автопилот'],
    officialUrl: 'https://github.com/cabaletta/baritone',
  },
  liquidbounce: {
    name: 'LiquidBounce',
    kind: 'Клиент / мод (Fabric / Forge)',
    summary:
      'Бесплатный открытый клиент на базе mixin от команды CCBlueX, известный акцентом на обходы античитов и настройку под конкретные сервера. Поддерживает как старые версии (1.8), так и современные. Есть отдельный лаунчер LiquidLauncher для запуска.',
    features: ['Обходы античитов (bypass)', 'KillAura и Velocity', 'Scaffold и Speed', 'Скриптовый API на модули', 'Собственный лаунчер'],
    tags: ['Открытый код', 'PvP', 'Bypass'],
    officialUrl: 'https://liquidbounce.net/',
  },
  'kami-blue': {
    name: 'KAMI Blue',
    kind: 'Мод под Forge',
    summary:
      'Открытый утилитарный клиент под 1.12.2, выросший из оригинального KAMI и популярный на 2b2t. Официально архивирован (разработка остановлена), но исходники и релизы остаются доступны на GitHub, а код лёг в основу многих более новых проектов.',
    features: ['Инструменты для анархий', 'Автодобыча с Baritone', 'ESP и трейсеры', 'Командный интерфейс'],
    tags: ['Открытый код', '1.12.2', 'Анархия', 'Архив'],
    officialUrl: 'https://github.com/kami-blue/client',
  },
  forgehax: {
    name: 'ForgeHax',
    kind: 'Мод под Forge',
    summary:
      'Открытый Forge-мод для продвинутых пользователей: настраивается почти целиком командами, без удобного меню. Прославился генератором книг (дюп- и бан-книги на анархиях). Скорее инструмент для тех, кто понимает, что делает, чем клиент «поставил и играешь».',
    features: ['Управление командами (без GUI)', 'Book Writer (генерация книг)', 'Автодобыча', 'ESP'],
    tags: ['Открытый код', '1.12.2', 'Утилита'],
    officialUrl: 'https://github.com/fr1kin/ForgeHax',
  },
  bleachhack: {
    name: 'BleachHack',
    kind: 'Мод под Fabric',
    summary:
      'Открытый бесплатный клиент под Fabric с чистым интерфейсом и набором стандартных модулей. Актуален для версий 1.14–1.17; на более свежих версиях сообщество перешло на другие проекты. Хороший пример аккуратного open-source клиента.',
    features: ['Модульная система', 'ESP и трейсеры', 'Автоатака', 'Совместимость с Baritone'],
    tags: ['Открытый код', 'Fabric'],
    officialUrl: 'https://github.com/BleachDrinker420/BleachHack',
  },
}

/** Имя чита: из справочника, иначе — из slug («kami-blue» → «Kami Blue»). */
export function cheatName(slug: string): string {
  const known = CHEATS[slug]
  if (known) return known.name
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Описание материала — markdown для `renderMarkdown`: читам — описание и список функций. */
export function cheatBody(slug: string): string {
  const c = CHEATS[slug]
  if (!c) return ''
  return c.summary + '\n\n## Что умеет\n\n' + c.features.map((f) => '- ' + f).join('\n')
}
