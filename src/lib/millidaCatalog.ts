import { LAUNCHER_API } from './api'
import type { ModHit } from '../state/mods'
import type { DepNode, DepPlan, Profile } from '../ipc/commands'
import { loaderId } from './format'
import { cachedCatalog } from './catalogCache'
import { cfProxyBackoff, proxyVerdict } from './proxyBackoff'

/// Каталог Millida — библиотека лаунчера (приказ владельца 21.09.2026): то же,
/// что на millida.net/mods, /texture-packs, /modpacks, с тем же поиском и теми же
/// карточками. Экраны ходят сюда, а не в Modrinth и CurseForge: у сайта и
/// лаунчера один каталог, и «Установить» на сайте открывает здесь тот же
/// материал по его slug.
///
/// Чистые функции (разбор ссылки, выбор файла, разметка описания) лежат
/// отдельно от запросов — они покрыты тестами без сети.

export const CATALOG_API = LAUNCHER_API + '/catalog'

/// Разделы, которые сайт шлёт в millida://install/<раздел>/<slug>.
export const INSTALL_SECTIONS = [
  'mods',
  'modpacks',
  'texture-packs',
  'shaders',
  'data-packs',
  'maps',
  'addons',
  'cheats',
  'skins',
  'capes',
] as const

export type InstallSection = (typeof INSTALL_SECTIONS)[number]

/// Раздел каталога → вид контента лаунчера (папка сборки). Скины, плащи и
/// аддоны в сборку не кладутся: первые два идут в гардероб, аддоны — Bedrock.
export const KIND_OF_SECTION: Record<string, string> = {
  mods: 'mod',
  modpacks: 'modpack',
  'texture-packs': 'resourcepack',
  shaders: 'shader',
  'data-packs': 'datapack',
  maps: 'world',
  cheats: 'mod',
}

/// Вкладка экрана «Контент» → раздел каталога.
export const SECTION_OF_KIND: Record<string, string> = {
  modpack: 'modpacks',
  mod: 'mods',
  resourcepack: 'texture-packs',
  datapack: 'data-packs',
  shader: 'shaders',
  world: 'maps',
}

export interface CatalogCard {
  slug: string
  section: string | null
  title: string
  summary: string
  cover: string | null
  icon: string | null
  side: string | null
  launcherOnly?: boolean
  author: string | null
  downloads: number
  sourceDownloads: number
  versions: string[]
  loaders: string[]
  categories: string[]
  filesCount: number
  /// Сборку собрала Милли (ИИ-сборщик); нет поля — старый бэкенд, считаем false.
  aiGenerated?: boolean
  /// Код сборки лаунчера (8 знаков) — ставится тем же путём, что «Сборка по коду».
  packCode?: string | null
}

export interface CatalogListing {
  section: string
  total: number
  page: number
  perPage: number
  pages: number
  items: CatalogCard[]
}

export interface CatalogFacets {
  versions: { value: string; count: number }[]
  loaders: { value: string; count: number }[]
  categories: { value: string; count: number }[]
}

export interface CatalogFile {
  id: string
  version: string
  gameVersions: string[]
  primaryGameVersion: string | null
  loaders: string[]
  fileName: string
  size: number
  sha1: string | null
  /// Файл лежит у нас. Без зеркала резолвер отдаёт страницу автора, а не файл.
  mirrored: boolean
  origin: string | null
  releasedAt: string | null
  downloads: number
}

export interface DescBlock {
  type: string
  text?: string
  items?: string[]
  level?: number
}

export interface CatalogItem {
  slug: string
  type: string
  section: string | null
  title: string
  summary: string
  description: DescBlock[] | string | null
  cover: string | null
  icon: string | null
  side: string | null
  launcherOnly?: boolean
  gallery: string[]
  tags: string[]
  author: string | null
  license: string | null
  sourceUrl: string | null
  /// CurseForge project id the catalog already knows; absent on an older backend.
  curseforgeId?: number | null
  downloads: number
  sourceDownloads: number
  updatedAt: string | null
  /// Статья-хранилище: по её slug адресуется скачивание файла.
  articleSlug: string | null
  files: CatalogFile[]
  /// Сборку собрала Милли (ИИ-сборщик); нет поля — старый бэкенд, считаем false.
  aiGenerated?: boolean
  /// Код сборки лаунчера (8 знаков) — ставится тем же путём, что «Сборка по коду».
  packCode?: string | null
  dependencies?: {
    requires: { kind: string; slug: string | null; section: string | null; title: string }[]
  }
}

