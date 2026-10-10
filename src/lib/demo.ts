/**
 * ДЕМО-ВХОД — ТОЛЬКО ДЛЯ ПРОСМОТРА В БРАУЗЕРЕ (dev).
 *
 * Включается адресом `http://127.0.0.1:5173/?preview=user` и живёт целиком
 * внутри `import.meta.env.DEV`: в релизной сборке ветка вырезается, а сам флаг
 * без параметра `preview=user` остаётся false даже в dev.
 *
 * Зачем: без приложения (Tauri) сессии Millida нет, половина экранов упирается
 * в «Войти», и посмотреть залогиненный вид в браузере нельзя. Здесь лежат
 * ответы только на те адреса, которые сервер отдаёт лишь вошедшему. Всё
 * публичное (рейтинг серверов, каталог сборок, тарифы хостинга, правила и
 * пакеты рубинов, каталог косметики, каталог плащей, витрина скинов) идёт на
 * прод живым запросом — придумывать цены нельзя.
 *
 * Выдуманы здесь только «мои» состояния: баланс, что куплено, стрик, друзья,
 * переписка, один сервер хостинга. Цены берутся из живых публичных ответов.
 */

import { demoClaim, demoStatus, liveItems } from '../components/daily/demoTrack'
import { demoOpen, isTier } from '../components/daily/chestDrops'
import type { DailyClaim } from './rubies'
import { demoEconomy, demoTier, type DemoCatalogItem } from '../components/shop/demoShop'
import { demoSets } from '../components/shop/demoSets'

const demoParam = (): boolean => {
  try {
    if (typeof window === 'undefined' || typeof location === 'undefined') return false
    if ('__TAURI_INTERNALS__' in window) return false
    return new URLSearchParams(location.search).get('preview') === 'user'
  } catch {
    return false
  }
}

/** Демо-вход включён. В релизе всегда false: `import.meta.env.DEV` там константа. */
export const DEMO_USER: boolean = !!import.meta.env.DEV && demoParam()

/** Адрес прода для живых публичных данных. Читаем напрямую, чтобы не замкнуть импорт с api.ts. */
/**
 * Витрина экономики в dev-приложении (VITE_ECONOMY_SHOWCASE=1 в .env.local):
 * пока бэкенд магазина, осколков и PLUS не выкачен, эти ручки отвечают демо на
 * живых вещах каталога — владелец смотрит новый магазин в своём приложении, не
 * трогая аккаунт. Только dev: в релизе ветка вырезается сборкой.
 */
export const ECONOMY_SHOWCASE: boolean = !!import.meta.env.DEV && import.meta.env.VITE_ECONOMY_SHOWCASE === '1'
const ECONOMY_PATHS = /^\/(rubies\/(balance|wishlist|topup|shop(\/.*)?|xray\/.*|shards(\/.*)?|weekly(\/.*)?|progress|welcome(\/claim)?)|launcher\/plus|launcher\/creator-code|creator-codes\/public\/[^/]+)$/

function apiBase(): string {
  try {
    // В приложении без демо-входа прод напрямую режется CORS — идём через прокси Vite.
    if (ECONOMY_SHOWCASE && !DEMO_USER) return localStorage.getItem('m-api') || '/papi/v2'
    return localStorage.getItem('m-api') || 'https://api.millida.net/v2'
  } catch {
    return 'https://api.millida.net/v2'
  }
}

