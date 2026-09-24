import { realDownloads } from '../../lib/realDownloads'
import { MODRINTH_API, api, mirrorAsset } from '../../lib/api'
import type { PremiumPack } from '../../lib/premium'
import { hasTauri } from '../../ipc/tauri'
import { millidaPacks } from '../../ipc/commands'
import type { MillidaPack } from '../../ipc/commands'
import { toCard } from '../../state/servers'
import type { RatingServer } from '../../state/servers'
import type { SnapshotServer } from '../../lib/snapshot'

/**
 * Каталог режимов «Во что играем». Серверный режим — не сервер, а занятие:
 * человек выбирает BedWars, а сервер под него — уже внутри режима, как
 * плейлист в Fortnite (docs/audit: analysis/2026-09-23_launcher-lobby-research).
 *
 * Список режимов — категории рейтинга, которые API фильтрует (проверено
 * 23.09.2026: неизвестная категория молча отдаёт весь рейтинг, поэтому сюда
 * попадают только проверенные коды).
 */
export interface ServerModeDef {
  cat: string
  title: string
  /** Воксельный блок Millida (public/block-icons) — лицо режима. */
  block: number
  /** Цвет подложки карточки: у каждого режима свой, как у событий Brawl Stars. */
  color: string
}

// Баннеры серверов для лица режима не годятся: это реклама конкретного
// проекта с надписями, и один баннер попадал сразу в несколько режимов.
// Поэтому у режима своё лицо — блок и цвет, баннеры остаются в списке серверов.
export const SERVER_MODES: ServerModeDef[] = [
  { cat: 'BEDWARS', title: 'BedWars', block: 26, color: '#9e2328' },
  { cat: 'SKYWARS', title: 'SkyWars', block: 20, color: '#1f7fa6' },
  { cat: 'SKYBLOCK', title: 'SkyBlock', block: 43, color: '#3d7f2a' },
  { cat: 'ANARCHY', title: 'Анархия', block: 23, color: '#3a2468' },
  { cat: 'ONEBLOCK', title: 'OneBlock', block: 48, color: '#7a5528' },
  { cat: 'LIFESTEAL', title: 'LifeSteal', block: 6, color: '#86203a' },
  { cat: 'BOXPVP', title: 'BoxPvP', block: 15, color: '#245f7d' },
  { cat: 'PRISON', title: 'Тюрьма', block: 30, color: '#34404f' },
  { cat: 'MINIGAMES', title: 'Мини-игры', block: 2, color: '#6d3a85' },
  { cat: 'SURVIVAL', title: 'Выживание', block: 51, color: '#5e4125' },
  { cat: 'PVP', title: 'PvP', block: 16, color: '#6b2424' },
  { cat: 'GRIEF', title: 'Гриф', block: 27, color: '#a2500f' },
  { cat: 'FACTIONS', title: 'Кланы', block: 45, color: '#434950' },
  { cat: 'MMORPG', title: 'РПГ', block: 52, color: '#654322' },
  { cat: 'HARDCORE', title: 'Хардкор', block: 4, color: '#231d31' },
  { cat: 'CREATIVE', title: 'Креатив', block: 28, color: '#852680' },
  { cat: 'PARKOUR', title: 'Паркур', block: 7, color: '#4f7f1b' },
  { cat: 'LUCKY', title: 'Лаки-блоки', block: 1, color: '#a3830f' },
  { cat: 'VANILLA', title: 'Ванилла', block: 32, color: '#1d7d37' },
]

export const blockArt = (n: number) => '/block-icons/Block' + n + 'Millida.png'

export interface ModeStats {
  total: number
  online: number
  banner: string | null
  servers: SnapshotServer[]
}

/** Серверов на режим: верх по онлайну. Дальше — вкладка «Серверы». */
const MODE_LIMIT = 30

const statsCache = new Map<string, Promise<ModeStats | null>>()