/// Готовая сборка каталога (launcherOnly): файл только по подписанной ссылке.
export interface PackView {
  slug: string
  title: string
  summary: string
  version: string
  game: string
  loader: string
  loaderVersion: string
  cover: string | null
  launcherOnly: boolean
  accessRequired: boolean
  accessBuyUrl: string | null
  files: { id: string; side: 'client' | 'server'; version: string; size: number; sha512: string | null; fileName: string }[]
}

export interface CuratedFile {
  id: string
  version: string
  fileName: string
  size: number
  sha256: string
  gameVersions: string[]
  loaders: string[]
}

/// План установки с зависимостями: GET /catalog/items/:slug/resolve?gameVersion=&loader=.
/// Окно плана читает его здесь, а ставит ядро — оно запрашивает план у API
/// заново и никому на слово не верит (engine/content/millida_plan.rs).
export interface ResolveFile {
  slug: string
  title?: string
  section?: string | null
  role: 'primary' | 'required' | 'optional'
  fileId?: string
  version?: string
  fileName: string
  url: string
  sha1?: string | null
  sha512?: string | null
  size?: number
  icon?: string | null
}

export interface ResolvePlan {
  files: ResolveFile[]
  missing: (string | { title?: string; name?: string; slug?: string })[]
  /// Необязательные зависимости план API отдаёт отдельным списком.
  optional?: { file?: unknown }[]
}

/// План API `millida.install-plan/1` раскладывает файл по веткам `project`,
/// `file` и `download`. Приводим его к плоскому виду, которым живёт лаунчер;
/// плоский ответ проходит насквозь.
function flatFile(raw: unknown, forced?: ResolveFile['role']): ResolveFile | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, any>
  const at = (...keys: string[]): any => {
    for (const k of keys) if (f[k] !== undefined && f[k] !== null && f[k] !== '') return f[k]
    for (const sub of ['project', 'file', 'download']) {
      const o = f[sub]
      if (o && typeof o === 'object') for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
    }
    return undefined
  }
  const raw_role = String(f.role || '').toLowerCase()
  const role: ResolveFile['role'] =
    forced || (raw_role === 'root' || raw_role === 'primary' ? 'primary' : raw_role === 'optional' ? 'optional' : 'required')
  const slug = String(at('slug', 'itemSlug') || '')
  if (!slug) return null
  return {
    slug,
    title: at('title', 'name'),
    section: at('section') ?? null,
    role,
    fileId: at('fileId', 'id'),
    version: at('version', 'versionNumber'),
    fileName: String(at('fileName', 'filename') || ''),
    url: String(at('url', 'downloadUrl') || ''),
    sha1: at('sha1') ?? null,
    sha512: at('sha512') ?? null,
    size: Number(at('size') || 0),
    icon: at('icon') ?? null,
  }
}

/// Все файлы плана одним плоским списком: обязательные из `files`,
/// необязательные — из `optional[].file`.
export function planFiles(plan: ResolvePlan): ResolveFile[] {
  const rawReq: unknown[] = Array.isArray(plan && plan.files) ? plan.files : []
  const rawOpt: unknown[] = plan && Array.isArray(plan.optional) ? plan.optional : []
  const req = rawReq.map((f) => flatFile(f))
  const opt = rawOpt.map((o) => flatFile(o && typeof o === 'object' ? (o as any).file : null, 'optional'))
  return [...req, ...opt].filter((f): f is ResolveFile => !!f)
}

/// План → окно зависимостей лаунчера (то же, что у Modrinth-пути). Сам материал
/// в окно не идёт: человек его уже выбрал. `null` — плана по сути нет, и
/// установка идёт прежним путём одного файла.
export function planToDepPlan(plan: ResolvePlan, slug: string, title: string): DepPlan | null {
  const files = planFiles(plan)
  const isPrimary = (f: ResolveFile) => f.role === 'primary' || f.slug === slug
  if (!files.some(isPrimary)) return null
  const node = (f: ResolveFile, relation: string): DepNode => ({
    source: 'millida',
    project_id: f.slug,
    version_id: f.fileId || '',
    title: cleanTitle(f.title || f.slug),
    icon: f.icon || '',
    version_number: f.version || '',
    file_name: f.fileName,
    size: f.size || 0,
    relation,
    required_by: title,
    problem: '',
  })
  const missing = (Array.isArray(plan.missing) ? plan.missing : [])
    .map((m) => (typeof m === 'string' ? m : m.title || m.name || m.slug || ''))
    .filter(Boolean)
    .map((t) => ({ ...node({ slug: t, role: 'required', fileName: '', url: '' }, 'required'), problem: 'нет в каталоге Millida — поставь вручную' }))
  return {
    title,
    version_number: (files.find(isPrimary) || { version: '' }).version || '',
    mismatch: '',
    required: files.filter((f) => !isPrimary(f) && f.role === 'required').map((f) => node(f, 'required')),
    optional: files.filter((f) => !isPrimary(f) && f.role === 'optional').map((f) => node(f, 'optional')),
    missing,
    conflicts: [],
    truncated: false,
  }
}