/** Живой публичный ответ прода мимо демо-подмены. */
const liveCache = new Map<string, Promise<any>>()
function live<T = any>(pathname: string): Promise<T> {
  const hit = liveCache.get(pathname)
  if (hit) return hit
  // Неудачу не запоминаем: прод иногда отвечает 502, и закэшированный ноль
  // оставил бы экран с нулевой ценой до перезагрузки вкладки.
  const asked = fetch(apiBase() + pathname, { headers: { 'Content-Type': 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
    .catch(() => {
      liveCache.delete(pathname)
      return null
    })
  liveCache.set(pathname, asked)
  return asked
}

// ── Кто «вошёл» ─────────────────────────────────────────────────────────────

export const DEMO_ID = 'demo-user'
export const DEMO_NICK = 'SlavaMine'
export const DEMO_UUID = '8f3c1a0e2b7d4e6a9c05d31f7a2b8e44'
export const DEMO_UUID_DASHED = '8f3c1a0e-2b7d-4e6a-9c05-d31f7a2b8e44'
/** Копейки: 1 489 ₽ на счету. */
export const DEMO_BALANCE_KOPECKS = 148_900

/**
 * Скин демо-игрока: чистый стандартный (MHF_Steve через ручку голов). Раньше
 * брался первый из живой витрины — у того верхний слой рук и ног был в
 * зелёно-лиловых пятнах, и они лезли на каждый снимок магазина.
 */
async function demoSkinUrl(): Promise<string | null> {
  return apiBase() + '/heads/skin/MHF_Steve'
}

const DAY = 86_400_000
const ago = (ms: number) => Date.now() - ms
const iso = (ms: number) => new Date(ms).toISOString()

// ── Друзья, заявки, группы, переписка ───────────────────────────────────────

const FRIENDS = [
  { userId: 'u-kirpich', nickname: 'Kirpich', online: true, place: 'game', playing: true, serverIp: 'mc.hypixel.ru', serverName: 'Выживание Кирпича', build: 'Fabric 1.21', unread: 2, lastMessageAt: ago(7 * 60_000) },
  { userId: 'u-nastya', nickname: 'Nastya_Lis', online: true, place: 'launcher', text: 'В лаунчере', lastSeen: ago(2 * 60_000) },
  { userId: 'u-grom', nickname: 'Grom228', online: true, place: 'game', playing: true, serverIp: 'play.millida.net', serverName: 'Наш выживач', build: 'Ванилла 1.21.4' },
  { userId: 'u-mihail', nickname: 'Mikhail_K', online: false, lastSeen: ago(5 * 3_600_000) },
  { userId: 'u-zaya', nickname: 'Zaya', online: false, lastSeen: ago(2 * DAY) },
  { userId: 'u-denis', nickname: 'Denis_Pro', online: false, lastSeen: ago(9 * DAY) },
]

const REQ_IN = [
  { id: 'rq-1', userId: 'u-artyom', nickname: 'Artyom_Volk' },
  { id: 'rq-2', userId: 'u-sova', nickname: 'NochnayaSova' },
]
const REQ_OUT = [{ id: 'rq-3', userId: 'u-pixel', nickname: 'PixelMaster' }]

const ROOMS = [
  {
    id: 'room-survival',
    title: 'Выживач по средам',
    ownerId: DEMO_ID,
    createdAt: ago(40 * DAY),
    lastMessageAt: ago(26 * 60_000),
    unread: 1,
    members: [
      { userId: DEMO_ID, role: 'owner', nickname: DEMO_NICK },
      { userId: 'u-kirpich', role: 'member', nickname: 'Kirpich' },
      { userId: 'u-grom', role: 'member', nickname: 'Grom228' },
      { userId: 'u-nastya', role: 'member', nickname: 'Nastya_Lis' },
    ],
    voice: [],
  },
  {
    id: 'room-mods',
    title: 'Сборка на модах',
    ownerId: 'u-mihail',
    createdAt: ago(12 * DAY),
    lastMessageAt: ago(3 * 3_600_000),
    members: [
      { userId: DEMO_ID, role: 'member', nickname: DEMO_NICK },
      { userId: 'u-mihail', role: 'owner', nickname: 'Mikhail_K' },
      { userId: 'u-zaya', role: 'member', nickname: 'Zaya' },
    ],
    voice: [],
  },
]

const CHATS: Record<
  string,
  { text: string; me?: boolean; ts: number; from?: string; fromNick?: string; id?: string; reactions?: { emoji: string; count: number }[]; attachment?: { kind: string; url: string; name?: string } }[]
> = {
  'u-kirpich': [
    { text: 'Зайдёшь вечером? Ферму железа доделать надо', ts: ago(46 * 60_000) },
    { id: 'dm-k2', text: 'Зайду после восьми', me: true, ts: ago(41 * 60_000), reactions: [{ emoji: '👍', count: 1 }, { emoji: '🔥', count: 1 }] },
    { id: 'dm-k3', text: 'Я тебе координаты скинул в группу', ts: ago(9 * 60_000) },
    { text: 'И возьми стекло, у нас кончилось', ts: ago(7 * 60_000) },
    // Старое сообщение-стикер: стикеров больше не отправить, лента их показывает как были.
    { text: '', ts: ago(6 * 60_000), attachment: { kind: 'sticker', url: '/emoji/eltaller/40.webp', name: 'Стикер' } },
  ],
  'u-nastya': [
    { text: 'Скинь адрес сервера ещё раз', ts: ago(3 * 3_600_000) },
    { text: 'srv-demo.millida.net', me: true, ts: ago(3 * 3_600_000 - 60_000) },
  ],
  'room-survival': [
    { text: 'Собираемся в среду в девять', from: DEMO_ID, fromNick: DEMO_NICK, me: true, ts: ago(2 * DAY) },
    { text: 'Я за, только позже подключусь', from: 'u-grom', fromNick: 'Grom228', ts: ago(2 * DAY - 600_000) },
    { text: 'Координаты фермы: -240 64 810', from: 'u-kirpich', fromNick: 'Kirpich', ts: ago(26 * 60_000) },
  ],
}

// ── Хостинг: один живой сервер на бесплатном тарифе ─────────────────────────

const SERVER_ID = 'demo-server'
const SERVER = {
  id: SERVER_ID,
  name: 'Наш выживач',
  slug: 'nash-vyzhivach',
  status: 'RUNNING',
  address: 'srv-demo.millida.net:25565',
  core: 'paper',
  version: '1.21.4',
  planName: 'Бесплатный',
  planCode: 'free',
  planRamMb: 2048,
  planMaxPlayers: 10,
  planFullAccess: false,
  ramMb: 2048,
  maxPlayers: 10,
  playersOnline: 3,
  planPriceKopecks: null as number | null,
  expiresAt: null as string | null,
  pendingRestart: [] as string[],
}

const SERVER_DETAIL = {
  ...SERVER,
  canDelete: true,
  customDomain: null,
  iconLocked: false,
  subscription: null,
  crashReason: null,
  players: [
    { id: 'p-1', nickname: DEMO_NICK, role: 'owner', banned: false, lastJoinAt: iso(ago(30 * 60_000)) },
    { id: 'p-2', nickname: 'Kirpich', role: 'op', banned: false, lastJoinAt: iso(ago(2 * 3_600_000)) },
    { id: 'p-3', nickname: 'Grom228', role: 'player', banned: false, lastJoinAt: iso(ago(20 * 60_000)) },
    { id: 'p-4', nickname: 'Denis_Pro', role: 'player', banned: true, lastJoinAt: iso(ago(6 * DAY)) },
  ],
  rules: {
    gamemode: 'survival',
    difficulty: 'normal',
    pvp: true,
    keepInventory: false,
    whitelist: false,
    motd: 'Наш выживач',
    motdLine2: 'Заходи, места хватит',
    maxPlayers: 10,
    levelType: 'default',
    levelSeed: '',
    levelName: 'world',
    viewDistance: 8,
    simulationDistance: 6,
    spawnProtection: 16,
    allowFlight: false,
    onlineMode: false,
    millidaAuth: true,
    hardcore: false,
    commandBlocks: true,
    spawnMonsters: true,
    spawnAnimals: true,
    spawnNpcs: true,
    mobGriefing: true,
    allowNether: true,
    generateStructures: true,
    javaVersion: 21,
  },
}

/** Ровная, но не мёртвая картинка нагрузки: экран управления должен выглядеть живым. */
function serverStats() {
  const t = Date.now() / 1000
  return {
    running: true,
    cpuPercent: Math.round((34 + Math.sin(t / 7) * 11) * 10) / 10,
    memoryUsedMb: Math.round(1180 + Math.sin(t / 11) * 90),
    memoryLimitMb: 2048,
    diskUsedMb: 3_720,
    diskLimitMb: 10_240,
  }
}

// ── Геометрия косметики для примерки ────────────────────────────────────────
//
// Настоящие модели лежат за `GET /v2/cosmetics/models/:id`, и он отвечает 401
// без сессии — в браузере примерка мертва целиком, вещь просто не появляется
// на фигуре. Подменить их все нельзя: каждая вещь нарисована под свою развёртку
// (у каталога картинки 32×32, 36×36, 70×70, и закрашено в них 2–38% площади),
// и коробка с чужими координатами выходит прозрачной.
//
// Поэтому здесь лежат формы только для трёх вещей, чья развёртка читается по
// самой картинке: кепка (остров коробки 32×12 на картинке 32×32), плащ
// (обычная развёртка плаща 64×32) и повседневный рюкзак (остров 24×16 на
// картинке 36×36). На них примерка работает.
// У остальных ответа нет, запрос уходит на прод, приходит 401 — и экран честно
// говорит «Не удалось показать на фигуре: …». Чинится это на бэкенде: см.
// отчёт, ручке нужен публичный доступ на чтение.

/// Ответ ручки: `{ geometry }` с файлом Blockbench внутри — так его отдаёт сервер.
const geo = (identifier: string, size: [number, number], bones: unknown[]) => ({
  geometry: {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier, texture_width: size[0], texture_height: size[1] },
        bones,
      },
    ],
  },
})

const DEMO_MODELS: Record<string, unknown> = {
  // Кепка: тулья 8×4×8, развёртка коробкой с (0, 12) на картинке 32×32 —
  // ровно тот остров, что видно в самой картинке вещи.
  'geometry.cap': geo('geometry.cap', [32, 32], [
    {
      name: 'head',
      pivot: [0, 24, 0],
      cubes: [{ origin: [-4, 28, -4], size: [8, 4, 8], inflate: 0.3, uv: [0, 12] }],
    },
  ]),
  // Плащ: коробка 10×16×1, развёртка с начала картинки — как у плаща в игре.
  'geometry.basic_cape': geo('geometry.basic_cape', [64, 32], [
    { name: 'cape', pivot: [0, 24, 2], cubes: [{ origin: [-5, 8, 2], size: [10, 16, 1], uv: [0, 0] }] },
  ]),
  // Рюкзак: 8×12×4 — ровно остров 24×16 на картинке 36×36.
  'geometry.everyday_backpack': geo('geometry.everyday_backpack', [36, 36], [
    { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 10, 2], size: [8, 12, 4], uv: [0, 0] }] },
  ]),
}