export function loadMode(cat: string): Promise<ModeStats | null> {
  const hit = statsCache.get(cat)
  if (hit) return hit
  const asked = api<{ servers?: RatingServer[]; total?: number }>(
    '/rating/servers?limit=' + MODE_LIMIT + '&offset=0&sort=online&category=' + cat,
  )
    .then((r) => {
      const raw = Array.isArray(r.servers) ? r.servers : []
      // Рейтинг собран из нескольких мониторингов, и один проект приходит
      // строкой на каждый адрес (MLegacy — трижды). Оставляем самую живую.
      const best = new Map<string, SnapshotServer>()
      for (const card of raw.map((s, i) => toCard(s, i + 1))) {
        const key = card.name.trim().toLowerCase()
        const had = best.get(key)
        if (!had || card.online > had.online) best.set(key, card)
      }
      const servers = [...best.values()].sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || b.online - a.online)
      const withBanner = raw.find((s) => !!s.bannerUrl)
      return {
        total: typeof r.total === 'number' ? r.total : servers.length,
        online: servers.reduce((sum, s) => sum + (s.isOnline ? s.online : 0), 0),
        banner: withBanner ? withBanner.bannerUrl || null : null,
        servers,
      }
    })
    .catch((e) => {
      console.error('[playhub] mode', cat, e)
      statsCache.delete(cat)
      return null
    })
  statsCache.set(cat, asked)
  return asked
}

/**
 * Режимы — только те, что реально есть в рейтинге Millida (правка владельца
 * 23.09.2026, 19:42: «никаких выдуманных режимов»). Коды берутся из самого
 * рейтинга (поле `categories` у серверов первых страниц) плюс известные коды
 * экрана «Серверы»; каждый проверяется запросом. Рейтинг на неизвестный код
 * молча отдаёт весь список, поэтому код без собственной выдачи (столько же
 * серверов, сколько во всём рейтинге) или без серверов отбрасывается.
 */
export interface LiveMode {
  def: ServerModeDef
  stats: ModeStats
}

/** Названия кодов, которых нет в SERVER_MODES: из рейтинга (state/servers). */
const EXTRA_TITLES: Record<string, string> = {
  ROLEPLAY: 'RP',
  TECHNIC: 'Техно',
  ADVENTURE: 'Приключения',
  ECONOMY: 'Экономика',
  MODDED: 'Моды',
  OTHER: 'Разное',
  RP: 'RP',
  HIDE_SEEK: 'Прятки',
  KITPVP: 'KitPvP',
  BUILD_BATTLE: 'Build Battle',
  TECHNICAL: 'Техно',
  SPLEEF: 'Spleef',
  UHC: 'UHC',
  TNTRUN: 'TNT Run',
  HUNGER_GAMES: 'Голодные игры',
  TOWNY: 'Towny',
}
const EXTRA_LOOK: [number, string][] = [
  [12, '#1d5e5a'],
  [40, '#3b3350'],
  [22, '#4a2266'],
  [9, '#7a3b22'],
  [37, '#155f6b'],
  [53, '#4a3a3a'],
]

function modeDef(code: string, i: number): ServerModeDef {
  const known = SERVER_MODES.find((d) => d.cat === code)
  if (known) return known
  const [block, color] = EXTRA_LOOK[i % EXTRA_LOOK.length]!
  const title =
    EXTRA_TITLES[code] || code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ')
  return { cat: code, title, block, color }
}