export interface InstallLink {
  section: InstallSection
  slug: string
  versions: string[]
  loaders: string[]
  /// Скин: подпись в гардеробе (название карточки на сайте) и модель рук.
  name?: string
  slim?: boolean
}

const SKIN_NAME_MAX = 60

/// Подпись скина из ссылки: любая страница может её подставить, поэтому только
/// печатные символы, без переводов строк, и не длиннее карточки на сайте.
export function skinLinkName(raw: string | null): string | undefined {
  const name = (raw || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SKIN_NAME_MAX)
  return name || undefined
}

// Скины адресуются ником (`jeb_`, `Ph1LzA`), поэтому регистр и подчёркивание
// разрешены; точки, слэши и прочее, что могло бы увести запрос в другой путь, — нет.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const VERSION = /^[0-9a-z][0-9a-z.+_-]{0,31}$/i
const LOADER = /^[a-z][a-z0-9_-]{0,23}$/

/// Разбор millida://install/<раздел>/<slug>?version=…&loader=… и старого
/// millida://modpack/<slug>. Ссылку может открыть любая страница, поэтому всё,
/// что не похоже на наш адрес, отбрасывается целиком, а не «чинится».
export function parseInstallLink(action: string, rest: string, q: URLSearchParams): InstallLink | null {
  const parts = rest.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return ''
    }
  })
  let section: string
  let slug: string
  if (action === 'install') {
    if (parts.length !== 2) return null
    ;[section, slug] = parts
  } else if (action === 'modpack') {
    if (parts.length !== 1) return null
    section = 'modpacks'
    slug = parts[0]
  } else {
    return null
  }
  if (!(INSTALL_SECTIONS as readonly string[]).includes(section)) return null
  if (!SLUG.test(slug)) return null
  const uniq = (xs: string[]) => [...new Set(xs)]
  const link: InstallLink = {
    section: section as InstallSection,
    slug,
    versions: uniq(q.getAll('version').map((v) => v.trim()).filter((v) => VERSION.test(v))).slice(0, 8),
    loaders: uniq(q.getAll('loader').map((v) => v.trim().toLowerCase()).filter((v) => LOADER.test(v))).slice(0, 4),
  }
  if (section === 'skins') {
    const name = skinLinkName(q.get('name'))
    if (name) link.name = name
    if (q.get('model') === 'slim') link.slim = true
  }
  return link
}

/// Slug проекта на Modrinth из ссылки на первоисточник карточки. Нужен, когда
/// файла нет на нашем зеркале: тогда тот же файл ставится через Modrinth-путь
/// лаунчера (он и так ходит через наш API и сверяет суммы).
export function modrinthSlugOf(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null
  try {
    const u = new URL(sourceUrl)
    if (u.protocol !== 'https:' || !/^(www\.)?modrinth\.com$/i.test(u.hostname)) return null
    const [type, slug] = u.pathname.split('/').filter(Boolean)
    if (!type || !slug || !SLUG.test(slug)) return null
    return slug
  } catch {
    return null
  }
}