/// Вещи, у которых в демо есть форма: их примерка работает. Настоящих моделей
/// платной косметики в репозитории нет — он уходит в открытый код.
export const DEMO_MODEL_IDS = Object.keys(DEMO_MODELS)

const DEMO_WORN_KEY = 'm-demo-worn'

function demoWorn(): unknown[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(DEMO_WORN_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// ── Рубины: «моё» состояние поверх живых правил и цен ───────────────────────

// Витрина экономики в dev: миллион рубинов, чтобы владелец мог всё купить и потрогать (23.09.2026).
/** `&rubies=20000` — другой баланс демо-игрока (кадры ×10 без пополнения). */
const DEMO_RUBIES = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('rubies')) || 0 : 0
const RUBY_BALANCE = { balance: ECONOMY_SHOWCASE && !DEMO_USER ? 1_000_000 : DEMO_RUBIES || 2_340, earned: 5_120, spent: 2_780 }

/** Пять ступеней редкости по цене вещи — подпись для витрины, не цена. */
function rarityByPrice(price: number): [string, string] {
  if (price >= 1_500) return ['LEGENDARY', 'Легендарная']
  if (price >= 900) return ['EPIC', 'Эпическая']
  if (price >= 500) return ['RARE', 'Редкая']
  if (price >= 250) return ['UNCOMMON', 'Необычная']
  return ['COMMON', 'Обычная']
}

interface CatalogItem {
  id: string
  name: string
  slot: string
  model?: string
  preview?: string
  priceRubies?: number
  access?: string
  staffOnly?: boolean
}

async function catalogItems(): Promise<CatalogItem[]> {
  const r = await live<{ items: CatalogItem[] }>('/cosmetics/catalog')
  return (r && Array.isArray(r.items) ? r.items : []).filter((x) => x && !x.staffOnly)
}

/** Что «куплено»: первые вещи живого каталога, чтобы коллекция была не пустой. */
async function ownedCodes(): Promise<string[]> {
  const items = await catalogItems()
  const paid = items.filter((x) => x.access === 'PURCHASE')
  const picked: string[] = []
  for (let i = 0; i < paid.length && picked.length < 14; i += Math.max(1, Math.floor(paid.length / 14)))
    picked.push(paid[i]!.id)
  // Вещи с демо-геометрией — обязательно свои: иначе примерку не на чем показать.
  for (const item of items)
    if (item.model && DEMO_MODELS[item.model] && !picked.includes(item.id)) picked.push(item.id)
  return picked
}

async function shopItems(slot?: string): Promise<{ items: unknown[] }> {
  const owned = new Set(await ownedCodes())
  const rubleKopecks = await live<{ packs?: { rubyKopecks?: number } }>('/rubies/rules').then(
    (r) => (r && r.packs && r.packs.rubyKopecks) || 0,
  )
  const items = (await catalogItems())
    .filter((x) => typeof x.priceRubies === 'number' && x.priceRubies! > 0)
    .filter((x) => !slot || x.slot === slot)
    .map((x) => {
      const [rarity, rarityTitle] = rarityByPrice(x.priceRubies || 0)
      return {
        code: x.id,
        name: x.name,
        slot: x.slot,
        rarity,
        rarityTitle,
        priceRubies: x.priceRubies || 0,
        priceKopecks: Math.round((x.priceRubies || 0) * rubleKopecks),
        previewUrl: x.preview || null,
        owned: owned.has(x.id),
      }
    })
  return { items }
}

/**
 * Экономика вещей (контракт 23.09.2026): магазин дня, рентген, осколки,
 * посылка, путь, PLUS. Состояние — src/components/shop/demoShop.ts.
 * Девять пакетов рубинов (бэкенд 01.10.2026).
 */
const V3_PACKS = [
  { code: 'handful', title: 'Горсть', rubies: 700, kopecks: 10000 },
  { code: 'pouch', title: 'Мешочек', rubies: 1300, kopecks: 18000 },
  { code: 'purse', title: 'Кошель', rubies: 1900, kopecks: 25000 },
  { code: 'casket', title: 'Сундучок', rubies: 4200, kopecks: 50000 },
  { code: 'hoard', title: 'Клад', rubies: 5600, kopecks: 65000 },
  { code: 'trove', title: 'Россыпь', rubies: 7000, kopecks: 80000 },
  { code: 'treasury', title: 'Казна', rubies: 10000, kopecks: 110000 },
  { code: 'vault', title: 'Сокровищница', rubies: 14000, kopecks: 150000 },
  { code: 'dragon', title: 'Драконий клад', rubies: 30000, kopecks: 300000 },
]
const economy = demoEconomy({
  catalog: catalogItems,
  wallet: RUBY_BALANCE,
  // Модель v3: 7 рубинов за рубль — прод ещё на старом курсе, демо показывает новый.
  packs: async () => V3_PACKS,
})

/** Наборы и кейсы (02.10.2026): тот же кошелёк, покупки видны в /cosmetics/owned. */
const setsDemo = demoSets({
  catalog: async () => (await catalogItems()) as DemoCatalogItem[],
  wallet: RUBY_BALANCE,
  ownedBases: ownedCodes,
})

/** Права демо-игрока: прежние вещи во всех расцветках + купленное наборами и кейсами. */
async function ownedWithVariants() {
  await setsDemo.ready()
  const base = await ownedCodes()
  const cat = (await catalogItems()) as DemoCatalogItem[]
  const variants: Record<string, string[]> = {}
  for (const code of base) {
    const names = (cat.find((x) => x.id === code)?.variants || []).map((v) => v.name).filter(Boolean)
    if (names.length) variants[code] = names
  }
  const extra = setsDemo.boughtVariants()
  for (const code of Object.keys(extra)) variants[code] = Array.from(new Set([...(variants[code] || []), ...extra[code]!]))
  return { items: Array.from(new Set([...base, ...setsDemo.boughtBases()])), variants }
}

async function inventory() {
  const owned = await ownedCodes()
  const items = await catalogItems()
  const byId = new Map(items.map((x) => [x.id, x]))
  const rows = owned
    .map((code, i) => {
      const it = byId.get(code)
      if (!it) return null
      const [rarity, rarityTitle] = rarityByPrice(it.priceRubies || 0)
      return {
        code,
        name: it.name,
        slot: it.slot,
        rarity,
        rarityTitle,
        previewUrl: it.preview || null,
        source: i % 3 === 0 ? 'chest' : 'shop',
        since: iso(ago((i + 2) * 3 * DAY)),
      }
    })
    .filter(Boolean) as { rarity: string }[]
  const byRarity: Record<string, number> = {}
  rows.forEach((r) => (byRarity[r.rarity] = (byRarity[r.rarity] || 0) + 1))
  return {
    items: rows,
    count: rows.length,
    catalogCount: items.length,
    worthRubies: RUBY_BALANCE.spent,
    points: rows.length * 12,
    byRarity,
  }
}

/**
 * Ежедневный трек по схеме 23.09.2026 (src/components/daily/demoTrack.ts):
 * день, стрик и прогресс вещи недели — «моё» состояние, вещи — из живого
 * каталога косметики. `&daily-day=1..28` — сколько клеток сезона открыто
 * (по умолчанию 4: первая забрана, три ждут), `&daily-plus=1` —
 * вход с подпиской,
 * `&daily-have=N` — сколько фрагментов уже собрано.
 */
async function daily() {
  const q = new URLSearchParams(location.search)
  const cat = await live<{ items?: { id: string; name: string; preview?: string | null }[] }>('/cosmetics/catalog')
  // `&daily-shields=0..2` — щиты серии на неделю (по умолчанию 1).
  const shields = q.has('daily-shields') ? Number(q.get('daily-shields')) : 1
  // `&daily-active=0` — сегодня день серии ещё не засчитан.
  return {
    ...demoStatusOf(q, cat),
    shields,
    shieldsMax: q.get('daily-plus') === '1' ? 2 : 1,
    shieldSaved: false,
    activeToday: q.get('daily-active') !== '0',
  }
}

function demoStatusOf(q: URLSearchParams, cat: { items?: { id: string; name: string; preview?: string | null }[] } | null) {
  return demoStatus({
    items: liveItems(cat && cat.items),
    day: Number(q.get('daily-day')) || undefined,
    plus: q.get('daily-plus') === '1',
    have: q.has('daily-have') ? Number(q.get('daily-have')) : undefined,
    // `&daily-chests=N` — сколько сундуков уже ждёт в «Моих сундуках» (скриншоты открытия).
    chests: q.has('daily-chests') ? Number(q.get('daily-chests')) : undefined,
    // `&daily-claimed=1` — всё открытое уже забрано: виден таймер до следующего.
    claimed: q.get('daily-claimed') === '1',
  })
}

/**
 * Доски (GET /launcher/top?board=…). `&top-rank=N` — своё место (по умолчанию
 * 127), `&top-rank=0` — не на доске.
 */
function boardTop(pathname: string) {
  const q = new URLSearchParams(location.search)
  const board = new URLSearchParams(pathname.split('?')[1] || '').get('board') || 'week'
  const myRank = q.has('top-rank') ? Number(q.get('top-rank')) : 127
  const NICKS = ['markizkit', 'Samoner', 'LapisCrit', 'JLalka', 'Artem_nik', 'holy_67', 'BlenderxXx', 'Razner', 'purty7', 'mlem', 'PinPointed', 'kotok_vozduh']
  const top = board === 'streak' ? 22 : board === 'month' ? 180 : board === 'all' ? 2400 : 42
  const valueAt = (rank: number) =>
    board === 'streak' ? Math.max(1, top - Math.floor((rank - 1) / 9)) : Math.max(0.5, Math.round(top * (1 - (rank - 1) * 0.0045) * 10) / 10)
  const FRIENDS_AT: Record<number, string> = { 4: 'Kirpich', 9: 'Grom228' }
  const entry = (rank: number, nick: string, isFriend = false) => ({
    rank, nick, slug: nick.toLowerCase(), head: null, value: valueAt(rank), likes: Math.max(0, 140 - rank * 3) + (rank % 7), isFriend,
  })
  const items = Array.from({ length: 100 }, (_, i) => {
    const rank = i + 1
    if (myRank === rank) return entry(rank, DEMO_NICK)
    if (FRIENDS_AT[rank]) return entry(rank, FRIENDS_AT[rank]!, true)
    return entry(rank, NICKS[i % NICKS.length] + (i >= NICKS.length ? '_' + i : ''))
  })
  return {
    board,
    from: board === 'week' || board === 'month' ? new Date(Date.now() - (board === 'week' ? 6 : 29) * DAY).toISOString().slice(0, 10) : null,
    to: board === 'week' || board === 'month' ? new Date().toISOString().slice(0, 10) : null,
    updatedAt: new Date().toISOString(),
    items,
    // На доске огоньков своё значение — серия демо-бонуса (4 дня).
    me: myRank > 0 ? { ...entry(myRank, DEMO_NICK), ...(board === 'streak' ? { value: 4 } : {}) } : null,
    friends: [entry(4, 'Kirpich', true), entry(9, 'Grom228', true), { ...entry(2140, 'Nastya_Lis', true), value: board === 'streak' ? 2 : 3.5 }],
  }
}

/** Неоткрытые сундуки демо: магазин открывает их сам, одним раскрытием. */
const PLAY = { seconds: 2 * 3600 + 26 * 60, claimed: 1 }
function playChests() {
  const earned = Math.min(3, Math.floor(PLAY.seconds / 3600))
  return { earned, claimed: PLAY.claimed, ready: Math.max(0, earned - PLAY.claimed), limit: 3, nextInS: earned >= 3 ? null : 3600 * (earned + 1) - PLAY.seconds, chest: 'Обычный сундук' }
}

const DEMO_CHESTS: { id: string; tier: string; source: string; title: string; createdAt: string }[] =
  // &chests — в «Моих сундуках» три сундука (скриншоты открытия).
  typeof location !== 'undefined' && location.search.includes('chests')
    ? ['EPIC', 'RARE', 'COMMON'].map((tier, i) => ({ id: 'demo-ch-' + i, tier, source: 'playtime:hours10', title: 'За часы игры', createdAt: new Date().toISOString() }))
    : []

/** Забранный бонус меняет кошелёк демо: рубины и осколки видны в шапке магазина. */
async function dailyCredit(res: DailyClaim): Promise<DailyClaim> {
  const got = res.granted || []
  const rubies = got.reduce((n, g) => n + (g.kind === 'RUBIES' ? g.amount : 0), 0)
  const shards = got.reduce((n, g) => n + (g.kind === 'SHARDS' ? g.amount : 0), 0)
  // Сундуков в бонусе нет (23.09.2026, 22:22): клетка — осколки, рубины или вещь.
  await economy.credit({ rubies, shards })
  return { ...res, balance: RUBY_BALANCE.balance }
}

/**
 * Код автора в демо: один настоящий код SLAVAMINE, выбор помнится до закрытия
 * вкладки, сундук за первый код — один раз. `&cc-off=1` — служба без адресов
 * кодов (как прод до выкатки): все ответы 404.
 */
const DEMO_CC_KEY = 'm-demo-creator'
const DEMO_CC_BONUS_KEY = 'm-demo-creator-bonus'
const DEMO_CREATORS: Record<string, { code: string; name: string; avatarUrl: null }> = {
  SLAVAMINE: { code: 'SLAVAMINE', name: 'SlavaMine', avatarUrl: null },
}
const ccOff = () => new URLSearchParams(location.search).get('cc-off') === '1'
function creatorCode(method: string, body: any): unknown {
  if (ccOff()) return Promise.reject(new Error('http 404'))
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(DEMO_CC_KEY) || 'null')
    } catch {
      return null
    }
  }
  const write = (v: unknown) => {
    try {
      if (v) sessionStorage.setItem(DEMO_CC_KEY, JSON.stringify(v))
      else sessionStorage.removeItem(DEMO_CC_KEY)
    } catch {}
  }
  if (method === 'DELETE') {
    write(null)
    return { code: null }
  }
  if (method === 'POST') {
    const found = DEMO_CREATORS[String((body && body.code) || '').trim().toUpperCase()]
    if (!found) return Promise.reject(new Error('Код не найден'))
    const cur = { ...found, since: new Date().toISOString() }
    write(cur)
    let first = false
    try {
      first = sessionStorage.getItem(DEMO_CC_BONUS_KEY) !== '1'
      sessionStorage.setItem(DEMO_CC_BONUS_KEY, '1')
    } catch {}
    if (first) DEMO_CHESTS.push({ id: 'demo-cc-chest', tier: 'RARE', source: 'creator', title: 'Код автора', createdAt: new Date().toISOString() })
    return { ...cur, bonus: first ? { chestId: 'demo-cc-chest', tier: 'RARE' } : null }
  }
  return read() || { code: null }
}