let modesCache: Promise<LiveMode[]> | null = null
export function loadLiveModes(): Promise<LiveMode[]> {
  if (modesCache) return modesCache
  modesCache = (async () => {
    const pages = await Promise.all(
      [0, 30, 60].map((off) =>
        api<{ servers?: RatingServer[]; total?: number }>('/rating/servers?limit=30&offset=' + off + '&sort=rating').catch(
          () => null,
        ),
      ),
    )
    const all = pages.find((p) => p && typeof p.total === 'number')?.total ?? null
    const seen = new Set<string>()
    for (const p of pages) for (const s of (p && p.servers) || []) for (const c of s.categories || []) seen.add(c)
    const codes = [...new Set([...SERVER_MODES.map((d) => d.cat), ...Object.keys(EXTRA_TITLES), ...seen])].filter(
      (c) => /^[A-Z_]{2,24}$/.test(c) && c !== 'OTHER',
    )
    const rows = await Promise.all(codes.map((c, i) => loadMode(c).then((st) => ({ c, i, st }))))
    const out: LiveMode[] = []
    for (const r of rows) {
      if (!r.st || !r.st.servers.length) continue
      if (all !== null && r.st.total >= all) continue
      out.push({ def: modeDef(r.c, r.i), stats: r.st })
    }
    if (!out.length) modesCache = null
    return out.sort((a, b) => b.stats.online - a.stats.online)
  })()
  return modesCache
}

/**
 * Лента серверов рейтинга: страница за страницей в порядке рейтинга, без
 * дублей одного проекта по имени (рейтинг собран из нескольких мониторингов).
 */
export async function loadFeedPage(
  offset: number,
  category?: string,
  search?: string,
): Promise<{ servers: SnapshotServer[]; total: number }> {
  const q = new URLSearchParams({ limit: '30', offset: String(offset), sort: 'rating' })
  if (category) q.set('category', category)
  if (search) q.set('search', search.slice(0, 60))
  const r = await api<{ servers?: RatingServer[]; total?: number }>('/rating/servers?' + q.toString())
  const raw = Array.isArray(r.servers) ? r.servers : []
  return {
    servers: raw.map((s, i) => toCard(s, offset + i + 1)),
    total: typeof r.total === 'number' ? r.total : offset + raw.length,
  }
}

/** Наш каталог сборок: в приложении — своя команда, в браузере — тот же адрес. */
let packsCache: Promise<MillidaPack[]> | null = null
export function loadCatalogPacks(): Promise<MillidaPack[]> {
  if (!packsCache)
    packsCache = (hasTauri() ? millidaPacks() : api<MillidaPack[]>('/catalog/packs'))
      .then((l) => (Array.isArray(l) ? l.map((p) => ({ ...p, downloads: realDownloads(p.slug, p.downloads) ?? p.downloads })) : []))
      .catch((e) => {
        console.error('[playhub] packs', e)
        packsCache = null
        return []
      })
  return packsCache
}

/**
 * Полка «Minecraft»: версии без сборки, каждая — одна сборка «Minecraft X»
 * на Fabric + FPS-моды. Состав — 10 версий по запускам лаунчера за 30 дней
 * (замер аналитика 23.09.2026, 93 % всех запусков), порядок — от новой к
 * старой (приказ владельца 23.09.2026, 18:32).
 */
export const VERSION_SHELF: string[] = ['26.3', '26.2', '26.1.2', '1.21.11', '1.21.4', '1.21.1', '1.20.1', '1.19.2', '1.16.5', '1.12.2']

export function playVersions(): string[] {
  return VERSION_SHELF
}

/**
 * «Все» у полки Minecraft: все релизы из списка Mojang, который лаунчер уже
 * держит в кэше (state/mcVersions). Без кэша (браузер) — только полка.
 */
export function allVersions(): string[] {
  let list: string[] = []
  try {
    const raw = JSON.parse(localStorage.getItem('m-mc-releases') || '[]') as unknown
    if (Array.isArray(raw)) list = raw.filter((v): v is string => typeof v === 'string' && /^\d+\.\d+(\.\d+)?$/.test(v))
  } catch {}
  const rest = list.filter((v) => !VERSION_SHELF.includes(v))
  return [...VERSION_SHELF, ...rest]
}

/** Фон карточки версии без своего арта: обои лаунчера по кругу. */
export const versionArt = (i: number) => '/bg/bg' + ((i % 4) + 1) + '.jpg'