const CF_URL = /curseforge\.com\/minecraft\/(mc-mods|modpacks|texture-packs|shaders|data-packs|worlds)\/([^/?#]+)/i

const CF_CLASS: Record<string, number> = {
  'mc-mods': 6,
  modpacks: 4471,
  'texture-packs': 12,
  shaders: 6552,
  'data-packs': 6945,
  worlds: 17,
}

export interface CfSourceRef {
  classId: number
  slug: string
}

export function cfSourceRef(sourceUrl: string): CfSourceRef | null {
  const m = CF_URL.exec(sourceUrl)
  if (!m) return null
  const classId = CF_CLASS[m[1]!.toLowerCase()]
  return classId ? { classId, slug: decodeURIComponent(m[2]!) } : null
}

const FORGECDN_FILE = /^https:\/\/(?:edge|mediafilez)\.forgecdn\.net\/files\/(\d{1,6})\/(\d{1,3})\//i

/// CurseForge file id from a forgecdn download URL: `files/8448/903/x.zip` is file 8448903.
export function cfFileIdOf(origin: string | null | undefined): number | null {
  const m = origin ? FORGECDN_FILE.exec(origin) : null
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null
}

class CfProxyFailed extends Error {}

/// A failed lookup is remembered by `cfProxyBackoff` and never lands in the answer cache:
/// the same popular pack was asked through a failing proxy by every client in a row.
export async function cfProjectId(ref: CfSourceRef): Promise<number | null> {
  const q = new URLSearchParams({ gameId: '432', classId: String(ref.classId), slug: ref.slug })
  const path = 'v1/mods/search?' + q.toString()
  if (cfProxyBackoff.skipped(path)) return null
  return cachedCatalog('cf:' + path, async () => {
    const r = await fetch(LAUNCHER_API + '/launcher/cf/' + path).catch(() => null)
    cfProxyBackoff.note(path, proxyVerdict(r ? r.status : null, r ? r.headers.get('retry-after') : null))
    if (!r || !r.ok) throw new CfProxyFailed(String(r ? r.status : 'network'))
    const body = (await r.json().catch(() => null)) as { data?: { id?: unknown; slug?: unknown }[] } | null
    if (!body || !Array.isArray(body.data)) throw new CfProxyFailed('body')
    const hit = body.data.find((p) => p && String(p.slug).toLowerCase() === ref.slug.toLowerCase())
    return hit && typeof hit.id === 'number' && hit.id > 0 ? hit.id : null
  }).catch((e: unknown) => {
    if (e instanceof CfProxyFailed) return null
    throw e
  })
}

/// The id stored by the catalog first: searching CurseForge by slug for every card used up the
/// shared CurseForge budget of the backend for all players.
export async function cfProjectOf(item: { curseforgeId?: number | null; sourceUrl: string | null }): Promise<number | null> {
  if (item.curseforgeId && item.curseforgeId > 0) return item.curseforgeId
  const ref = item.sourceUrl ? cfSourceRef(item.sourceUrl) : null
  return ref ? cfProjectId(ref) : null
}

/// Загрузчик имеет смысл только у модов и модпаков: у ресурспака на Modrinth
/// «загрузчик» — это minecraft, у шейдера — iris/optifine.
export const loaderMatters = (kind: string) => kind === 'mod' || kind === 'modpack'

/// Fabric-мод встаёт в Quilt, обратное неверно.
/// Сборка без загрузчика модов не запустит ни один мод.
function loaderFits(fileLoaders: string[], loader: string): boolean {
  if (!loader) return true
  if (loader === 'vanilla') return false
  if (!fileLoaders.length) return true
  if (fileLoaders.includes(loader)) return true
  return loader === 'quilt' && fileLoaders.includes('fabric')
}

export function fileFits(f: CatalogFile, version: string, loader: string, kind: string): boolean {
  if (version && !f.gameVersions.includes(version)) return false
  return !loaderMatters(kind) || loaderFits(f.loaders, loader)
}

/// Файл под сборку: подходящий по версии и загрузчику, из них — лежащий у нас,
/// из равных — свежий (API отдаёт файлы от новой версии игры к старой).
export function pickFile(files: CatalogFile[], version: string, loader: string, kind: string): CatalogFile | null {
  const fit = files.filter((f) => fileFits(f, version, loader, kind))
  return fit.find((f) => f.mirrored) || fit[0] || null
}

/// Сборки, в которые материал встанет без вопросов. Ссылка сайта сужает выбор
/// до версии и загрузчика, под которые человек нажимал «Установить».
export function compatibleBuilds(
  list: Profile[],
  files: CatalogFile[],
  kind: string,
  versions: string[] = [],
  loaders: string[] = [],
): string[] {
  return list
    .filter((p) => {
      const loader = loaderId(p)
      if (versions.length && !versions.includes(p.version)) return false
      if (loaders.length && loaderMatters(kind) && !loaders.includes(loader)) return false
      return files.some((f) => fileFits(f, p.version, loader, kind))
    })
    .map((p) => p.name)
}

/// Какие версии игры у материала вообще есть — для вопроса «ставить всё равно?».
export function knownVersions(files: CatalogFile[], limit = 6): string {
  const seen: string[] = []
  for (const f of files) {
    const v = f.primaryGameVersion || f.gameVersions[0]
    if (v && !seen.includes(v)) seen.push(v)
  }
  return seen.slice(0, limit).join(', ')
}

/// Описание карточки — блоки статьи-хранилища; окно материала рисует markdown.
export function blocksToMarkdown(desc: CatalogItem['description']): string {
  if (!desc) return ''
  if (typeof desc === 'string') return desc
  const out: string[] = []
  for (const b of desc) {
    if (!b) continue
    if (b.type === 'heading' && b.text) out.push('## ' + b.text)
    else if (b.type === 'list' && Array.isArray(b.items)) out.push(b.items.map((i) => '- ' + i).join('\n'))
    else if (b.text) out.push(b.text)
  }
  return out.join('\n\n')
}

/// Заголовок карточки написан под поиск («Iris Shaders — скачать мод на Fabric»,
/// «Zoomify для Minecraft»). В строке лаунчера нужно имя, а не запрос.
export function cleanTitle(title: string): string {
  const t = title
    .replace(/\s+[—–-]\s+скачать(\s.*)?$/i, '')
    .replace(/\s+(для|на)\s+(Minecraft|Майнкрафт)(\s.*)?$/i, '')
    .trim()
  return t || title
}

/// Карточка листинга → строка экрана «Контент». Популярность — у автора: наш
/// счётчик молодой, и «30 скачиваний» у мода со ста миллионами врёт сильнее.
export function cardToHit(c: CatalogCard, section: string): ModHit {
  return {
    title: cleanTitle(c.title),
    author: c.author || 'Millida',
    desc: (c.summary || '').slice(0, 120),
    dl: Math.max(c.downloads || 0, c.sourceDownloads || 0),
    icon: c.icon || c.cover || undefined,
    cats: (c.categories || []).slice(0, 2),
    slug: c.slug,
    pid: 'millida:' + c.slug,
    section: c.section || section,
    // Готовая сборка лаунчера (FreshCraft, Lost Souls…) ставится своим путём
    // ядра — install_catalog_pack: подписанная ссылка, ключ доступа, миры игрока.
    packSlug: c.launcherOnly ? c.slug : undefined,
  }
}

/// Адрес карточки на сайте — туда уходит всё, что лаунчер сам поставить не может.
export const sitePage = (section: string, slug: string) =>
  'https://millida.net/' + section + '/' + encodeURIComponent(slug)

function qs(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
  return q.toString()
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (r.status === 404) throw new Error('not-found')
  if (!r.ok) throw new Error('http ' + r.status)
  return r.json() as Promise<T>
}

export const CATALOG_PAGE = 24

export const catalog = {
  listing: (p: {
    section: string
    version?: string
    loader?: string
    category?: string
    q?: string
    sort?: 'popular' | 'new'
    page?: number
  }) =>
    getJson<CatalogListing>(
      CATALOG_API +
        '/listing?' +
        qs({
          section: p.section,
          version: p.version,
          loader: p.loader,
          category: p.category,
          q: p.q,
          sort: p.sort,
          page: p.page && p.page > 1 ? p.page : null,
          perPage: CATALOG_PAGE,
        }),
    ),
  facets: (section: string) => getJson<CatalogFacets>(CATALOG_API + '/facets?' + qs({ section })),
  item: (slug: string) => getJson<CatalogItem>(CATALOG_API + '/items/' + encodeURIComponent(slug)),
  resolve: (slug: string, gameVersion: string, loader: string) =>
    getJson<ResolvePlan>(
      CATALOG_API + '/items/' + encodeURIComponent(slug) + '/resolve?' + qs({ gameVersion, loader }),
    ),
  pack: (slug: string) => getJson<PackView>(CATALOG_API + '/packs/' + encodeURIComponent(slug)),
  curated: async (section: 'cheats' | 'addons', slug: string): Promise<CuratedFile[]> => {
    const d = await getJson<{ items?: { slug: string; files: CuratedFile[] }[] }>(CATALOG_API + '/curated/' + section)
    const hit = (d.items || []).find((i) => i.slug === slug)
    return hit ? hit.files : []
  },
}

/// Id карточки каталога скинов сайта (/skins/katalog/<id>): 16 hex хеша текстуры
/// или `u` и 15 hex у авторской загрузки. Всё остальное в ссылке — ник игрока.
const CATALOG_SKIN_ID = /^(?:[0-9a-f]{16}|u[0-9a-f]{15})$/

export const isCatalogSkinId = (slug: string) => CATALOG_SKIN_ID.test(slug)

/// Скин по нику — текущий скин игрока (тот же резолвер, что рисует головы).
export const nickSkinTextureUrl = (nick: string) => LAUNCHER_API + '/heads/skin/' + encodeURIComponent(nick)

/// PNG скина для гардероба: карточка каталога отдаёт файл сама, ник — через резолвер голов.
export const skinTextureUrl = (slug: string) =>
  isCatalogSkinId(slug) ? LAUNCHER_API + '/skins/' + slug + '/download' : nickSkinTextureUrl(slug)