// ── Таблица ответов ─────────────────────────────────────────────────────────

type Handler = (path: string, method: string, body: any) => unknown | Promise<unknown>

const ok = () => ({ ok: true })

/** Ответ долгого запроса: отдаём не сразу, иначе цикл опроса крутится без пауз. */
const HOLD_MS = 25_000
const hold = <T>(value: T): Promise<T> => new Promise((done) => setTimeout(() => done(value), HOLD_MS))

/** Путь без строки запроса. */
const bare = (p: string) => p.split('?')[0] || ''

const ROUTES: [RegExp, Handler][] = [
  [/^\/party$/, (_p, method) => method === 'GET' ? {
    me: DEMO_ID,
    invites: [],
    safety: { ageBracket: '13_15', newAccount: false },
    party: {
      id: 'demo-party', leaderId: DEMO_ID, capacity: 4, maxCapacity: 8, targetRev: 1, rev: 1, launch: null,
      target: { kind: 'version', ref: '1.21.4', version: '1.21.4', title: 'Minecraft 1.21.4', game: '1.21.4' },
      members: [
        { userId: DEMO_ID, nickname: DEMO_NICK, avatarUrl: null, role: 'leader', ready: true, joinedAt: 1, have: null },
        { userId: 'demo-mate', nickname: 'Kirpich', avatarUrl: null, role: 'member', ready: true, joinedAt: 2,
          have: { kind: 'version', ref: '1.21.4', version: '1.21.4' } },
      ],
      voice: [{ userId: 'demo-mate', since: 1, muted: false, screen: false }],
    },
  } : undefined],
  [/^\/party\/friends$/, () => ({ parties: [] })],
  [/^\/party\/lfg\/requests$/, () => ({ requests: [] })],
  [/^\/party\/lfg$/, (_p, method) => method === 'GET' ? {
    mine: null,
    cards: [{ id: 'demo-card', user: { userId: 'demo-x', nickname: 'Steve', avatarUrl: null }, size: 1, capacity: 4,
      createdAt: Date.now(), expiresAt: Date.now() + 3600_000, requested: false,
      tags: { mode: 'survival', version: '1.21.4', pack: '', lang: 'ru', region: 'ru_west', voice: true, time: 'now' } }],
  } : undefined],
  // Код автора
  [/^\/launcher\/creator-code$/, (_p, method, body) => creatorCode(method, body)],
  [/^\/creator-codes\/public\/[^/]+$/, (p) => {
    if (ccOff()) return Promise.reject(new Error('http 404'))
    const c = DEMO_CREATORS[decodeURIComponent(bare(p).split('/').pop() || '').toUpperCase()]
    return c || Promise.reject(new Error('Код не найден'))
  }],
  // Кто я, кошелёк, приватность
  [/^\/users\/me$/, async () => ({
    id: DEMO_ID,
    nickname: DEMO_NICK,
    avatarUrl: null,
    email: 'demo@millida.net',
    createdAt: iso(ago(400 * DAY)),
  })],
  [/^\/users\/me\/privacy$/, (_p, _m, body) => ({
    showActivity: true,
    showFriends: true,
    showPlaytime: true,
    showAchievements: true,
    showMarket: false,
    showServers: true,
    ...(body || {}),
  })],
  [/^\/core\/wallet\/me\/display$/, () => ({
    availableKopecks: DEMO_BALANCE_KOPECKS,
    frozenKopecks: 0,
    currency: 'RUB',
  })],
  // Каталог: одна покупка, у платной сборки доступа нет — видно и «Купить», и «Куплено».
  [/^\/catalog\/purchases\/me$/, () => [
    {
      id: 'demo-p1',
      item: {
        slug: 'bsl-shaders-dlya-minecraft',
        title: 'BSL Shaders',
        type: 'SHADER',
        iconUrl: 'https://cdn.millida.trade/forum/dl/90b5702e-dd02-4fd8-ba3b-01e8a23a5812.webp',
      },
      kind: 'ONE_TIME',
      status: 'SETTLED',
      amountKopecks: 19900,
      accessUntil: null,
      createdAt: iso(ago(3 * DAY)),
    },
  ]],
  [/^\/catalog\/items\/[^/]+\/access$/, () => ({ pricing: 'SUBSCRIPTION', priceKopecks: 25900, hasAccess: false, isOwner: false, source: null, expiresAt: null, subscription: null })],
  [/^\/core\/blocks$/, () => ({ items: [] })],
  [/^\/core\/blocks\//, ok],

  // Игровой профиль и гардероб
  [/^\/launcher\/game-profile$/, async () => ({
    uuid: DEMO_UUID,
    uuidDashed: DEMO_UUID_DASHED,
    name: DEMO_NICK,
    model: 'classic',
    skinUrl: await demoSkinUrl(),
    capeUrl: null,
    accountNick: DEMO_NICK,
    publicSlug: 'slavamine',
    nameConflict: false,
  })],
  [/^\/launcher\/wardrobe$/, async () => ({
    items: [
      { id: 'w-1', kind: 'skin', name: 'Мой основной', url: await demoSkinUrl(), model: 'classic', source: 'upload', createdAt: iso(ago(30 * DAY)) },
      // Второй — тонкие руки: на нём видно, что кнопка «Удалить» не уходит под руку.
      { id: 'w-2', kind: 'skin', name: 'Лёгкий', url: await demoSkinUrl(), model: 'slim', source: 'upload', createdAt: iso(ago(12 * DAY)) },
    ],
    active: { skinUrl: await demoSkinUrl(), capeUrl: null, model: 'classic' },
  })],
  [/^\/launcher\/wardrobe\//, async () => ({ skinUrl: await demoSkinUrl(), capeUrl: null, model: 'classic' })],
  [/^\/launcher\/game-texture$/, async () => ({ skinUrl: await demoSkinUrl(), capeUrl: null, model: 'classic' })],
  [/^\/launcher\/rewards$/, () => ({
    items: [
      { code: 'hours-10', title: 'Первые десять часов', task: 'Наиграть 10 часов', hint: 'Время считает лаунчер', unit: 'seconds', goal: 36_000, progress: 36_000, done: true, claimed: true, capeUrl: null },
      { code: 'hours-50', title: 'Полсотни часов', task: 'Наиграть 50 часов', hint: 'Время считает лаунчер', unit: 'seconds', goal: 180_000, progress: 104_400, done: false, claimed: false, capeUrl: null },
      { code: 'friends-5', title: 'Своя компания', task: 'Добавить 5 друзей', hint: 'Друзья на экране «Друзья»', unit: 'count', goal: 5, progress: 6, done: true, claimed: false, capeUrl: null },
    ],
  })],

  // Подписка PLUS
  [/^\/launcher\/plus$/, async () => {
    const rules = await live<{ packs?: { plus?: { priceKopecks?: number; items?: number } } }>('/rubies/rules')
    const plus = (rules && rules.packs && rules.packs.plus) || null
    const tier = demoTier()
    return {
      active: !!tier,
      tier,
      paidUntil: tier ? new Date(Date.now() + 19 * 86_400_000).toISOString() : null,
      canceled: false,
      priceKopecks: (plus && plus.priceKopecks) || 0,
      items: (plus && plus.items) || 0,
      ...(await economy.plus()),
    }
  }],
  [/^\/rubies\/welcome\/claim$/, () => economy.welcomeClaim()],

  // Рубины
  [/^\/rubies\/balance$/, () => RUBY_BALANCE],
  [/^\/rubies\/daily$/, daily],
  // Сезон: `{ day, row }` — клетка, без тела — старая ручка «забрать сегодня».
  [/^\/rubies\/daily\/claim$/, async (_p, _m, body) =>
    dailyCredit(demoClaim(await daily(), RUBY_BALANCE.balance, body && body.day ? { day: Number(body.day), row: body.row === 'plus' ? 'plus' : 'free' } : null))],
  [/^\/rubies\/daily\/claim-all$/, async () => dailyCredit(demoClaim(await daily(), RUBY_BALANCE.balance, 'all'))],
  [/^\/rubies\/sets$/, () => setsDemo.sets()],
  [/^\/rubies\/sets\/buy$/, (_p, _m, body) => setsDemo.buy(body || {})],
  [/^\/rubies\/cases$/, () => setsDemo.cases()],
  [/^\/rubies\/cases\/open$/, (_p, _m, body) => setsDemo.open(body || {})],
  [/^\/rubies\/cases\/[^/]+$/, (p) => setsDemo.contents(decodeURIComponent(bare(p).split('/').pop() || ''))],
  [/^\/rubies\/wishlist$/, () => economy.wishlist()],
  [/^\/rubies\/topup$/, (_p, _m, body) => economy.topup(body || {})],
  // Сундуки не копятся: открытые исчезают. Бонус сундуков больше не даёт.
  [/^\/rubies\/chests$/, () => ({ pending: DEMO_CHESTS.slice(), opened: [] })],
  // Старая витрина (items) и магазин дня по контракту — один адрес, оба ответа.
  [/^\/rubies\/shop$/, async (p) => ({
    ...(await shopItems(new URLSearchParams(p.split('?')[1] || '').get('slot') || undefined)),
    ...(await economy.shop()),
  })],
  [/^\/rubies\/shop\/wish$/, (_p, _m, body) => economy.wish(body || {})],
  [/^\/rubies\/shop\/gift\/claim$/, () => economy.giftClaim()],
  [/^\/rubies\/xray\/buy$/, (_p, _m, body) => economy.xrayBuy(body || {})],
  [/^\/rubies\/shards$/, () => economy.workshop()],
  [/^\/rubies\/shards\/craft$/, (_p, _m, body) => economy.craft(body || {})],
  [/^\/rubies\/fragments\/complete$/, (_p, _m, body) => economy.completeFragments(body || {})],
  [/^\/rubies\/weekly$/, () => economy.weekly()],
  [/^\/rubies\/weekly\/claim$/, (_p, _m, body) => economy.weeklyClaim(body || {})],
  [/^\/rubies\/weekly\/boost$/, (_p, _m, body) => economy.weeklyBoost(body || {})],
  [/^\/rubies\/inventory$/, inventory],
  [/^\/rubies\/progress$/, async () => ({
    ...(await economy.progress()),
    hours: 29,
    items: [
      { code: 'h5', title: 'Пять часов', hours: 5, hoursDone: 5, chest: 'COMMON', rubies: 50, done: true, claimed: true },
      { code: 'h25', title: 'Двадцать пять часов', hours: 25, hoursDone: 25, chest: 'RARE', rubies: 150, done: true, claimed: false },
      { code: 'h50', title: 'Полсотни часов', hours: 50, hoursDone: 29, chest: 'EPIC', rubies: 300, done: false, claimed: false },
    ],
  })],

  // Новая покупка (source из контракта) идёт в экономику; старая — прежний ответ.
  [/^\/rubies\/shop\/buy$/, (_p, _m, body) =>
    body && body.source && body.source !== 'wardrobe'
      ? economy.buy(body)
      : { code: (body && body.code) || '', name: 'Вещь', spent: 0, balance: RUBY_BALANCE.balance }],
  [/^\/rubies\/packs\/buy$/, () => ({ pack: 'demo', rubies: 0, kopecks: 0, balance: RUBY_BALANCE.balance })],
  [/^\/rubies\/promo$/, () => ({ code: '', rubies: 0, chest: null, item: null, balance: RUBY_BALANCE.balance })],
  [/^\/rubies\/chests\/[^/]+\/open$/, (p) => {
    // Модель предметов v2: слот сундука — фрагменты вещи (demoOpen в chestDrops.ts).
    const at = DEMO_CHESTS.findIndex((c) => p.includes('/' + c.id + '/'))
    const chest = at >= 0 ? DEMO_CHESTS.splice(at, 1)[0] : undefined
    return demoOpen(chest?.id || 'ch-1', isTier(chest?.tier) ? chest.tier : 'COMMON')
  }],
  [/^\/rubies\/progress\/[^/]+\/claim$/, () => ({ code: 'h25', title: 'Двадцать пять часов', hours: 25, hoursDone: 25, chest: 'RARE', rubies: 150, done: true, claimed: true })],

  // Косметика
  [/^\/cosmetics\/owned$/, () => ownedWithVariants()],
  // Надетое помнится до закрытия вкладки: лобби показывает то, что надели в
  // гардеробе, как у вошедшего игрока.
  [/^\/cosmetics\/equipped$/, () => ({ players: { [DEMO_UUID]: demoWorn() } })],
  [/^\/cosmetics\/wardrobe$/, (_p, _m, body) => {
    const items = (body && Array.isArray(body.items) && body.items) || []
    try {
      sessionStorage.setItem(DEMO_WORN_KEY, JSON.stringify(items))
    } catch {}
    return { ok: true, applied: items.length }
  }],
  [/^\/cosmetics\/models\//, (p) => {
    const id = decodeURIComponent(bare(p).replace('/cosmetics/models/', ''))
    return DEMO_MODELS[id]
  }],

  // Приглашения: две засчитанных, тебя тоже позвали (плитки подарков)
  [/^\/launcher\/referrals\/me$/, () => {
    const t = (friends: number, plusDays: number, chest: string | null, chestName: string | null, perks: { id: string; kind: string; name: string }[], delayed: boolean) => ({
      friends, plusDays, chest, chestName, perks, delayed, reached: friends <= 2, granted: friends <= 1,
    })
    return {
      code: 'K7M2QX9R',
      link: 'https://millida.net/?ref=K7M2QX9R',
      deepLink: 'millida://invite/K7M2QX9R',
      qualified: 2,
      pending: 1,
      perFriendPlusDays: 1,
      rules: { playSeconds: 7200, playDays: 2, dailyLimit: 3, accountCap: 30 },
      earned: { plusDays: 5, chests: 0 },
      perks: [{ id: 'badge-leader', kind: 'badge', name: 'Вожак' }],
      invitee: {
        badge: { id: 'badge-newcomer', kind: 'badge', name: 'Новичок команды' },
        rubies: 50,
        chest: { tier: 'COMMON', granted: false, playSeconds: 1500, needSeconds: 3600 },
        plus: { days: 2, granted: false },
      },
      tiers: [
        t(1, 3, null, null, [{ id: 'badge-leader', kind: 'badge', name: 'Вожак' }], false),
        t(3, 0, 'COMMON', 'Обычный сундук', [{ id: 'frame-team', kind: 'frame', name: 'Команда' }], false),
        t(5, 14, null, null, [{ id: 'icon-spark', kind: 'icon', name: 'Искра' }], true),
        t(10, 30, 'RARE', 'Редкий сундук', [{ id: 'title-pack', kind: 'title', name: 'Лидер стаи' }, { id: 'icon-flame', kind: 'icon', name: 'Пламя' }], true),
        t(25, 0, 'EPIC', 'Эпический сундук', [{ id: 'icon-amethyst', kind: 'icon', name: 'Аметист' }, { id: 'badge-animated', kind: 'badge', name: 'Живой вожак' }], true),
        t(50, 0, null, null, [{ id: 'icon-legend', kind: 'icon', name: 'Легенда' }, { id: 'badge-legend', kind: 'badge', name: 'Легенда' }], true),
      ],
      next: { friends: 3, left: 1 },
      friends: [
        { nickname: 'Kirill_7', status: 'qualified', wait: null, playSeconds: 7200, invitedAt: iso(ago(6 * DAY)), qualifiedAt: iso(ago(4 * DAY)) },
        { nickname: 'MiaCraft', status: 'qualified', wait: null, playSeconds: 7200, invitedAt: iso(ago(3 * DAY)), qualifiedAt: iso(ago(1 * DAY)) },
        { nickname: 'Fedya', status: 'pending', wait: 'play', playSeconds: 3000, invitedAt: iso(ago(1 * DAY)), qualifiedAt: null },
      ],
      invitedBy: { nickname: 'Daniil', status: 'pending' },
      canApply: false,
    }
  }],
  [/^\/launcher\/referrals\/lookup$/, () => ({ found: true, nickname: 'Daniil' })],
  [/^\/launcher\/referrals\/onboarding$/, ok],
  [/^\/launcher\/plus\/subscribe$/, () => ({ subscriptionId: 'demo', paymentUrl: 'https://millida.net/profile#plus' })],

  [/^\/launcher\/top$/, (p) => boardTop(p)],
  // Лайк на доске топа: в демо не уходит на прод (там 401/429 по IP владельца).
  [/^\/users\/[^/]+\/like$/, () => ({ liked: true })],
  [/^\/rubies\/daily\/active$/, daily],
  [/^\/friends\/streaks$/, () => ({ streaks: { 'u-kirpich': 23, 'u-grom': 6, 'u-nastya': 2, 'u-mihail': 41 } })],
  // Сундуки за игру: сегодня наиграно 2 часа, один сундук забран, третий — через 34 минуты.
  [/^\/rubies\/play-chests$/, () => playChests()],
  [/^\/rubies\/play-chests\/claim$/, () => {
    const st = playChests()
    if (st.ready <= 0) return Promise.reject(new Error('http 409'))
    PLAY.claimed += 1
    const chestId = 'demo-play-' + PLAY.claimed
    DEMO_CHESTS.push({ id: chestId, tier: 'COMMON', source: 'play', title: 'За игру', createdAt: new Date().toISOString() })
    return { ...playChests(), chestId }
  }],
  [/^\/rubies\/progress\/hours1\/claim$/, () => ({ code: 'hours1', title: 'Первый час', hours: 1, hoursDone: 1, chest: 'Обычный сундук', rubies: 0, done: true, claimed: true })],

  // Друзья, заявки, группы, переписка
  [/^\/friends$/, () => ({ friends: FRIENDS })],
  [/^\/friends\/requests$/, () => ({ incoming: REQ_IN, outgoing: REQ_OUT })],
  [/^\/friends\/rooms$/, (_p, method, body) =>
    method === 'POST'
      ? { id: 'room-new', title: (body && body.title) || 'Новая группа', ownerId: DEMO_ID, members: [{ userId: DEMO_ID, role: 'owner', nickname: DEMO_NICK }], voice: [] }
      : { me: DEMO_ID, rooms: ROOMS }],
  // Переписка группы — до общего правила комнат, иначе она отдавала саму комнату.
  [/^\/friends\/rooms\/[^/]+\/chat$/, (p, method) => {
    if (method !== 'GET') return ok()
    const id = decodeURIComponent(bare(p).split('/')[3] || '')
    return { messages: CHATS[id] || [], hasMore: false, peerReadAt: ago(5 * 60_000) }
  }],
  [/^\/friends\/rooms\//, (p) => ROOMS.find((r) => bare(p).includes(r.id)) || ok()],
  [/^\/friends\/stats$/, () => ({
    totalSeconds: 104_400,
    sessions: 87,
    lastBuild: 'Ванилла 1.21.4',
    lastServer: 'srv-demo.millida.net',
    lastServerName: 'Наш выживач',
    lastPlayedAt: ago(30 * 60_000),
    builds: [
      { name: 'Ванилла 1.21.4', seconds: 61_200, last: ago(30 * 60_000) },
      { name: 'Fabric 1.21', seconds: 28_800, last: ago(3 * DAY) },
      { name: 'Immortal 3.0.1', seconds: 14_400, last: ago(11 * DAY) },
    ],
    servers: [
      { addr: 'srv-demo.millida.net', name: 'Наш выживач', seconds: 54_000, last: ago(30 * 60_000) },
      { addr: 'mc.hypixel.ru', name: 'Выживание Кирпича', seconds: 21_600, last: ago(2 * DAY) },
    ],
  })],
  [/^\/friends\/stats\/hide$/, ok],
  [/^\/friends\/presence\/heartbeat$/, ok],
  [/^\/friends\/search$/, (p) => {
    const q = (new URLSearchParams(p.split('?')[1] || '').get('q') || '').toLowerCase()
    if (!q) return []
    return FRIENDS.filter((f) => f.nickname.toLowerCase().includes(q)).map((f) => ({
      userId: f.userId,
      nickname: f.nickname,
      isFriend: true,
    }))
  }],
  [/^\/friends\/profile\//, (p) => {
    const uid = bare(p).replace('/friends/profile/', '')
    const f = FRIENDS.find((x) => x.userId === uid)
    return {
      nick: (f && f.nickname) || 'Игрок',
      text: f && f.online ? 'В сети' : 'Был недавно',
      online: !!(f && f.online),
      playing: !!(f && f.playing),
      serverIp: (f && f.serverIp) || null,
      serverName: (f && f.serverName) || null,
      build: (f && f.build) || null,
      stats: { totalSeconds: 43_200, sessions: 31, builds: [], servers: [] },
    }
  }],
  [/^\/friends\/poll$/, () => ({ now: Date.now(), waited: false, nextPollMs: 30_000 })],
  // Сигнализация звонков держится на долгом запросе: её цикл не ждёт таймера, а
  // сразу спрашивает снова. Мгновенный ответ здесь вешал вкладку намертво,
  // поэтому демо тоже «держит» соединение.
  [/^\/friends\/call\/poll$/, () => hold({ cursor: 0, events: [] })],
  [/^\/friends\/call\//, ok],
  [/^\/friends\/chat\/message\//, ok],
  [/^\/friends\/chat\/upload$/, ok],
  [/^\/friends\/chat\//, (p, method) => {
    if (method !== 'GET') return ok()
    const id = decodeURIComponent(bare(p).replace('/friends/chat/', ''))
    return { messages: CHATS[id] || [], hasMore: false, peerReadAt: ago(5 * 60_000) }
  }],
  [/^\/friends\/(accept|decline|cancel|remove|request|block)$/, ok],
  [/^\/chat\/stickers$/, () => ({ packs: [] })],

  // Хостинг: один сервер, чтобы экран управления открывался
  // m-demo-noserver=1 — человек без сервера: видно продажу хостинга в «Друзьях»
  // и путь «Позвать играть» → создание сервера.
  // «На сервер» из каталога: демо-сервер подходит всему (карта и сборка меняют мир).
  [/^\/hosting\/servers\/compatible$/, (p) => {
    const sec = new URLSearchParams(p.split('?')[1] || '').get('section') || ''
    const world = sec === 'maps' || sec === 'modpacks' || sec === 'server-packs'
    return {
      item: { title: '', kind: 'MOD', replacesWorld: world, changesCore: sec !== 'maps' && world },
      servers: localStorage.getItem('m-demo-noserver') === '1' ? [] : [{
        id: SERVER.id, name: SERVER.name, address: SERVER.address, core: SERVER.core, coreLabel: 'Paper',
        version: SERVER.version, status: 'STOPPED', online: false, compatible: true, reason: null, fileVersion: null,
      }],
    }
  }],
  [/^\/hosting\/servers\/me$/, () => (localStorage.getItem('m-demo-noserver') === '1' ? [] : [SERVER])],
  [/^\/hosting\/servers\/[^/]+$/, () => SERVER_DETAIL],
  [/^\/hosting\/servers\/[^/]+\/stats$/, serverStats],
  [/^\/hosting\/servers\/[^/]+\/online$/, () => ({
    players: [
      { name: DEMO_NICK, uuid: DEMO_UUID_DASHED },
      { name: 'Kirpich', uuid: '1a2b3c4d5e6f4a5b8c9d0e1f2a3b4c5d' },
      { name: 'Grom228', uuid: '2b3c4d5e6f7a4b5c8d9e0f1a2b3c4d5e' },
    ],
  })],
  [/^\/hosting\/servers\/[^/]+\/backups$/, () => [
    { id: 'bk-1', name: 'Перед обновлением', sizeMb: 412, createdAt: iso(ago(DAY)), status: 'READY' },
    { id: 'bk-2', name: 'Ночная копия', sizeMb: 398, createdAt: iso(ago(3 * DAY)), status: 'READY' },
  ]],
  [/^\/hosting\/servers\/[^/]+\/events$/, () => [
    { id: 'e-1', kind: 'start', message: 'Сервер запущен', actorLabel: DEMO_NICK, createdAt: iso(ago(3 * 3_600_000)) },
    { id: 'e-2', kind: 'backup_ok', message: 'Копия создана', actorLabel: null, createdAt: iso(ago(DAY)) },
    { id: 'e-3', kind: 'settings', message: 'Изменены настройки мира', actorLabel: DEMO_NICK, createdAt: iso(ago(2 * DAY)) },
  ]],
  [/^\/hosting\/servers\/[^/]+\/installs\/updates$/, () => []],
  [/^\/hosting\/servers\/[^/]+\/installs$/, () => [
    { id: 'i-1', kind: 'PLUGIN', source: 'modrinth', projectId: 'essentialsx', versionId: 'v1', name: 'EssentialsX', versionName: '2.20.1', iconUrl: null, status: 'INSTALLED', error: null, createdAt: iso(ago(20 * DAY)) },
    { id: 'i-2', kind: 'PLUGIN', source: 'modrinth', projectId: 'coreprotect', versionId: 'v1', name: 'CoreProtect', versionName: '22.4', iconUrl: null, status: 'INSTALLED', error: null, createdAt: iso(ago(18 * DAY)) },
  ]],
  [/^\/hosting\/servers\/[^/]+\/worlds$/, () => [
    { name: 'world', sizeMb: 1_240, dimension: false, active: true },
    { name: 'world_nether', sizeMb: 310, dimension: true, active: false },
  ]],
  [/^\/hosting\/servers\/[^/]+\/files$/, () => [
    { name: 'plugins', size: 0, dir: true, modTime: iso(ago(DAY)) },
    { name: 'world', size: 0, dir: true, modTime: iso(ago(3_600_000)) },
    { name: 'server.properties', size: 1_420, dir: false, modTime: iso(ago(2 * DAY)) },
    { name: 'ops.json', size: 210, dir: false, modTime: iso(ago(6 * DAY)) },
  ]],
  [/^\/hosting\/servers\/[^/]+\/files\/content$/, () => ({ path: 'server.properties', content: 'motd=Наш выживач\nmax-players=10\npvp=true\n' })],
  [/^\/hosting\/servers\/[^/]+\/schedules$/, () => [
    { id: 's-1', kind: 'restart', enabled: true, minute: 240, days: 127, lastRunAt: iso(ago(20 * 3_600_000)) },
  ]],
  [/^\/hosting\/servers\/[^/]+\/ports$/, () => ({ ports: [], limit: 2, address: 'srv-demo.millida.net' })],
  [/^\/hosting\/servers\/[^/]+\/database$/, () => null],
  [/^\/hosting\/servers\/[^/]+\/sftp$/, () => ({ active: false, host: null, port: 2022, login: 'demo', expiresAt: null })],
  [/^\/hosting\/servers\/[^/]+\/shares$/, () => []],
  [/^\/hosting\/servers\/[^/]+\/api-keys$/, () => []],
  [/^\/hosting\/servers\/[^/]+\/notifications$/, () => ({ events: {} })],
  [/^\/hosting\/servers\/[^/]+\/features$/, () => ({
    compatible: true,
    core: 'paper',
    bedrock: { enabled: false, address: null, port: null },
    map: { enabled: false, url: null, port: null },
  })],
  [/^\/hosting\/servers\/[^/]+\/usage$/, () => ({
    days: 7,
    points: Array.from({ length: 7 }, (_, i) => ({ date: iso(ago((6 - i) * DAY)).slice(0, 10), runningMinutes: 1_380 - i * 20, peakPlayers: 3 + (i % 3), crashes: 0 })),
    summary: { runningHours: 160, ramGbHours: 320, peakPlayers: 5, crashes: 0, uptimePercent: 99.1 },
  })],
  [/^\/hosting\/servers\/[^/]+\/crash$/, () => ({ reason: null, hint: null, lines: [] })],
  [/^\/hosting\/servers\//, ok],

  // Телеметрия ошибок в демо никуда не уходит
  [/^\/errors$/, ok],
]

/**
 * Демо-ответ для пути или `undefined`, если его нет: тогда запрос идёт на прод
 * живым — публичные данные в демо остаются настоящими.
 */
export function demoAnswer(pathname: string, opts?: RequestInit): Promise<unknown> | undefined {
  if (!DEMO_USER && !(ECONOMY_SHOWCASE && ECONOMY_PATHS.test(bare(pathname)))) return undefined
  const path = bare(pathname)
  const method = ((opts && opts.method) || 'GET').toUpperCase()
  let body: any
  if (opts && typeof opts.body === 'string') {
    try {
      body = JSON.parse(opts.body)
    } catch {}
  }
  for (const [re, handler] of ROUTES) {
    if (!re.test(path)) continue
    const answer = handler(pathname, method, body)
    if (answer === undefined) return undefined
    return Promise.resolve(answer)
  }
  return undefined
}