/**
 * Обложка версии — официальный key art её обновления Mojang (приказ
 * владельца 23.09.2026, 18:41: «как в EasyLauncher/TLauncher»). Файлы —
 * public/versions/<версия>.webp 640×360 для карточки и @2x 1280×720 для
 * героя, пересжаты из оригиналов minecraft.wiki (страницы обновлений,
 * «Key Art»); оригиналы — Работа/Проекты/millida/cache/2026-09/version-key-art.
 * Официальный лаунчер Mojang показывает ту же картинку в «Новостях патча»
 * (launchercontent.mojang.com/v2/javaPatchNotes.json), но там квадраты 540 px.
 */
export const VERSION_ART: Record<string, { update: string; src: string }> = {
  '26.3': { update: 'Wilderness Bound', src: 'https://minecraft.wiki/images/Wilderness_Bound_Key_Art.png' },
  '26.2': { update: 'Chaos Cubed', src: 'https://minecraft.wiki/images/Chaos_Cubed_Key_Art.png' },
  '26.1.2': { update: 'Tiny Takeover', src: 'https://minecraft.wiki/images/Tiny_Takeover_Key_Art.png' },
  '1.21.11': { update: 'Mounts of Mayhem', src: 'https://minecraft.wiki/images/Mounts_of_Mayhem_Key_Art.png' },
  '1.21.4': { update: 'The Garden Awakens', src: 'https://minecraft.wiki/images/The_Garden_Awakens_Key_Art.png' },
  '1.21.1': { update: 'Tricky Trials', src: 'https://minecraft.wiki/images/Tricky_Trials_Key_Art.png' },
  '1.20.1': { update: 'Trails & Tales', src: 'https://minecraft.wiki/images/Trails_%26_Tales_key_art.png' },
  '1.19.2': { update: 'The Wild Update', src: 'https://minecraft.wiki/images/Wild_key_art.png' },
  '1.16.5': { update: 'Nether Update', src: 'https://minecraft.wiki/images/NetherUpdateArtwork.png' },
  '1.12.2': { update: 'World of Color', src: 'https://minecraft.wiki/images/World_of_Color_Update.png' },
}

/** Картинка версии: свой арт обновления или обои лаунчера. `big` — для героя. */
export function versionCover(version: string, i: number, big?: boolean): string {
  return VERSION_ART[version] ? '/versions/' + version + (big ? '@2x' : '') + '.webp' : versionArt(i)
}

/** Живые серверы из рейтинга: без дублей одного проекта, по онлайну. */
function uniqueByName(raw: RatingServer[]): SnapshotServer[] {
  const best = new Map<string, SnapshotServer>()
  for (const card of raw.map((s, i) => toCard(s, i + 1))) {
    const key = card.name.trim().toLowerCase()
    const had = best.get(key)
    if (!had || card.online > had.online) best.set(key, card)
  }
  return [...best.values()].sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || b.online - a.online)
}

let topCache: Promise<SnapshotServer[]> | null = null
/** Верх рейтинга по онлайну — «Все серверы» под режимами. */
export function loadTopServers(): Promise<SnapshotServer[]> {
  if (!topCache)
    topCache = api<{ servers?: RatingServer[] }>('/rating/servers?limit=40&offset=0&sort=online')
      .then((r) => uniqueByName(Array.isArray(r.servers) ? r.servers : []).slice(0, 12))
      .catch((e) => {
        console.error('[playhub] top', e)
        topCache = null
        return []
      })
  return topCache
}

/**
 * Сервер сборки: рейтинг не связывает сервер со сборкой полем, поэтому ищем
 * по имени сборки без номера версии («Arcania 1.4.3» → «Arcania») и берём
 * только точное совпадение имени — чужой сервер со словом в названии хуже,
 * чем никакого.
 */
const packServerCache = new Map<string, Promise<SnapshotServer | null>>()
export function loadPackServer(title: string): Promise<SnapshotServer | null> {
  const name = title.replace(/\s+v?\d[\d.]*.*$/i, '').trim()
  if (name.length < 3) return Promise.resolve(null)
  const hit = packServerCache.get(name)
  if (hit) return hit
  const asked = api<{ servers?: RatingServer[] }>(
    '/rating/servers?limit=10&offset=0&sort=online&search=' + encodeURIComponent(name.slice(0, 60)),
  )
    .then((r) => {
      const list = uniqueByName(Array.isArray(r.servers) ? r.servers : [])
      return list.find((s) => s.name.trim().toLowerCase() === name.toLowerCase()) || null
    })
    .catch(() => null)
  packServerCache.set(name, asked)
  return asked
}

/**
 * Сервер OneBlock — партнёрский (приказ владельца 23.09.2026). На экране он
 * НИКАК не подписан как наш: ни «Сервер Millida», ни «наш» — просто самый
 * красивый баннер первой карточкой «Режимов». Имя, адрес и версии владелец
 * даст позже; пока адреса нет, «Играть» открывает серверы режима ONEBLOCK.
 */
export const OWN_SERVER: {
  name: string
  ip: string
  /** Слаг в рейтинге — для живого онлайна. */
  slug: string
  mode: string
  versions: string[]
  licensed: boolean
} = {
  name: 'OneBlock',
  ip: '',
  slug: '',
  mode: 'ONEBLOCK',
  versions: [],
  licensed: false,
}

/**
 * Сборка на полке и на своей странице. Источник решает, откуда брать
 * страницу и как ставить: наш каталог (в том числе платные) или Modrinth.
 */
export type HubPack = PremiumPack & {
  premium: boolean
  origin: 'millida' | 'modrinth'
  /** Modrinth: запускается на сервере (server_side не unsupported). */
  serverOk?: boolean
}

interface MrHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  categories: string[]
  versions: string[]
  downloads: number
  icon_url?: string | null
  featured_gallery?: string | null
  gallery?: string[]
  server_side?: string
}

const MR_LOADERS: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }

let mrCache: Promise<HubPack[]> | null = null
/**
 * Топ сборок Modrinth по скачиваниям — тот же поиск, что у экрана каталога,
 * но только под живые версии (1.19+ и 26.x): старые 1.12-сборки с десятками
 * миллионов скачиваний иначе заняли бы всю полку.
 */
const MR_FRESH = ['26.3', '26.2', '26.1.2', '1.21.11', '1.21.4', '1.21.1', '1.20.1', '1.19.2']
export function loadModrinthPacks(): Promise<HubPack[]> {
  if (!mrCache)
    mrCache = fetch(
      MODRINTH_API +
        '/v2/search?limit=24&offset=0&index=downloads&facets=' +
        encodeURIComponent(JSON.stringify([['project_type:modpack'], MR_FRESH.map((v) => 'versions:' + v)])),
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((r: { hits?: MrHit[] }) =>
        (r.hits || []).map((h): HubPack => {
          const loader = h.categories.find((c) => c in MR_LOADERS)
          return {
            id: 'mr:' + h.slug,
            slug: h.slug,
            title: h.title,
            tagline: h.description || null,
            coverUrl: mirrorAsset(h.featured_gallery || (h.gallery && h.gallery[0]) || h.icon_url) || null,
            mcVersion: h.versions.length ? h.versions[h.versions.length - 1]! : null,
            loader: loader ? MR_LOADERS[loader]! : null,
            downloads: h.downloads,
            author: h.author || null,
            premium: false,
            origin: 'modrinth',
            serverOk: h.server_side !== 'unsupported',
          }
        }),
      )
      .catch((e) => {
        console.error('[playhub] modrinth', e)
        mrCache = null
        return []
      })
  return mrCache
}

/** Сборка, которую хостинг Millida ставит на сервер целиком (GET /hosting/packs). */
export interface HostingPack {
  key: string
  name: string
  core: string
  version: string
  minRamMb: number
  paidOnly: boolean
  requireKey: boolean
}

let hpCache: Promise<HostingPack[]> | null = null
export function loadHostingPacks(): Promise<HostingPack[]> {
  if (!hpCache)
    hpCache = api<HostingPack[]>('/hosting/packs')
      .then((l) => (Array.isArray(l) ? l : []))
      .catch(() => {
        hpCache = null
        return []
      })
  return hpCache
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+v?\d[\d.]*.*$/, '')
    .replace(/-\d+$/, '')
    .replace(/[^a-z0-9]/g, '')
const initials = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')

/**
 * Серверная версия нашей сборки на хостинге. Каталог и хостинг заводят
 * сборки независимо, общего поля нет — сверяем ключ со слагом без номера
 * («lost-souls-2» → «lost-souls»), с названием и с аббревиатурой
 * («dotg» → «Dominion over the Gods»).
 */
export function hostingPackFor(p: { slug?: string | null; title: string }, list: HostingPack[]): HostingPack | null {
  const slug = norm(p.slug || '')
  const title = norm(p.title)
  return (
    list.find((h) => {
      const k = norm(h.key)
      const n = norm(h.name)
      return (slug && (k === slug || n === slug || initials(h.name) === slug)) || k === title || n === title
    }) || null
  )
}

/** Мод Modrinth для карточки «Мод дня». */
export interface HubMod {
  slug: string
  title: string
  icon: string | null
  cover: string | null
  downloads: number
  loaders: string[]
}

let modsCache: Promise<HubMod[]> | null = null
/**
 * Топ модов Modrinth по скачиваниям под живые версии — из него «Сегодня»
 * берёт мод дня. Тот же поиск, что у каталога, только 40 первых.
 */
export function loadTopMods(): Promise<HubMod[]> {
  if (!modsCache)
    modsCache = fetch(
      MODRINTH_API +
        '/v2/search?limit=100&offset=0&index=downloads&facets=' +
        encodeURIComponent(JSON.stringify([['project_type:mod'], MR_FRESH.map((v) => 'versions:' + v)])),
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((r: { hits?: MrHit[] }) =>
        (r.hits || [])
          // Библиотеки (API, Placeholder, Config) — не «мод дня»: сами по себе
          // игроку ничего не дают. Без обложки тоже не показываем.
          .filter((h) => !h.categories.includes('library') && !/\b(api|lib|library|config)\b/i.test(h.title))
          .filter((h) => h.featured_gallery || (h.gallery && h.gallery[0]))
          .map(
          (h): HubMod => ({
            slug: h.slug,
            title: h.title,
            icon: mirrorAsset(h.icon_url) || null,
            cover: mirrorAsset(h.featured_gallery || (h.gallery && h.gallery[0])) || null,
            downloads: h.downloads,
            loaders: h.categories.filter((c) => c in MR_LOADERS).map((c) => MR_LOADERS[c]!),
          }),
        ),
      )
      .catch((e) => {
        console.error('[playhub] mods', e)
        modsCache = null
        return []
      })
  return modsCache
}

/**
 * Поиск серверов рейтинга по имени или адресу — для поля «Сервер, сборка или
 * режим» во вкладке «Играть». 64 % игроков ходят на конкретные крупные
 * серверы (анализ 24.09.2026), им нужен быстрый путь по имени.
 */
const searchCache = new Map<string, Promise<SnapshotServer[]>>()
export function searchServers(q: string): Promise<SnapshotServer[]> {
  const key = q.trim().toLowerCase().slice(0, 60)
  if (key.length < 2) return Promise.resolve([])
  const hit = searchCache.get(key)
  if (hit) return hit
  const asked = api<{ servers?: RatingServer[] }>(
    '/rating/servers?limit=12&offset=0&sort=online&search=' + encodeURIComponent(key),
  )
    .then((r) => uniqueByName(Array.isArray(r.servers) ? r.servers : []).slice(0, 5))
    .catch((e) => {
      console.warn('[playhub] search', e)
      searchCache.delete(key)
      return []
    })
  searchCache.set(key, asked)
  return asked
}
