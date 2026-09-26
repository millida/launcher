import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { PixelField } from '../components/lobby/PixelField'
import { SKINS_IMPORT_EVENT, SKINS_UPLOAD_EVENT } from '../state/topbar'
import { getAccount, useAccounts } from '../state/accounts'
import type { Account } from '../state/accounts'
import { noteCosmeticsSeen } from '../state/newHint'
import { setScreen, showToast } from '../state/ui'
import { accKindLabel } from '../lib/format'
import { onRenderGate, renderLive } from '../lib/renderGate'
import { hasTauri } from '../ipc/tauri'
import {
  deleteTexture,
  fetchTexture,
  listTextures,
  mcTextures,
  msProfile,
  msSetCape,
  msUploadSkin,
  pickTexture,
  saveTexture,
  setLocalSkin,
  setTextureSlim,
} from '../ipc/commands'
import type { MsCape, TextureEntry, TextureKind } from '../ipc/commands'
import { loadMine3d } from '../lib/mine3d'
import { headLook } from '../lib/headLook'
import type { Mine3dModule } from '../lib/mine3d'
import type { SkinAnimation, SkinViewEngine } from '../vendor/mine3d'
import { textureSource } from '../lib/textureSource'
import { detectSlim, detectSlimFromUrl, loadImg } from '../lib/skinArms'
import { contentFingerprint, dedupeCapes, textureHash } from '../lib/capes'
import { SkinBody } from '../components/SkinBody'
import {
  addToWardrobe,
  applyCatalogCape,
  applyCosmetics,
  loadPlus,
  subscribePlus,
  gameProfile,
  loadCosmeticCatalog,
  loadCosmeticOwned,
  loadWornCosmetics,
  applyWardrobeItem,
  claimReward,
  loadCapeCatalog,
  loadMojangCapes,
  loadRewards,
  loadWardrobe,
  removeWardrobeItem,
  setSkinSource,
  skinSource,
  uploadTexture,
} from '../lib/gameProfile'
import type {
  CapeCatalogItem,
  MojangCape,
  CosmeticItem,
  PlusStatus,
  RewardItem,
  WardrobeItem,
  WornCosmetic,
} from '../lib/gameProfile'
import { refreshGameNick, useGameNick } from '../state/gameNick'
import { hasMillidaAccount, LAUNCHER_API, openExt, SUPPORT_URL } from '../lib/api'
import { track, trackFailure } from '../lib/telemetry'
import { purchaseFlow } from '../lib/purchaseTrack'
import { loadMillidaProfile, logoutToLogin } from '../lib/session'
import { ensureMsAuth } from '../state/msLogin'
import { apiErrorText } from '../lib/apiError'
import { buildCosmetic } from '../lib/cosmeticModel'
import { sectionTakeOff } from '../lib/sectionTakeOff'
import { CosmeticEmote, emoteClip } from '../lib/cosmeticEmote'
import { emoteSequence } from '../lib/emoteSequence'
import { defaultVariant } from '../lib/cosmeticVariants'
import { starredFirst, starredIds, toggleStar } from '../state/cosmeticStars'
import { readAnimations } from '../lib/cosmeticAnimation'
import { loadShowcase, showcaseSkinUrl, type ShowcaseCard, type ShowcaseKind } from '../lib/skinShowcase'
import { buyCosmetic, loadBalance } from '../lib/rubies'
import { useVariantPreview } from '../lib/variantArt'
import { uiConfirm } from '../state/confirm'
import { watchPlusPurchase } from '../state/plusWatch'
import { PlusCelebration } from '../components/PlusCelebration'
import { useWearIntent } from '../state/wearIntent'
import { ChipRow, SectionBar } from '../components/character/Sections'
import type { Section } from '../components/character/Sections'
import { ItemGrid, ItemTile } from '../components/character/ItemTile'
import { FittingBar } from '../components/character/FittingBar'
import { nametagSpot } from '../components/character/Nametag'
import { Outfits } from '../components/character/Outfits'
import {
  addOutfit,
  loadOutfits,
  OUTFITS_LIMIT,
  removeOutfit,
  renameOutfit,
  sameLook,
  saveOutfits,
  splitWearable,
} from '../state/outfits'
import type { Look, Outfit } from '../state/outfits'
import {
  FULL_FILL_Y,
  FULL_OFFSET_Y,
  IDLE_SHOW,
  IDLE_SHOW_FIRST_MAX,
  IDLE_SHOW_FIRST_MIN,
  IDLE_SHOW_GAP_MAX,
  IDLE_SHOW_GAP_MIN,
  MILLIDA_LIGHT,
  MODEL_CACHE,
  TURN_PER_PIXEL,
  between,
  cosmeticModel,
  releaseEngine,
  tagBox,
} from '../lib/characterStage'
import '../styles/pixel/character.css'
import { showReward } from '../components/reward/RewardReveal'
import { rarityOfPrice } from '../components/shop/rarity'
import { openPaymentUrl } from '../lib/openPayment'
import { drawFront } from '../lib/skinFlat'
import { noteContextLost } from '../lib/gpuLite'

interface CatalogSkin {
  key: string
  label: string
  nick?: string
  url?: string
}

const mojangTexture = (hash: string) => 'https://textures.minecraft.net/texture/' + hash

const EARNED_BY: Record<string, string> = {
  ACHIEVEMENT: 'Достижение',
  HOURS: 'Часы в игре',
  QUEST: 'Задание',
  SEASON: 'Сезон',
  PLUS_MONTH: 'PLUS',
  WELCOME: 'Подарок',
}

const onSale = (c: CosmeticItem) => c.access === 'PURCHASE' && (c.priceRubies ?? 0) > 0

const earnedNote = (c: CosmeticItem) => (c.access === 'PURCHASE' && !onSale(c) ? EARNED_BY[c.channel ?? ''] ?? 'Не продаётся' : undefined)


/** Дата словами: «до 14 октября» читается, «2026-10-14T00:00:00Z» - нет. */

const rubles = (kopecks: number) => Math.round(kopecks / 100) + ' ₽'

/** «1 рубин», «2 рубина», «5 рубинов» — цену читают, а не считают падежи. */
function rubyWord(count: number): string {
  const tens = Math.abs(count) % 100
  const ones = tens % 10
  if (tens > 10 && tens < 20) return 'рубинов'
  if (ones === 1) return 'рубин'
  if (ones >= 2 && ones <= 4) return 'рубина'
  return 'рубинов'
}

/** Сколько вещей раздела видно сразу и сколько добавляет подход к концу ленты. */
const COSMETICS_FIRST_PAGE = 24
const COSMETICS_PAGE = 24

/**
 * Хвост ленты: подход к нему раскрывает следующую порцию. Кнопка «Ещё» стояла
 * в конце каждой полки, и листать приходилось кликами (владелец 23.09.2026).
 * Корень наблюдения — панель, если листается она, иначе окно: на узком экране
 * панель не прокручивается сама. Ключ снаружи пересоздаёт наблюдателя после
 * каждой порции, иначе хвост, оставшийся в зоне, второй раз не сработает.
 */
function LoadMore({ onMore }: { onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const more = useRef(onMore)
  more.current = onMore
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const box = el.closest('.ch-panel') as HTMLElement | null
    const root = box && /(auto|scroll)/.test(getComputedStyle(box).overflowY) ? box : null
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) more.current()
      },
      { root, rootMargin: '0px 0px 600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className="ch-tail" aria-hidden="true" />
}


/** Отдельная «полка» фильтра: не место на теле, а то, что даёт подписка. */

/**
 * Картинка вещи. У эмоций и эффектов её нет и быть не может: эмоция - движение
 * тела, эффект - частицы, рисовать там нечего. Поэтому вместо пустой плашки
 * показываем знак вида вещи, иначе карточка читается как несработавшая
 * загрузка.
 */
/// Сеть в каталоге на семьсот картинок рвётся регулярно: одна не доехавшая
/// картинка оставляла в сетке пустую рамку до перезахода в раздел. Пробуем
/// столько раз, сколько имеет смысл ждать, и только потом показываем значок.
///
/// CDN под пачкой из сотни превью отвечает 502 с HTML, браузер режет такой
/// ответ (ERR_BLOCKED_BY_ORB), и вместо вещей стояли значки — «ужасные иконки»
/// (владелец 23.09.2026). Поэтому попыток больше, пауза растёт вдвое и
/// разбросана случайно: повторы не бьют в сервер одной волной.
const ART_RETRIES = 6
const artRetryDelay = (tries: number) => Math.min(15_000, 600 * 2 ** tries) * (0.6 + Math.random() * 0.8)

/**
 * Насколько вещь занимает свою картинку. Превью рисуются в одном кадре 160×160,
 * и мелкий питомец в нём — пятнышко посередине: «маленький кот» (владелец
 * 24.09.2026). Меряем непрозрачную часть и увеличиваем её до ~86% карточки.
 * CDN отдаёт превью с Access-Control-Allow-Origin: *, пиксели читать можно.
 */
const ART_FIT = new Map<string, string>()
const ART_FILL = 0.86
const ART_MAX_ZOOM = 1.8

function artFit(img: HTMLImageElement): string {
  const key = img.currentSrc || img.src
  const known = ART_FIT.get(key)
  if (known !== undefined) return known
  let fit = ''
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })
    if (g && w && h) {
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, w, h).data
      let x0 = w
      let y0 = h
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if ((d[(y * w + x) * 4 + 3] as number) > 24) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      if (x1 >= x0) {
        const span = Math.max((x1 - x0 + 1) / w, (y1 - y0 + 1) / h)
        const zoom = Math.min(ART_MAX_ZOOM, ART_FILL / span)
        if (zoom > 1.04) {
          const dx = ((w / 2 - (x0 + x1 + 1) / 2) / w) * 100
          const dy = ((h / 2 - (y0 + y1 + 1) / 2) / h) * 100
          fit = 'scale(' + zoom.toFixed(3) + ') translate(' + dx.toFixed(2) + '%, ' + dy.toFixed(2) + '%)'
        }
      }
    }
  } catch {
    // Картинка без CORS: оставляем как есть.
  }
  ART_FIT.set(key, fit)
  return fit
}

function CosmeticArt({ item, height, onGiveUp }: { item: CosmeticItem; height: number; onGiveUp?: () => void }) {
  // Вещь-расцветка (v3.1): превью своей расцветки, а не базовой.
  const preview = useVariantPreview(item.preview, item.tintFrom, item.tint)
  const [shown, setShown] = useState(false)
  const [fit, setFit] = useState('')
  const [tries, setTries] = useState(0)
  const [gaveUp, setGaveUp] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setShown(false)
    setTries(0)
    setGaveUp(false)
  }, [preview])

  useEffect(() => () => clearTimeout(timer.current), [])

  if (item.preview && !preview && !gaveUp) {
    // Перекраска ещё идёт: пустое место той же высоты, без мигания базовым цветом.
    return <span style={{ display: 'block', width: height, height }} />
  }
  if (preview && !gaveUp) {
    return (
      <img
        // Новый адрес на каждую попытку: браузер держит неудачу в памяти и по
        // тому же адресу второй раз в сеть не пойдёт. Перекрашенное (data:) не повторяем.
        src={tries && !preview.startsWith('data:') ? preview + (preview.includes('?') ? '&' : '?') + 'retry=' + tries : preview}
        alt=""
        width={height}
        height={height}
        loading="lazy"
        decoding="async"
        crossOrigin="anonymous"
        onLoad={(e) => {
          setFit(artFit(e.currentTarget))
          setShown(true)
        }}
        onError={() => {
          if (tries >= ART_RETRIES) {
            setGaveUp(true)
            onGiveUp?.()
            return
          }
          // Пауза растёт: сеть после обрыва возвращается не мгновенно, а
          // семьсот карточек, бьющихся разом, добьют её окончательно.
          timer.current = setTimeout(() => setTries((n) => n + 1), artRetryDelay(tries))
        }}
        style={{
          maxWidth: '100%',
          maxHeight: height + 'px',
          height: 'auto',
          imageRendering: 'pixelated',
          // Прячем прозрачностью, а не display: скрытая картинка не попадает в
          // видимую область, и отложенная загрузка не начинается никогда -
          // каталог так и стоит пустым.
          opacity: shown ? 1 : 0,
          transform: fit || undefined,
          transition: 'opacity var(--m-t-base)',
        }}
      />
    )
  }
  const sign = item.slot === 'EMOTE' ? 'i-smile' : item.slot === 'EFFECT' || item.slot === 'AURA' ? 'i-zap' : 'i-shirt'
  return (
    <span className="cosmetic-sign">
      <Icon id={sign} />
    </span>
  )
}

const OFFICIAL_SKINS: CatalogSkin[] = [
  { key: 'off-steve', label: 'Стив', url: mojangTexture('31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb') },
  { key: 'off-alex', label: 'Алекс', url: mojangTexture('46acd06e8483b176e8ea39fc12fe105eb3a2a4970f5100057e9d84d4b60bdfa7') },
  { key: 'off-ari', label: 'Ари', url: mojangTexture('6ac6ca262d67bcfb3dbc924ba8215a18195497c780058a5749de674217721892') },
  { key: 'off-efe', label: 'Эфе', url: mojangTexture('fece7017b1bb13926d1158864b283b8b930271f80a90482f174cca6a17e88236') },
  { key: 'off-makena', label: 'Макена', url: mojangTexture('7cb3ba52ddd5cc82c0b050c3f920f87da36add80165846f479079663805433db') },
  { key: 'off-noor', label: 'Нур', url: mojangTexture('6c160fbd16adbc4bff2409e70180d911002aebcfa811eb6ec3d1040761aea6dd') },
  { key: 'off-zuri', label: 'Зури', url: mojangTexture('eee522611005acf256dbd152e992c60c0bb7978cb0f3127807700e478ad97664') },
]


/**
 * Разделы гардероба — два уровня, как в Roblox и Essential
 * (~/Documents/Claude/Работа/Проекты/millida/analysis/2026-09-23_wardrobe-research.md).
 * Верхний уровень — крупные разделы по телу, внутри — подкатегории чипами.
 * Девятнадцать вкладок по местам каталога читались как свалка (владелец
 * 23.09.2026: «дохуя всего и непонятно, как с этим работать»).
 */
interface ChipDef {
  key: string
  name: string
  slots: string[]
}

interface SectionDef {
  key: string
  name: string
  icon: string
  chips: ChipDef[]
}

const COSMETIC_SECTIONS: SectionDef[] = [
  {
    key: 'head',
    name: 'Голова',
    icon: 'i-hat',
    chips: [
      { key: 'HAT', name: 'Шляпы', slots: ['HAT'] },
      { key: 'HEAD', name: 'Причёски', slots: ['HEAD'] },
      { key: 'FACE', name: 'Лицо', slots: ['FACE'] },
      { key: 'EARS', name: 'Уши и рога', slots: ['EARS'] },
    ],
  },
  {
    key: 'body',
    name: 'Тело',
    icon: 'i-shirt',
    chips: [
      { key: 'FULL_BODY', name: 'Костюмы', slots: ['FULL_BODY'] },
      { key: 'TOP', name: 'Верх', slots: ['TOP', 'ACCESSORY'] },
      { key: 'PANTS', name: 'Низ', slots: ['PANTS', 'SKIRT', 'WAIST'] },
      { key: 'SHOES', name: 'Обувь', slots: ['SHOES', 'FEET'] },
      { key: 'ARMS', name: 'Руки', slots: ['ARMS', 'HAND', 'SHOULDERS', 'SHOULDER'] },
    ],
  },
  {
    key: 'back',
    name: 'Спина',
    icon: 'i-wings',
    chips: [
      { key: 'WINGS', name: 'Крылья', slots: ['WINGS'] },
      { key: 'BACK', name: 'За спиной', slots: ['BACK'] },
    ],
  },
  { key: 'pet', name: 'Питомцы', icon: 'i-paw', chips: [{ key: 'PET', name: 'Питомцы', slots: ['PET'] }] },
  // Эмоции и ауры — одно «живое» место: не вещь на теле, а движение и частицы
  // (у Essential эмоции тоже отдельно от слотов). Так разделов восемь, а не девять.
  {
    key: 'emote',
    name: 'Эмоции',
    icon: 'i-smile',
    chips: [
      { key: 'EMOTE', name: 'Эмоции', slots: ['EMOTE'] },
      { key: 'EFFECT', name: 'Ауры', slots: ['EFFECT', 'AURA', 'ICON'] },
    ],
  },
]

const KNOWN_SLOTS = new Set(['CAPE', ...COSMETIC_SECTIONS.flatMap((s) => s.chips.flatMap((c) => c.slots))])

/** Разделы с учётом того, что реально есть в каталоге: новое место каталога уходит в «Тело · Другое». */
function cosmeticSections(slots: string[]): SectionDef[] {
  // Каталог ещё грузится — показываем все разделы сразу, иначе первые секунды
  // видны только «Образы, Скины, Плащи» и полоса прыгает (владелец 24.09.2026).
  if (!slots.length) return COSMETIC_SECTIONS
  const unknown = Array.from(new Set(slots.filter((s) => !KNOWN_SLOTS.has(s))))
  return COSMETIC_SECTIONS.map((sec) => ({
    ...sec,
    chips: sec.chips
      .concat(sec.key === 'body' && unknown.length ? [{ key: 'OTHER', name: 'Другое', slots: unknown }] : [])
      .filter((c) => c.slots.some((slot) => slots.includes(slot))),
  })).filter((sec) => sec.chips.length > 0)
}

const SKIN_CHIPS: { key: 'mine' | ShowcaseKind; name: string }[] = [
  { key: 'mine', name: 'Мои' },
  { key: 'top', name: 'Популярные' },
  { key: 'new', name: 'Новые' },
  { key: 'random', name: 'Случайные' },
]

const NICK_RE = /^[A-Za-z0-9_]{3,16}$/

/** Сколько живёт «Отменить» после удаления скина: столько же, сколько тост с действием. */
const SKIN_UNDO_MS = 7000

const rewardProgress = (r: { unit: string; progress: number; goal: number }) =>
  r.unit === 'seconds'
    ? Math.floor(r.progress / 3600) + ' из ' + Math.floor(r.goal / 3600) + ' ч'
    : r.progress + ' из ' + r.goal

const MILLIDA_SKINS_URL = 'https://millida.net/skins'

const MILLIDA_CAPE = '/capes/millida.png'


// Kept as files on disk: localStorage hit the webview quota and lost entries silently.
type MySkin = TextureEntry

interface CapeOption {
  id: string
  name: string
  url: string
  sub: string
  onAccount?: boolean
  active?: boolean
  msId?: string
  accId?: string
  wardrobeId?: string
  /// Карточка каталога: плащ надевается по этому идентификатору, PNG на сервер
  /// не уходит — плащ выдаёт сервер, а не файл на диске.
  catalogId?: string
  /// Плащ из каталога Millida, условие которого ещё не выполнено: карточка
  /// затемнена, надеть нельзя, но видно, что и сколько осталось сделать.
  locked?: boolean
  /// Текст условия получения («Наиграть 10 часов»).
  requirement?: string
  /// 0..100 — прогресс по условию.
  progress?: number
  /// «7 / 10 часов» — человеческий счётчик под полоской.
  progressLabel?: string
  rarity?: string
  /// Плащ за задание лаунчера: код задания, чтобы забрать его из окна условия.
  rewardCode?: string
  /// Условие выполнено — плащ можно забрать прямо сейчас.
  rewardReady?: boolean
  /// Подсказка, где выполняется условие.
  hint?: string
  /// Плащ выдаётся за достижение, а не просто лежит на аккаунте. Такие живут во
  /// вкладке украшений вместе с остальной косметикой, ради которой играют.
  earned?: boolean
}


async function migrateStored(kind: TextureKind, key: string): Promise<MySkin[] | null> {
  let stored: { name?: string; data?: string; slim?: boolean }[] = []
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    stored = Array.isArray(parsed) ? parsed : []
  } catch {
    localStorage.removeItem(key)
    return null
  }
  let list: MySkin[] | null = null
  for (const item of stored.slice(0, 24).reverse()) {
    if (!item || typeof item.data !== 'string') continue
    try {
      list = await saveTexture(kind, item.name || 'Скин', item.data, !!item.slim)
    } catch {}
  }
  localStorage.removeItem(key)
  return list
}

const skinBust = new Map<string, number>()

const skinUrl = (n: string) => {
  const base = LAUNCHER_API + '/heads/skin/' + encodeURIComponent(n)
  const v = skinBust.get(n.trim().toLowerCase())
  return v ? base + '?v=' + v : base
}

/// Сброс скина проходит на лицензии сразу, а /v2/heads отдаёт прежнюю текстуру:

// Manual arm type wins over autodetect, which misreads skins without transparent areas.
const VARIANT_KEY = 'm-skin-variant'

function readVariants(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(VARIANT_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// Ручной выбор рук больше не учитываем: руки определяются по текстуре
// (правка владельца 23.09.2026), старые сохранённые выборы игнорируются.
function recallVariant(_key: string): string | null {
  return null
}

function rememberVariant(key: string, variant: string) {
  const map = readVariants()
  map[key] = variant
  const keys = Object.keys(map)
  for (const stale of keys.slice(0, Math.max(0, keys.length - 200))) delete map[stale]
  try {
    localStorage.setItem(VARIANT_KEY, JSON.stringify(map))
  } catch {}
}


// The figure is 32 skin pixels tall, so only a multiple of 32 keeps every pixel
// the same height on screen; 132 px gave rows of 4 and 5 pixels side by side.
const FIGURE_CELLS = 32
const CAPE_CELLS = 16
const snapPx = (px: number, cells: number) => Math.max(1, Math.round(px / cells)) * cells

function SkinThumb({ url, size: askedSize = 128, slim }: { url: string; size?: number; slim?: boolean }) {
  const size = snapPx(askedSize, FIGURE_CELLS)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    loadImg(url)
      .then((img) => {
        if (!alive) return
        const cv = ref.current
        if (!cv) return
        const g = cv.getContext('2d')
        if (!g) return
        cv.width = 16
        cv.height = 32
        drawFront(g, img, slim === undefined ? detectSlim(img) : slim)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url, slim])
  return (
    <canvas
      ref={ref}
      style={{ width: (size * 16) / 32 + 'px', height: size + 'px', imageRendering: 'pixelated', display: 'block' }}
    />
  )
}

function SkinCardThumb({ url, slim }: { url: string; slim?: boolean }) {
  return (
    <SkinBody
      url={url}
      model={slim === undefined ? 'auto-detect' : slim ? 'slim' : 'default'}
      fallback={<SkinThumb url={url} slim={slim} />}
    />
  )
}

function CatalogThumb({ nick, url }: { nick?: string; url?: string }) {
  return <SkinCardThumb url={url || skinUrl(nick || 'MHF_Steve')} />
}

interface AccTexture {
  skin: string
  cape: string | null
  slim: boolean
}

const texCache = new Map<string, { at: number; tex: AccTexture }>()
const TEX_TTL = 300000

const DEFAULT_SKIN = OFFICIAL_SKINS[0].url as string

/// Текстуры Mojang запрашиваем только для лицензии. Офлайн- и Millida-аккаунт
/// ищутся по нику, а ник в Mojang принадлежит другому человеку: раньше игрок
/// видел и применял чужой скин, считая его своим.
async function loadAccountTexture(a: Account, millida: AccTexture | null): Promise<AccTexture> {
  if (a.kind === 'microsoft' && hasTauri()) {
    const key = a.uuid || a.nick
    const hit = texCache.get(key)
    if (hit && Date.now() - hit.at < TEX_TTL) return hit.tex
    try {
      const t = await mcTextures(key)
      const tex = { skin: t.skin || DEFAULT_SKIN, cape: t.cape, slim: !!t.slim }
      texCache.set(key, { at: Date.now(), tex })
      return tex
    } catch {}
  }
  if (a.kind === 'millida' && millida) return millida
  return { skin: DEFAULT_SKIN, cape: null, slim: false }
}

/// Offline and Microsoft accounts keep the skin locally.
async function headDataUrl(url: string, size = 64): Promise<string> {
  const img = await loadImg(url)
  const s = img.width / 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas недоступен')
  g.imageSmoothingEnabled = false
  g.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, size, size)
  if (img.height >= img.width) g.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, size, size)
  return c.toDataURL('image/png')
}

/// Remote textures are CORS-restricted, so re-encode through canvas.
const PNG_DATA_PREFIX = 'data:image/png;base64,'

async function toPngBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url.replace(/^data:image\/png;base64,/, '')
  // Байты уходят на сервер как есть: пережатие через canvas меняет их, а каталог
  // аккаунта схлопывает повторы по хешу PNG — с новым хешем та же текстура
  // ложится в него ещё одной записью.
  const src = await textureSource(url)
  if (src.startsWith(PNG_DATA_PREFIX)) return src.slice(PNG_DATA_PREFIX.length)
  const img = await loadImg(url)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas недоступен')
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/**
 * Повтор запроса при обрыве связи. Наш путь до сервера идёт через щит, и он
 * временами роняет соединение на середине ответа - для игрока это выглядит как
 * «каталог недоступен», хотя сервер жив и следующая попытка проходит.
 */
async function withRetry<T>(run: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown
  for (let at = 0; at < tries; at += 1) {
    try {
      return await run()
    } catch (e) {
      last = e
      if (at + 1 < tries) await new Promise((wait) => setTimeout(wait, 400 * (at + 1)))
    }
  }
  throw last
}

const localMark = (url: string, slim: boolean) => url + '|' + (slim ? 'slim' : 'classic')

// Cape back face: UV (1,1) sized 10x16 on the standard 64x32 cape texture.
function CapePreview({ url, h: askedH = 64 }: { url: string; h?: number }) {
  const h = snapPx(askedH, CAPE_CELLS)
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setFailed(false)
    loadImg(url)
      .then((img) => {
        const cv = ref.current
        if (!alive || !cv) return
        const g = cv.getContext('2d')
        if (!g) return
        const s = img.width / 64
        cv.width = 10
        cv.height = 16
        g.imageSmoothingEnabled = false
        g.clearRect(0, 0, 10, 16)
        g.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, 10, 16)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [url])
  if (failed)
    return (
      <span
        style={{
          width: (h * 10) / 16 + 'px',
          height: h + 'px',
          borderRadius: '4px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--m-inset)',
          color: 'var(--m-fg-faint)',
        }}
      >
        <Icon id="i-image" />
      </span>
    )
  return (
    <canvas
      ref={ref}
      style={{ width: (h * 10) / 16 + 'px', height: h + 'px', imageRendering: 'pixelated', display: 'block', borderRadius: '4px' }}
    />
  )
}

/** Первый свой скин — праздник один раз на компьютер. */
function firstSkinEver(): boolean {
  try {
    if (localStorage.getItem('m-first-skin')) return false
    localStorage.setItem('m-first-skin', '1')
    return true
  } catch {
    return false
  }
}

export function Skins({ on }: { on: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SkinViewEngine | null>(null)
  const accounts = useAccounts((s) => s.list)
  const activeId = useAccounts((s) => s.active)
  const [nick, setNick] = useState(() => (getAccount() || { nick: '' }).nick || 'MHF_Steve')
  const [skinSrc, setSkinSrc] = useState<string | null>(null)
  // Последний применённый скин — для «Вернуть» в уведомлении. Выбор скина сразу
  // применяет его на аккаунт, и случайный клик по каталогу раньше нечем было
  // откатить (аудит 22.09.2026, docs/audit-2026-09-22/social.md).
  const appliedRef = useRef<string | null>(null)
  // Номер последнего выбора скина и очередь запросов к серверу: каждый новый
  // клик делает прежние устаревшими, и они не доходят до сервера.
  const skinPick = useRef(0)
  const skinQueue = useRef<Promise<unknown>>(Promise.resolve())
  /** Выбор сделан руками: обновление каталога больше не переставляет отметку и фигуру. */
  const userPicked = useRef(false)
  const startSkinPick = () => {
    userPicked.current = true
    return ++skinPick.current
  }
  const queueSkin = (token: number, job: () => Promise<void>): Promise<void> => {
    const run = skinQueue.current.then(() => (token === skinPick.current ? job() : undefined))
    skinQueue.current = run.catch(() => {})
    return run
  }
  useEffect(() => {
    if (appliedRef.current == null && skinSrc) appliedRef.current = skinSrc
  }, [skinSrc])
  const [variant, setVariant] = useState('classic')
  const [cape, setCape] = useState('none')
  // Раздел гардероба и выбранный в нём чип. Чип помнится за разделом: вернулся
  // в «Голову» — снова на тех же шляпах.
  // Гардероб открывается с первого раздела — «Образы» (владелец 24.09.2026).
  const [section, setSection] = useState('looks')
  const [chipBy, setChipBy] = useState<Record<string, string>>({})
  const [own, setOwn] = useState('all')
  const [catQuery, setCatQuery] = useState('')
  const [catKind, setCatKind] = useState<ShowcaseKind>('top')
  const [catCards, setCatCards] = useState<ShowcaseCard[]>([])
  const [catFailed, setCatFailed] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [svReady, setSvReady] = useState(false)
  const [m3d, setM3d] = useState<Mine3dModule | null>(null)
  const [engineReady, setEngineReady] = useState(0)
  const [modelShown, setModelShown] = useState(false)
  const [viewerAwake, setViewerAwake] = useState(false)
  const [mySkins, setMySkins] = useState<MySkin[]>([])
  const [myCapes, setMyCapes] = useState<MySkin[]>([])
  const [textures, setTextures] = useState<Record<string, AccTexture>>({})
  // Сброс скина знает правду о текстурах раньше их источников: счётчик заставляет
  // перечитать текстуры аккаунтов после того, как кеш уже заполнен этой правдой.
  const [texEpoch] = useState(0)
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([])
  const [millidaTex, setMillidaTex] = useState<AccTexture | null>(null)
  const [rewards, setRewards] = useState<RewardItem[]>([])
  const [claiming, setClaiming] = useState('')
  const [activeWardrobe, setActiveWardrobe] = useState<string | null>(null)
  // Каталог плащей Millida: и открытые, и закрытые — закрытые показываем
  // затемнёнными с условием, ради них и играют.
  const [capeCatalog, setCapeCatalog] = useState<CapeCatalogItem[]>([])
  const [mojangCapes, setMojangCapes] = useState<MojangCape[]>([])
  // Косметика мода: каталог общий, права — личные, надетое приходит тем же
  // адресом, каким его видят другие игроки.
  const [cosmetics, setCosmetics] = useState<CosmeticItem[]>([])
  const [cosmeticOwned, setCosmeticOwned] = useState<string[]>([])
  /** Каталог, права и надетое доехали (счётчик загрузок) — можно выполнить «Надеть» извне. */
  const [cosReady, setCosReady] = useState(0)
  const wearRefs = useWearIntent((s) => s.refs)
  const [worn, setWorn] = useState<WornCosmetic[]>([])

  const [cosmeticQuery, setCosmeticQuery] = useState('')
  const [cosmeticsFailed, setCosmeticsFailed] = useState(false)
  const [wardrobeFailed, setWardrobeFailed] = useState(false)
  const [plus, setPlus] = useState<PlusStatus | null>(null)
  const [plusBusy, setPlusBusy] = useState(false)
  const [plusJoy, setPlusJoy] = useState(false)
  const stopPlusWatch = useRef<(() => void) | null>(null)
  useEffect(() => () => stopPlusWatch.current?.(), [])
  const endPlusJoy = useCallback(() => setPlusJoy(false), [])
  /**
   * Примерка: вещи, надетые на фигуру в окне, но не на игроке. Мерить надо до
   * покупки и сразу несколько - шляпа с крыльями смотрятся иначе, чем каждая
   * сама по себе, и решение принимают по всему набору.
   */
  const [fitting, setFitting] = useState<CosmeticItem[]>([])
  const [fitLoading, setFitLoading] = useState<string[]>([])
  const [variantById, setVariantById] = useState<Record<string, string>>({})
  const [emoting, setEmoting] = useState(false)
  const [stars, setStars] = useState<string[]>(() => starredIds())
  /**
   * Сколько вещей раскрыто в каждом разделе. Каталог на семьсот картинок,
   * выложенный разом, минуту тянет их по сети и всё это время выглядит пустым:
   * показываем первый экран и раскрываем по просьбе.
   */
  const [shownPerSlot, setShownPerSlot] = useState<Record<string, number>>({})
  const [rubies, setRubies] = useState(0)
  const [cosmeticBusy, setCosmeticBusy] = useState('')
  // Все плащи лицензии по аккаунтам: сессионный профиль отдаёт только надетый,
  // из-за чего «на аккаунте» помечался ровно один плащ.
  const [msCapes, setMsCapes] = useState<Record<string, MsCape[]>>({})
  // Свой скин отмечается по имени файла, а не по месту в списке: список
  // сдвигается при загрузке и удалении, и отметка переезжала на соседний скин
  // (владелец 24.09.2026: «нажимаю одно — применяет другое»).
  const [activeMy, setActiveMy] = useState<string | null>(null)
  const activeMyRef = useRef<string | null>(null)
  activeMyRef.current = activeMy
  const mySkinOf = (file: string | null) => (file ? mySkins.find((s) => s.file === file) : undefined)
  const capeTouched = useRef(false)
  const wardrobeVariantRef = useRef(false)
  // Request sequence: a late autodetect answer must not override a newer choice.
  const autoSeq = useRef(0)
  // Чей это вариант рук: переключатель на сцене запоминает выбор за тем же
  // скином, за которым его помнит автоопределение.
  const variantKeyRef = useRef('')
  const [, setTagAt] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!hasTauri()) return
    let alive = true
    const load = async (kind: TextureKind, key: string, apply: (list: MySkin[]) => void) => {
      try {
        const migrated = await migrateStored(kind, key)
        const list = migrated || (await listTextures(kind))
        if (alive) apply(list)
      } catch (e) {
        showToast('Не удалось прочитать свои текстуры: ' + e, 'error')
      }
    }
    void load('skins', 'm-my-skins', setMySkins)
    void load('capes', 'm-my-capes', setMyCapes)
    return () => {
      alive = false
    }
  }, [])

  // Локальную копию читает мод скинов в игре. Она обновляется только тем, что
  // делает лаунчер, поэтому скин, надетый на сайте или пришедший из заказа,
  // оставлял в игре текстуру с прошлого «Применить»: другие игроки видели новую,
  // сам игрок — старую.
  const localSkinRef = useRef('')
  const syncLocalSkin = async (url: string | null, slim: boolean) => {
    if (!hasTauri() || !url) return
    const mark = localMark(url, slim)
    if (localSkinRef.current === mark) return
    // Плащ не трогаем: null оставляет его как есть, а на этом компьютере может
    // быть надет плащ, которого на аккаунте нет.
    await setLocalSkin(await toPngBase64(url), null, slim)
    localSkinRef.current = mark
  }

  /// Удалённый скин нельзя ни скопировать, ни оставить в сборке: копия на диске
  /// стирается вместе с ним, иначе в игре остаётся текстура, которой у игрока
  /// больше нет, а попытка её обновить падает на пропавшем файле.
  const dropLocalSkin = async () => {
    if (!hasTauri()) return
    localSkinRef.current = ''
    await setLocalSkin('', null, variant === 'slim').catch(() => {})
  }

  const refreshWardrobe = async () => {
    if (!hasMillidaAccount()) return
    try {
      const w = await withRetry(loadWardrobe)
      setWardrobe(w.items)
      setMillidaTex(
        w.active.skinUrl
          ? { skin: w.active.skinUrl, cape: w.active.capeUrl, slim: w.active.model === 'slim' }
          : null,
      )
      syncHead(w.active.skinUrl)
      const cur = w.items.find((i) => i.kind === 'skin' && i.url === w.active.skinUrl)
      // Пока человек ничего не выбрал, фигура и отметка — как на аккаунте: его
      // собственный скин, а не скин по нику (там стоял стандартный).
      if (!userPicked.current) {
        setActiveWardrobe(cur ? cur.id : null)
        if (w.active.skinUrl) setSkinSrc(w.active.skinUrl)
      }
      await syncLocalSkin(w.active.skinUrl, w.active.model === 'slim').catch((e) =>
        showToast('На этом компьютере скин не обновился — в сборках останется прежний: ' + e, 'error'),
      )
      if (!wardrobeVariantRef.current) {
        wardrobeVariantRef.current = true
        const key = cur ? 'w:' + cur.id : null
        const saved = key ? recallVariant(key) : null
        if (saved || w.active.skinUrl) {
          autoSeq.current++
          setVariant(saved || (w.active.model === 'slim' ? 'slim' : 'classic'))
        }
      }
      setWardrobeFailed(false)
    } catch (e) {
      setWardrobeFailed(true)
      console.warn('[skins] wardrobe', e)
      trackFailure('skins', e, { step: 'wardrobe_load' })
      showToast('Каталог скинов не загрузился', 'error')
    }
  }

  /// Каталог косметики и права на неё. Каталог открыт всем, права — только
  /// вошедшему, поэтому отказ по правам не должен прятать сам каталог.
  const refreshCosmetics = async () => {
    setCosmeticsFailed(false)
    try {
      const catalog = await withRetry(loadCosmeticCatalog)
      setCosmetics(catalog.items || [])
    } catch {
      setCosmetics([])
      // Пустой каталог и не доехавший каталог - разные вещи: во втором случае
      // человеку нужна кнопка, а не сообщение о том, что вещей нет.
      setCosmeticsFailed(true)
      return
    }
    if (!hasMillidaAccount()) {
      setCosReady((n) => n + 1)
      return
    }
    try {
      const owned = await loadCosmeticOwned()
      setCosmeticOwned(owned.items || [])
    } catch {
      setCosmeticOwned([])
    }
    try {
      // uuid игрового профиля, а не аккаунта: «кто что носит» спрашивают по нему.
      const profile = await gameProfile()
      if (profile.uuid) setWorn(await loadWornCosmetics(profile.uuid))
    } catch {
      setWorn([])
    }
    setCosReady((n) => n + 1)
  }

  // «Надеть» из сундука, пропуска или магазина (владелец 24.09.2026, 19:56):
  // своё сразу надевается и сохраняется, чужое встаёт на фигуру примеркой;
  // гардероб открывается на разделе вещи.
  useEffect(() => {
    if (!wearRefs || !cosReady || !cosmetics.length) return
    useWearIntent.getState().set(null)
    const items = wearRefs.flatMap((r) => {
      const same = cosmetics.filter((c) => c.id === r.code || c.baseId === r.code)
      const hit = (r.variant && same.find((c) => c.id.endsWith('~' + r.variant))) || same.find((c) => c.id === r.code) || same[0]
      return hit ? [hit] : []
    })
    if (!items.length) return
    const first = items[0]!
    if (first.slot === 'CAPE') pickSection('cape')
    else {
      const sec = sections.find((x) => x.chips.some((c) => c.slots.includes(first.slot)))
      const chip = sec?.chips.find((c) => c.slots.includes(first.slot))
      if (sec && chip) {
        setChipBy((now) => ({ ...now, [sec.key]: chip.key }))
        pickSection(sec.key)
      }
    }
    const mine = items.filter((c) => !cosmeticLocked(c))
    const other = items.filter((c) => cosmeticLocked(c))
    if (other.length) setFitting((now) => now.filter((c) => !other.some((o) => o.slot === c.slot)).concat(other))
    if (!mine.length) return
    const next = worn
      .filter((w) => !mine.some((c) => c.slot === w.slot))
      .concat(mine.map((c) => ({ id: c.id, slot: c.slot, variant: variantOf(c)?.name })))
    setCosmeticBusy('fitting')
    applyCosmetics(next)
      .then(() => {
        setWorn(next)
        setFitting((now) => now.filter((c) => !mine.some((m) => m.slot === c.slot)))
        showToast('Надето — видно в игре', 'ok')
      })
      .catch((e) => {
        trackFailure('skins', e, { step: 'cosmetic_wear' })
        showToast(apiErrorText(e, 'Не удалось надеть'), 'error')
      })
      .finally(() => setCosmeticBusy(''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wearRefs, cosReady, cosmetics])

  /// Надеть или снять: набор перезаписывается целиком, поэтому здесь и
  /// собирается новый список — сервер не знает про «сними одну».
  /** Вещь закрыта: платная и права на неё пока нет. */
  const cosmeticLocked = (item: CosmeticItem) =>
    item.access !== 'FREE' && !cosmeticOwned.includes(item.id)

  const shownIn = (slot: string) => shownPerSlot[slot] ?? COSMETICS_FIRST_PAGE

  const showMoreIn = (slot: string) =>
    setShownPerSlot((now) => ({ ...now, [slot]: (now[slot] ?? COSMETICS_FIRST_PAGE) + COSMETICS_PAGE }))

  const refreshPlus = () => loadPlus().then(setPlus).catch(() => setPlus(null))

  const refreshRubies = () => loadBalance().then((b) => setRubies(b.balance)).catch(() => setRubies(0))

  /** Выбранный цвет вещи и его картинка: по умолчанию тот же, что на картинке. */
  const variantOf = (item: CosmeticItem) => {
    const list = item.variants ?? []
    if (!list.length) return null
    const picked = variantById[item.id]
    return list.find((v) => v.name === picked) ?? defaultVariant(list)
  }

  const textureOf = (item: CosmeticItem) => variantOf(item)?.texture ?? item.texture

  /** Надеть вещь на фигуру в окне или снять её оттуда. Покупка тут ни при чём. */
  const tryOn = (item: CosmeticItem) => {
    setFitting((now) =>
      now.some((c) => c.id === item.id)
        ? now.filter((c) => c.id !== item.id)
        : now.filter((c) => c.slot !== item.slot).concat(item),
    )
  }

  /**
   * Сет помнится между заходами: собрал, ушёл копить — вернулся и докупил
   * (владелец 24.09.2026). Храним только id, вещи берём из свежего каталога:
   * цена и доступ могли поменяться. Своё и исчезнувшее из каталога отпадает.
   */
  const fitKey = 'm-fitset:' + (activeId || 'guest')
  const fitRestored = useRef('')
  useEffect(() => {
    if (!cosmetics.length || fitRestored.current === fitKey) return
    fitRestored.current = fitKey
    let ids: string[] = []
    try {
      const raw = JSON.parse(localStorage.getItem(fitKey) || '[]')
      if (Array.isArray(raw)) ids = raw.filter((x): x is string => typeof x === 'string')
    } catch {}
    const bySlot = new Map<string, CosmeticItem>()
    for (const id of ids) {
      const item = cosmetics.find((c) => c.id === id)
      if (item && item.access !== 'FREE' && !cosmeticOwned.includes(item.id)) bySlot.set(item.slot, item)
    }
    setFitting(Array.from(bySlot.values()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmetics, fitKey])
  useEffect(() => {
    if (fitRestored.current !== fitKey) return
    try {
      localStorage.setItem(fitKey, JSON.stringify(fitting.map((c) => c.id)))
    } catch {}
  }, [fitting, fitKey])

  /** Что из примеренного придётся купить и сколько это стоит. */
  const fittingBill = fitting.filter((c) => cosmeticLocked(c) && onSale(c))
  const fittingTotal = fittingBill.reduce((sum, c) => sum + (c.priceRubies ?? 0), 0)

  /**
   * Купить весь сет разом — и сразу надеть. Покупаем по одной вещи: сервер
   * списывает и выдаёт право одной проводкой, и частичная неудача не должна
   * отменять уже купленное.
   *
   * Купленное считается своим сразу, не дожидаясь списка прав: раньше вещь
   * после покупки оставалась «закрытой» до ответа /cosmetics/owned, и «Надеть»
   * молча ничего не делало (владелец 24.09.2026).
   */
  const buyFitting = async () => {
    const bill = fittingBill
    if (!bill.length || cosmeticBusy) return
    const total = bill.reduce((sum, c) => sum + (c.priceRubies ?? 0), 0)
    // Воронка покупки сета в гардеробе: id — вещь или число вещей сета.
    const result = purchaseFlow('item', bill.length > 1 ? 'set:' + bill.length : bill[0].id, total, 'rubies')
    const ok = await uiConfirm(
      bill.length > 1
        ? 'Сет из ' + bill.length + ' вещей за ' + total + ' ' + rubyWord(total) + '. Купить и надеть?'
        : '«' + bill[0].name + '» за ' + total + ' ' + rubyWord(total) + '. Купить и надеть?',
      { title: 'Покупка', confirmLabel: 'Купить', cancelLabel: 'Не сейчас', danger: false },
    )
    if (!ok) return result(false, 'cancel')
    setCosmeticBusy('fitting')
    const failed: string[] = []
    const bought: CosmeticItem[] = []
    for (const item of bill) {
      try {
        await buyCosmetic(item.id)
        bought.push(item)
      } catch (e) {
        failed.push(item.name + (e ? ' (' + apiErrorText(e, 'отказ') + ')' : ''))
      }
    }
    const got = bought.map((c) => c.id)
    setCosmeticOwned((now) => Array.from(new Set(now.concat(got))))
    const owned = await loadCosmeticOwned().catch(() => null)
    if (owned) setCosmeticOwned(Array.from(new Set(owned.items.concat(got))))
    await refreshRubies()
    result(bought.length > 0, bought.length ? undefined : 'error')
    if (failed.length) showToast('Не удалось купить: ' + failed.join(', '), 'error')
    if (!bought.length) {
      setCosmeticBusy('')
      return
    }
    // Купленное — сразу на игрока. Примерка этих вещей закончилась.
    const next = worn
      .filter((w) => !bought.some((c) => c.slot === w.slot))
      .concat(bought.map((c) => ({ id: c.id, slot: c.slot, variant: variantOf(c)?.name })))
    let wore = true
    try {
      await applyCosmetics(next)
      setWorn(next)
      setFitting((now) => now.filter((c) => !got.includes(c.id)))
    } catch (e) {
      wore = false
      showToast(apiErrorText(e, 'Куплено, но не наделось — нажми «Надеть»'), 'error')
    } finally {
      setCosmeticBusy('')
    }
    showReward({
      items: bought.map((c) => ({ name: c.name, preview: c.preview, rarity: rarityOfPrice(c.priceRubies || 0) })),
      kicker: bought.length > 1 ? bought.length + ' ' + (bought.length < 5 ? 'вещи' : 'вещей') : 'Твоя вещь',
      title: bought.length > 1 ? 'Сет собран' : undefined,
      sub: wore ? 'Уже на тебе' : undefined,
      // Надеть заново — если сервер не принял набор с первого раза.
      onWear: wore ? undefined : () => wearFittingRef.current(),
    })
  }

  /**
   * Нажатие на вещь — сборка сета. Надетое снимается. Своё надевается сразу и
   * сохраняется на аккаунте. Чужое встаёт на фигуру примеркой и попадает в
   * панель «Сет»; повторный клик убирает его оттуда.
   */
  const cardAction = (item: CosmeticItem) => {
    if (worn.some((w) => w.id === item.id)) {
      void toggleCosmetic(item)
      return
    }
    if (fitting.some((c) => c.id === item.id) || cosmeticLocked(item)) {
      tryOn(item)
      return
    }
    void toggleCosmetic(item)
  }

  /** Надеть всё примеренное, что уже открыто (например, после оформления PLUS). */
  const wearFittingRef = useRef<() => void>(() => {})
  const wearFitting = async () => {
    const ready = fitting.filter((c) => !cosmeticLocked(c))
    if (!ready.length) return
    const next = worn.filter((w) => !ready.some((c) => c.slot === w.slot)).concat(
      ready.map((c) => ({
        id: c.id,
        slot: c.slot,
        variant: variantOf(c)?.name,
      })),
    )
    setCosmeticBusy('fitting')
    try {
      await applyCosmetics(next)
      setWorn(next)
      setFitting((now) => now.filter((c) => !ready.some((r) => r.id === c.id)))
      showToast('Надето — видно в игре', 'ok')
    } catch (e) {
      showToast(apiErrorText(e, 'Не удалось надеть'), 'error')
    } finally {
      setCosmeticBusy('')
    }
  }
  wearFittingRef.current = () => void wearFitting()

  /**
   * Оформление подписки. Платит человек на странице шлюза, поэтому лаунчер
   * открывает её и ждёт: подписка станет действующей, когда придут деньги, а не
   * когда закрылось окно браузера.
   */
  const startPlus = async () => {
    setPlusBusy(true)
    // Исход — настоящая оплата (её ловит опрос) или ошибка.
    const result = purchaseFlow('plus', 'plus_wardrobe')
    try {
      const started = await subscribePlus()
      openPaymentUrl(started.paymentUrl)
      showToast('Оплата открыта в браузере. Набор откроется сразу после оплаты')
      stopPlusWatch.current?.()
      stopPlusWatch.current = watchPlusPurchase((status) => {
        result(true)
        setPlus(status)
        setPlusJoy(true)
        void refreshCosmetics()
      })
    } catch (e) {
      result(false, 'error', e)
      showToast(apiErrorText(e, 'Не удалось оформить подписку'), 'error')
    } finally {
      setPlusBusy(false)
    }
  }

  const toggleCosmetic = async (item: CosmeticItem) => {
    if (cosmeticBusy) return
    if (cosmeticLocked(item)) {
      showToast('Эта вещь ещё не открыта')
      return
    }
    const already = worn.some((w) => w.id === item.id)
    const next = worn.filter((w) => w.slot !== item.slot && w.id !== item.id)
    if (!already) {
      next.push({ id: item.id, slot: item.slot, variant: variantOf(item)?.name })
    }
    setCosmeticBusy(item.id)
    try {
      await applyCosmetics(next)
      setWorn(next)
      // Своё надетое вытесняет примерку на том же месте.
      if (!already) setFitting((now) => now.filter((c) => c.slot !== item.slot))
      showToast(already ? 'Снято' : 'Надето — видно в игре')
    } catch (e) {
      showToast(apiErrorText(e, 'Не удалось изменить косметику'), 'error')
    } finally {
      setCosmeticBusy('')
    }
  }

  /**
   * Плитка «Снять»: место на теле пустеет на аккаунте тем же запросом, каким
   * надевают, — набор целиком без вещей этого места. Примерка в том же месте
   * тоже уходит, иначе фигура продолжала бы показывать снятое.
   */

  // «Снять» и «Снять всё» (правка владельца 23.09.2026, 22:00: кнопок снять
  // нигде не было). Набор уходит на аккаунт тем же запросом, что и «надеть».
  const takeOffSlots = async (slots: string[]) => {
    if (cosmeticBusy) return
    setFitting((now) => now.filter((c) => !slots.includes(c.slot)))
    if (!worn.some((w) => slots.includes(w.slot))) return
    const next = worn.filter((w) => !slots.includes(w.slot))
    setCosmeticBusy('off')
    try {
      await applyCosmetics(next)
      setWorn(next)
      showToast('Снято')
    } catch (e) {
      showToast(apiErrorText(e, 'Не удалось снять'), 'error')
    } finally {
      setCosmeticBusy('')
    }
  }

  const refreshRewards = async () => {
    if (!hasMillidaAccount()) return
    try {
      const r = await loadRewards()
      setRewards(r.items)
    } catch (e) {
      console.warn('[skins] rewards', e)
      showToast('Награды не загрузились', 'error')
    }
  }

  // Каталог украшений нужен сразу: слева стоят слоты со счётчиками, и пустые
  // счётчики читались бы как «у нас ничего нет». Раньше он ехал по клику на
  // вкладку «Украшения», которой больше нет.
  useEffect(() => {
    void refreshWardrobe()
    void refreshRewards()
    void refreshCosmetics()
    void refreshPlus()
    void refreshRubies()
    noteCosmeticsSeen()
  }, [])

  // Каталог аккаунта запрашивается один раз при открытии экрана, а вход к тому
  // моменту мог ещё не подхватиться: запрос тогда не уходил вовсе, и каталог
  // показывался пустым, хотя на сервере он есть. Перезапрашиваем, как только
  // аккаунт Millida появился.
  const millidaSignedIn = accounts.some((a) => a.kind === 'millida')
  useEffect(() => {
    if (!millidaSignedIn) return
    void refreshWardrobe()
    void refreshRewards()
  }, [millidaSignedIn])

  /** Выдать плащ за задание прямо из окна условия. */
  const takeCape = async (c: CapeOption) => {
    const reward = rewards.find((r) => r.code === c.rewardCode)
    if (!reward) return
    setCapeInfo(null)
    await takeReward(reward)
  }

  const takeReward = async (r: RewardItem) => {
    setClaiming(r.code)
    try {
      await claimReward(r.code)
      await refreshRewards()
      await refreshWardrobe()
      setSection('cape')
      setChipBy((now) => ({ ...now, cape: 'all' }))
      showReward({
        items: [{ name: r.title, icon: 'cape', art: r.capeUrl ? <CapePreview url={r.capeUrl} h={180} /> : undefined }],
        tone: 'var(--m-rarity-legendary)',
        kicker: 'Новый плащ',
        title: r.title,
        sub: 'Уже в гардеробе',
      })
    } catch (e) {
      showToast('Не удалось забрать награду: ' + e, 'error')
    } finally {
      setClaiming('')
    }
  }

  // Каталог плащей: без аккаунта Millida его некому персонализировать
  // (прогресс и «открыт/закрыт» считает сервер по текущему пользователю).
  useEffect(() => {
    if (!hasMillidaAccount()) return
    let alive = true
    loadCapeCatalog()
      .then((list) => {
        if (alive && Array.isArray(list)) setCapeCatalog(list)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  /// Плащи Mojang приходят с сервера, а не из кода лаунчера: новые плащи
  /// появляются без выпуска новой версии.
  useEffect(() => {
    let alive = true
    loadMojangCapes()
      .then((list) => {
        if (alive && Array.isArray(list.items)) setMojangCapes(list.items)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const gameNick = useGameNick()
  useEffect(() => {
    void refreshGameNick()
  }, [])

  // Разовый переезд локальной библиотеки в аккаунт: сервер сам схлопывает
  // повторы по содержимому PNG, поэтому дублей каталог не наберёт.
  // Только скины: плащи в каталог аккаунта больше не загружаются — они выдаются
  // каталогом Millida и лицензией Mojang.
  const syncedRef = useRef(false)
  useEffect(() => {
    if (syncedRef.current || !hasMillidaAccount()) return
    if (!mySkins.length) return
    syncedRef.current = true
    void (async () => {
      const KEY = 'm-wardrobe-synced'
      let done: string[] = []
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
        done = Array.isArray(raw) ? raw : []
      } catch {}
      const pending = mySkins
        .map((s) => ({ kind: 'skin' as const, item: s, tag: 's:' + s.file }))
        .filter((p) => !done.includes(p.tag))
      if (!pending.length) return
      for (const p of pending) {
        try {
          await addToWardrobe({
            kind: p.kind,
            name: p.item.name,
            pngBase64: await toPngBase64(p.item.data),
            slim: p.item.slim,
          })
          done.push(p.tag)
        } catch {}
      }
      localStorage.setItem(KEY, JSON.stringify(done.slice(-200)))
      await refreshWardrobe()
    })()
  }, [mySkins])

  const autoVariant = (url: string, key: string) => {
    variantKeyRef.current = key
    const seq = ++autoSeq.current
    const saved = recallVariant(key)
    if (saved) {
      setVariant(saved)
      return
    }
    detectSlimFromUrl(url)
      .then((slim) => {
        if (seq === autoSeq.current) setVariant(slim ? 'slim' : 'classic')
      })
      .catch(() => {})
  }

  const chooseVariant = (key: string, next: string, manual: boolean) => {
    variantKeyRef.current = key
    autoSeq.current++
    setVariant(next)
    if (manual) rememberVariant(key, next)
  }

  const redetectedRef = useRef(false)
  useEffect(() => {
    if (redetectedRef.current || !mySkins.length) return
    redetectedRef.current = true
    const stored = mySkins
    void Promise.all(
      stored.map((s) =>
        s.slimManual
          ? Promise.resolve(s)
          : detectSlimFromUrl(s.data)
              .then((slim) => ({ ...s, slim }))
              .catch(() => s),
      ),
    ).then(async (next) => {
      if (next.every((s, i) => s.slim === stored[i].slim)) return
      setMySkins(next)
      for (const fresh of next) {
        const was = stored.find((x) => x.file === fresh.file)
        if (was && was.slim !== fresh.slim)
          await setTextureSlim('skins', fresh.file, fresh.slim, false).catch(() => [])
      }
      const active = next.find((s) => s.file === activeMyRef.current)
      if (active) setVariant(active.slim ? 'slim' : 'classic')
    })
  }, [mySkins])

  // Reset the preview only on account switch: reacting to `textures` reverted a just-applied skin.
  const lastAccRef = useRef<string | null>(null)
  useEffect(() => {
    const a = getAccount()
    if (!a || !a.nick) return
    if (lastAccRef.current === activeId) return
    lastAccRef.current = activeId
    capeTouched.current = false
    userPicked.current = false
    skinPick.current++
    setNick(a.nick)
    const t = textures[a.id]
    setSkinSrc(t ? t.skin : null)
    const saved = recallVariant('n:' + a.nick)
    if (saved) setVariant(saved)
    else if (t) setVariant(t.slim ? 'slim' : 'classic')
    else autoVariant(skinUrl(a.nick), 'n:' + a.nick)
  }, [activeId, textures])

  /**
   * Каталог скинов - витрина millida.net, а не свой список внутри лаунчера.
   * Поиск по нику остаётся отдельным ходом: витрина показывает опубликованные
   * профили, а по нику берётся скин любого игрока Minecraft.
   */
  const loadCatalog = async (kind: ShowcaseKind) => {
    setCatFailed(false)
    try {
      setCatCards(await withRetry(() => loadShowcase(kind)))
    } catch {
      setCatCards([])
      setCatFailed(true)
    }
  }

  useEffect(() => {
    void loadCatalog(catKind)
  }, [catKind])

  const catFound = useMemo(() => {
    const needle = catQuery.trim().toLowerCase()
    if (!needle) return catCards
    return catCards.filter((c) => c.name.toLowerCase().includes(needle))
  }, [catCards, catQuery])

  const capeSources = useMemo<CapeOption[]>(
    () => {
      const mojangByHash = new Map(mojangCapes.map((c) => [textureHash(c.url), c]))
      const licensed: CapeOption[] = []
      const licensedHashes = new Set<string>()
      for (const a of accounts) {
        for (const c of msCapes[a.id] || []) {
          if (!c.url) continue
          licensedHashes.add(textureHash(c.url))
          licensed.push({
            id: 'ms:' + a.id + ':' + c.id,
            name: c.alias || mojangByHash.get(textureHash(c.url))?.name || 'Плащ',
            url: c.url,
            sub: c.active ? 'Надет на ' + a.nick : 'На аккаунте ' + a.nick,
            onAccount: true,
            active: c.active,
            msId: c.id,
            accId: a.id,
          })
        }
      }
      const accCapes = accounts
        .filter((a) => textures[a.id] && textures[a.id].cape && !msCapes[a.id])
        .map((a) => ({ nick: a.nick, kind: a.kind, id: a.id, url: textures[a.id].cape as string, hash: textureHash(textures[a.id].cape) }))
      const accHashes = new Set(accCapes.map((c) => c.hash).filter(Boolean))
      const stored: CapeOption[] = wardrobe
        .filter((i) => i.kind === 'cape')
        .map((i) => ({ id: 'w:' + i.id, name: i.name, url: i.url, sub: 'В каталоге Millida', wardrobeId: i.id }))
      // Плащ на аккаунт Millida ставит сервер по идентификатору карточки
      // (catalogId), файл туда не уходит: список открытых плащей — серверный.
      const official: CapeOption[] = mojangCapes
        .filter((c) => !licensedHashes.has(textureHash(c.url)))
        .map((c) => ({
          id: c.id,
          catalogId: c.id,
          name: c.name,
          url: c.url,
          sub: 'Дизайн Mojang',
          onAccount: accHashes.has(textureHash(c.url)),
        }))
      const acc: CapeOption[] = accCapes
        .filter((c) => !mojangByHash.has(c.hash))
        .map((c) => ({
          id: 'acc:' + c.id,
          name: c.nick,
          url: c.url,
          sub: 'На аккаунте ' + accKindLabel(c.kind),
          onAccount: true,
        }))
      const design: CapeOption[] = [
        { id: 'millida', catalogId: 'design:millida', name: 'Millida', url: MILLIDA_CAPE, sub: 'Плащ лаунчера' },
      ]
      // Повторы между каталогом Millida, гардеробом аккаунта и списком Mojang
      // схлопывает dedupeCapes: у него один набор правил на все источники.
      const catalog: CapeOption[] = capeCatalog
        .filter((c) => c.url)
        .map((c) => {
          const locked = c.unlocked === false
          const target = c.progressTarget || 0
          const cur = c.progressCurrent || 0
          return {
            id: 'cat:' + c.id,
            catalogId: c.id,
            name: c.name,
            url: c.url,
            sub: locked ? c.requirement || 'Пока закрыт' : c.rarity ? 'Каталог Millida · ' + c.rarity : 'Каталог Millida',
            locked,
            requirement: c.requirement,
            rarity: c.rarity,
            progress: locked ? Math.max(0, Math.min(100, Math.round(c.progress || 0))) : undefined,
            progressLabel:
              locked && target ? cur + ' / ' + target + (c.progressUnit ? ' ' + c.progressUnit : '') : undefined,
            earned: true,
          }
        })
      // Ранее загруженные свои плащи. Новые загрузить нельзя, но старые надеть — да.
      const mine: CapeOption[] = myCapes.map((c, i) => ({
        id: 'my:' + i,
        name: c.name,
        url: c.data,
        sub: 'Загружено ранее',
      }))
      // Плащи за задания - те же плащи: отдельным списком снизу они выглядели
      // повтором, и у них были свои кнопки вместо общего правила «нажал на
      // закрытый плащ - увидел условие».
      const earned: CapeOption[] = rewards
        .filter((r) => !r.claimed)
        .map((r) => ({
          id: 'reward:' + r.code,
          name: r.title,
          url: r.capeUrl || '',
          sub: r.task,
          locked: true,
          requirement: r.task,
          hint: r.hint,
          rewardCode: r.code,
          rewardReady: r.done,
          earned: true,
          progress: Math.max(0, Math.min(100, Math.round((r.progress / (r.goal || 1)) * 100))),
          progressLabel: rewardProgress(r),
        }))
      const open = catalog.filter((c) => !c.locked)
      const shut = catalog.filter((c) => c.locked)
      return licensed
        .concat(stored)
        .concat(open)
        .concat(acc)
        .concat(design)
        .concat(mine)
        .concat(official)
        .concat(earned)
        .concat(shut)
    },
    [accounts, textures, myCapes, msCapes, wardrobe, capeCatalog, rewards, mojangCapes],
  )

  // Отпечатки текстур: один и тот же плащ приезжает из каталога Millida и из
  // гардероба аккаунта по разным адресам без хеша Mojang в них, и опознать его
  // можно только по самим байтам. Картинки уже читаются для превью, так что
  // повторного скачивания здесь нет.
  const [capeContent, setCapeContent] = useState<Record<string, string>>({})
  useEffect(() => {
    const missing = Array.from(new Set(capeSources.map((c) => c.url))).filter((u) => u && !(u in capeContent))
    if (!missing.length) return
    let alive = true
    void Promise.all(
      missing.map((u) =>
        textureSource(u).then(
          (src) => [u, contentFingerprint(src)] as const,
          () => [u, ''] as const,
        ),
      ),
    ).then((pairs) => {
      if (alive) setCapeContent((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    })
    return () => {
      alive = false
    }
  }, [capeSources, capeContent])

  const capes = useMemo<CapeOption[]>(
    () => dedupeCapes(capeSources, (u) => capeContent[u] || undefined),
    [capeSources, capeContent],
  )

  /**
   * Плащ за достижение живёт среди украшений: ради него играют, и стоять он
   * должен рядом с остальным, что надевают на себя. Плащ, просто лежащий на
   * аккаунте, - часть скина, и остаётся во вкладке скинов.
   */
  const earnedCapes = useMemo(() => capes.filter((c) => c.earned), [capes])
  const ownCapes = useMemo(() => capes.filter((c) => !c.earned), [capes])

  useEffect(() => {
    let alive = true
    Promise.all(accounts.map((a) => loadAccountTexture(a, millidaTex).then((t) => [a.id, t] as const))).then((pairs) => {
      if (alive) setTextures(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [accounts, millidaTex, texEpoch])

  useEffect(() => {
    if (!hasTauri()) return
    let alive = true
    void (async () => {
      const pairs: [string, MsCape[]][] = []
      for (const a of accounts) {
        if (a.kind !== 'microsoft') continue
        const ms = await ensureMsAuth(a)
        if (!ms) continue
        try {
          const p = await msProfile(a.id)
          pairs.push([a.id, p.capes || []])
        } catch {}
      }
      if (alive && pairs.length) setMsCapes(Object.fromEntries(pairs))
    })()
    return () => {
      alive = false
    }
  }, [accounts])

  useEffect(() => {
    if (capeTouched.current) return
    const a = getAccount()
    if (!a) return
    const worn = capes.find((c) => c.accId === a.id && c.active)
    if (worn) {
      setCape(worn.id)
      return
    }
    const t = textures[a.id]
    const url = t ? t.cape : null
    if (!url) return
    const h = textureHash(url)
    const print = capeContent[url]
    const same = capes.find((c) =>
      h ? textureHash(c.url) === h : c.url === url || (!!print && capeContent[c.url] === print),
    )
    if (same) setCape(same.id)
  }, [capes, textures, activeId, capeContent])

  const chooseCape = (id: string) => {
    capeTouched.current = true
    setCape(id)
  }

  // Capes are matched by texture hash, but Mojang only accepts the cape id from the profile.
  const capeTarget = (c: CapeOption): { accId: string; msId: string } | null => {
    if (c.accId && c.msId) return { accId: c.accId, msId: c.msId }
    const h = textureHash(c.url)
    if (!h) return null
    for (const a of accounts) {
      const hit = (msCapes[a.id] || []).find((x) => textureHash(x.url) === h)
      if (hit) return { accId: a.id, msId: hit.id }
    }
    return null
  }

  const switchLicensedCape = async (accId: string, msId: string): Promise<boolean> => {
    const acc = accounts.find((a) => a.id === accId)
    if (!acc || acc.kind !== 'microsoft' || !hasTauri()) return false
    const own = msCapes[accId] || []
    if ((own.find((c) => c.active)?.id || '') === msId) return false
    const ms = await ensureMsAuth(acc)
    if (!ms) throw new Error('вход в аккаунт ' + acc.nick + ' устарел')
    await msSetCape(ms.id, msId)
    setMsCapes({ ...msCapes, [accId]: own.map((c) => ({ ...c, active: c.id === msId })) })
    texCache.delete(acc.uuid || acc.nick)
    return true
  }

  const pickCapeOption = (c: CapeOption) => {
    // Закрытый плащ надеть нельзя, но по нему и нажимают за тем, чтобы узнать
    // условие: тост уносил ответ раньше, чем его успевали прочитать.
    if (c.locked) {
      setCapeInfo(c)
      return
    }
    chooseCape(c.id)
    const target = capeTarget(c)
    void Promise.allSettled([
      wearOnMillida(c),
      target ? switchLicensedCape(target.accId, target.msId) : Promise.resolve(false),
    ]).then(([millida, license]) => {
      if (millida.status === 'rejected')
        showToast(apiErrorText(millida.reason, 'Плащ не надет — попробуй ещё раз'), 'error')
      if (license.status === 'rejected') showToast('Плащ лицензии не переключился: ' + license.reason, 'error')
      if (license.status === 'fulfilled' && license.value) showToast('Плащ «' + c.name + '» надет на лицензию')
      else if (millida.status === 'fulfilled' && millida.value) showToast('Плащ «' + c.name + '» надет')
      else if (millida.status === 'fulfilled' && license.status === 'fulfilled') showToast('Плащ: ' + c.name)
    })
  }

  const wearOnMillida = async (c: CapeOption): Promise<boolean> => {
    if (!hasMillidaAccount()) return false
    if (c.wardrobeId) await applyWardrobeItem(c.wardrobeId)
    else if (c.catalogId) await applyCatalogCape(c.catalogId)
    else return false
    await refreshWardrobe()
    return true
  }

  const takeOffCape = () => {
    chooseCape('none')
    if (!hasMillidaAccount()) {
      showToast('Плащ снят')
      return
    }
    void uploadTexture('cape', null)
      .then(() => refreshWardrobe())
      .then(() => showToast('Плащ снят'))
      .catch((e) => {
        trackFailure('skins', e, { step: 'cape_remove' })
        showToast(apiErrorText(e, 'Плащ не снялся — попробуй ещё раз'), 'error')
      })
  }

  const fitViewer = () => {
    const engine = viewerRef.current
    const stage = stageRef.current
    if (!engine || !stage) return
    try {
      const w = stage.clientWidth || 300
      const h = stage.clientHeight || 430
      engine.setSize(w, h)
      // Фон-сцена за холстом повторяет его место и размер.
      const host = stage.parentElement
      host?.style.setProperty('--stage-top', stage.offsetTop + 'px')
      host?.style.setProperty('--stage-h', stage.offsetHeight + 'px')
      // Кадр — по одному телу, вещи его не двигают; ник — над самой высокой вещью.
      // Размер фигуры всегда один, при любых вещах (владелец 22:35).
      const r = engine.fitPlayerToFrame({ fillY: FULL_FILL_Y, offsetY: FULL_OFFSET_Y })
      if (r) setTagAt(nametagSpot(tagBox(r), w, h))
    } catch {}
  }

  useEffect(() => {
    if (!on || m3d) return
    let alive = true
    loadMine3d()
      .then((mod) => {
        if (!alive) return
        setM3d(mod)
        setSvReady(true)
      })
      .catch(() => {
        if (alive) setFallback(true)
      })
    return () => {
      alive = false
    }
  }, [on, m3d])

  // Номер холста: контекст WebGL отобрали — сцена собирается заново на новом
  // холсте, а не остаётся пустой или плоской 2D-заглушкой.
  const [glEpoch, setGlEpoch] = useState(0)
  const glTries = useRef(0)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!m3d || !canvas) return
    const onLost = (ev: Event) => {
      ev.preventDefault()
      // Второй потерянный контекст за сеанс — лёгкая графика в лобби и превью.
      noteContextLost()
      setModelShown(false)
      setGlEpoch((n) => n + 1)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    let engine: SkinViewEngine
    try {
      // Камеру вокруг фигуры не возим: в гардеробе крутят самого персонажа, и
      // две системы вращения на один холст дают рывки друг об друга.
      engine = new m3d.SkinViewEngine(canvas, {
        autoResize: false,
        autoDetectModel: false,
        transparent: true,
        enableControls: false,
      })
    } catch {
      canvas.removeEventListener('webglcontextlost', onLost)
      // Контекст бывает занят соседней сценой: две попытки, потом заглушка.
      if (glTries.current < 2) {
        glTries.current++
        const retry = setTimeout(() => setGlEpoch((n) => n + 1), 1500)
        return () => clearTimeout(retry)
      }
      setFallback(true)
      return
    }
    glTries.current = 0
    engine.applyLightSettings(MILLIDA_LIGHT)
    engine.setContactShadowVisible(true)
    // Взгляд за мышкой — головой, корпус стоит; пока фигуру крутят — нет
    // (владелец 24.09.2026). Общая логика с лобби — src/lib/headLook.ts.
    engine.setCursorFollow(false)
    engine.setPoseHook(headLook(() => dragFrom.current !== null))
    viewerRef.current = engine
    setEngineReady(glEpoch + 1)
    setFallback(false)
    fitViewer()
    engine.start()
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      viewerRef.current = null
      setEngineReady(0)
      // Сцена пересоздаётся при каждом заходе: без явного отказа от контекста
      // WebGL они копятся, и WKWebView начинает терять скин на фигуре.
      releaseEngine(engine)
    }
  }, [m3d, glEpoch])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine) return
    let alive = true
    void textureSource(skinSrc || skinUrl(nick)).then((src) => {
      if (!alive) return
      engine
        .setSkin(src)
        .then(() => {
          if (!alive) return
          fitViewer()
          requestAnimationFrame(() => requestAnimationFrame(() => setModelShown(true)))
        })
        .catch((e) => {
          // Текстура не прочиталась: фигура остаётся в прежнем скине, но не
          // пропадает, и человек видит, почему скин не сменился.
          console.warn('[skins] setSkin', e)
          if (!alive) return
          setModelShown(true)
          showToast('Скин не прочитался — проверь, что это PNG 64×64', 'error')
        })
    })
    return () => {
      alive = false
    }
  }, [nick, skinSrc, engineReady])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !m3d) return
    engine.setModelType(variant === 'slim' ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
    fitViewer()
  }, [variant, m3d, engineReady])

  /**
   * Надетое видно прямо на фигуре. Геометрию просим только для надетого:
   * сервер отдаёт её под потолок на сутки, и тянуть весь каталог ради
   * витрины нельзя.
   */
  useEffect(() => {
    const engine = viewerRef.current
    // Движок мог остаться от прошлой версии кода при горячей перезагрузке: у
    // такого объекта новых методов нет, и вызов молча снёс бы весь экран.
    if (!engine || !engineReady || typeof engine.clearCosmetics !== 'function') return
    let alive = true
    engine.clearCosmetics()
    // Примеряемое вытесняет надетое на том же месте: на голове не может быть
    // двух шляп, и показывать обе - врать о том, как это будет выглядеть.
    const busySlots = new Set(fitting.map((c) => c.slot))
    const shown = worn
      .filter((w) => !busySlots.has(w.slot))
      .map((w) => cosmetics.find((c) => c.id === w.id))
      .concat(fitting)
      // Эмоции рисовать нечего: у них нет ни картинки, ни кубов - только клип,
      // который двигает самого игрока. Модель им всё равно нужна.
      .filter((c): c is CosmeticItem => Boolean(c && c.model && (textureOf(c) || c.slot === 'EMOTE')))
    setFitLoading(shown.filter((item) => !MODEL_CACHE.has(item.model as string)).map((item) => item.id))
    void Promise.all(shown.map((item) => cosmeticModel(item.model as string).then((file) => ({ item, file })))).then(
      (loaded) => {
        if (!alive) return
        setFitLoading([])
        const lost = loaded.filter((got) => !got.file).map((got) => got.item.name)
        if (lost.length) {
          // Молчаливая пустота на фигуре читается как «примерка не работает».
          // Лучше честно сказать, что вещь не приехала, чем оставить гадать.
          showToast('Не удалось показать на фигуре: ' + lost.join(', '), 'error')
        }
        // Эмоция двигает самого игрока, а не вещь: её клип идёт вместо покоя.
        const emote = loaded.find((got) => got.item.slot === 'EMOTE' && got.file?.animations)
        const emoteClips = emote?.file ? readAnimations(emote.file.animations) : {}
        // Вступление, потом петля - как в игре и у Essential: один клип из
        // каталога обрывал эмоцию на вступлении.
        const sequence = emote?.file ? emoteSequence(emoteClips, emoteClip(emoteClips, emote.item.animation)) : null
        const playing = sequence ? new CosmeticEmote(sequence, emote?.file?.geometry) : null
        if (playing && sequence) {
          engine.setAnimation(playing as unknown as SkinAnimation)
          engine.setCursorFollow(false)
          setEmoting(true)
        } else {
          setEmoting(false)
        }
        for (const got of loaded) {
          if (!got.file) continue
          const skin = textureOf(got.item)
          if (!skin) continue
          const geometry = variant === 'slim' && got.file.geometrySlim ? got.file.geometrySlim : got.file.geometry
          try {
            for (const piece of buildCosmetic(
              geometry,
              skin,
              got.item.slot,
              got.file.animations,
              got.item.animation,
              got === emote && playing && sequence ? { sequence, clock: () => playing.progress } : undefined,
            )) {
              engine.attachCosmetic(piece.anchor, piece.object)
            }
          } catch {
            // Кривая модель не должна гасить весь экран: вещь просто не
            // покажется на фигуре, картинка в каталоге у неё остаётся.
          }
        }
        // Кадр движок держит по телу — примерка персонажа не сдвигает; пересчёт
        // нужен только нику, чтобы встать над новой шляпой.
        fitViewer()
      },
    )
    return () => {
      alive = false
      setFitLoading([])
      engine.clearCosmetics()
    }
  }, [worn, fitting, cosmetics, variant, variantById, engineReady])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine) return
    const c = capes.find((x) => x.id === cape)
    if (!c) {
      engine.clearCape()
      return
    }
    let alive = true
    void textureSource(c.url).then((src) => {
      if (alive)
        engine
          .setCape(src)
          .then(() => {
            if (alive) fitViewer()
          })
          .catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [cape, capes, engineReady])

  /// Автопоказ: покой — это idle, изредка персонаж проигрывает один из клипов и
  /// возвращается в покой. Порядок берётся из перемешанного мешка, а пауза —
  /// случайная: ровный цикл глаз заучивает за пару кругов. Таймер живёт внутри
  /// эффекта, поэтому двойное монтирование StrictMode не оставляет второй.
  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !m3d || emoting) return
    const rest = () => {
      const e = viewerRef.current
      if (!e) return
      e.setAnimation(m3d.createSkinAnimation('idle'))
    }
    engine.setPresentationMode('full')
    rest()
    if (!viewerAwake) return
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let bag: number[] = []
    let last = -1
    const nextClip = () => {
      if (!bag.length) {
        bag = IDLE_SHOW.map((_, i) => i)
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const t = bag[i]
          bag[i] = bag[j]
          bag[j] = t
        }
        // Стык двух мешков — единственное место, где клип может повториться подряд
        if (bag[bag.length - 1] === last) {
          const t = bag[bag.length - 1]
          bag[bag.length - 1] = bag[0]
          bag[0] = t
        }
      }
      last = bag.pop() as number
      return IDLE_SHOW[last]
    }
    const toRest = () => {
      rest()
      timer = setTimeout(toShow, between(IDLE_SHOW_GAP_MIN, IDLE_SHOW_GAP_MAX))
    }
    const toShow = () => {
      const e = viewerRef.current
      if (!e) return
      const clip = nextClip()
      e.setCursorFollow(false)
      e.setAnimation(m3d.createSkinAnimation(clip.id))
      timer = setTimeout(toRest, clip.ms)
    }
    timer = setTimeout(toShow, between(IDLE_SHOW_FIRST_MIN, IDLE_SHOW_FIRST_MAX))
    return () => clearTimeout(timer)
  }, [m3d, engineReady, viewerAwake, emoting])

  useEffect(() => {
    if (!engineReady) return
    const stage = stageRef.current
    if (!stage) return
    fitViewer()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitViewer())
    ro.observe(stage)
    return () => ro.disconnect()
  }, [engineReady, on])

  useEffect(() => {
    if (!engineReady) return
    const setPaused = (v: boolean) => {
      const engine = viewerRef.current
      if (!engine) return
      if (v) engine.stop()
      else engine.start()
      setViewerAwake(!v)
    }
    const onVis = () => setPaused(document.hidden || !on || !renderLive())
    const onBlur = () => setPaused(true)
    const onFocus = () => setPaused(!on || !renderLive())
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    // Игра поверх или окно в трее — 3D стоит (lib/renderGate).
    const offGate = onRenderGate(() => setPaused(document.hidden || !on || !renderLive() || !document.hasFocus()))
    setPaused(document.hidden || !document.hasFocus() || !on || !renderLive())
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      offGate()
    }
  }, [engineReady, on])

  /**
   * Фигуру крутят мышью: вещь со спины иначе не разглядеть, а половина
   * косметики именно там - крылья, ранцы, плащи. Пока тянут, взгляд за курсором
   * отключается, иначе голова дёргается вслед за движением, которым вращают.
   */
  const dragFrom = useRef<{ x: number; yaw: number } | null>(null)

  const startTurn = (e: { clientX: number; button?: number; currentTarget: Element; pointerId?: number }) => {
    const engine = viewerRef.current
    if (!engine || (e.button ?? 0) !== 0) return
    dragFrom.current = { x: e.clientX, yaw: engine.playerYaw }
    if (e.pointerId !== undefined) {
      try {
        ;(e.currentTarget as Element & { setPointerCapture(id: number): void }).setPointerCapture(e.pointerId)
      } catch {}
    }
  }

  const endTurn = () => {
    dragFrom.current = null
  }

  const turnOrAim = (e: { clientX: number; clientY: number }) => {
    const engine = viewerRef.current
    const held = dragFrom.current
    if (engine && held) {
      engine.setPlayerYaw(held.yaw + (e.clientX - held.x) * TURN_PER_PIXEL)
    }
  }

  /** Колесо приближает фигуру: мелкая вещь на поясе иначе не видна. */
  /**
   * Приближение колесом. Шаг считается от того, насколько крутнули, а не
   * фиксированные восемь процентов на любое движение: с фиксированным шагом
   * размашистый жест двигал фигуру ровно настолько же, насколько едва заметный,
   * и приближение выглядело сломанным.
   *
   * Колесо сообщает прокрутку в разных единицах: пиксели, строки, страницы.
   * Строку и страницу приводим к пикселям, иначе на трекпаде и в части браузеров
   * один и тот же жест даёт разный шаг.
   */
  // «Загрузить скин» и «Импорт» — в верхней строке экрана (правка 22:38).
  const pickSkinRef = useRef<() => void>(() => {})
  useEffect(() => {
    const up = () => pickSkinRef.current()
    const imp = () => {
      setSection('skin')
      setImportOpen(true)
    }
    window.addEventListener(SKINS_UPLOAD_EVENT, up)
    window.addEventListener(SKINS_IMPORT_EVENT, imp)
    return () => {
      window.removeEventListener(SKINS_UPLOAD_EVENT, up)
      window.removeEventListener(SKINS_IMPORT_EVENT, imp)
    }
  }, [])

  const zoomStage = (e: { deltaY: number; deltaMode?: number; preventDefault(): void }) => {
    const engine = viewerRef.current
    if (!engine) return
    e.preventDefault()
    const mode = e.deltaMode ?? 0
    const pixels = e.deltaY * (mode === 1 ? 16 : mode === 2 ? 400 : 1)
    // Потолок на одно событие: у страницы прокрутки шаг иначе перепрыгивает
    // весь допустимый разбег за одно движение.
    const step = Math.exp(-Math.max(-600, Math.min(600, pixels)) * 0.0016)
    engine.setZoom(Math.max(0.45, Math.min(2.4, engine.getZoom() * step)))
    const stage = stageRef.current
    const m = engine.measurePlayerFrame()
    if (m && stage) setTagAt(nametagSpot(m.ndc, stage.clientWidth, stage.clientHeight))
  }

  // Native dialog: HTML <input type=file> aborts WKWebView on macOS (runOpenPanel).
  const pickSkin = () => {
    if (!hasTauri()) {
      showToast('Загрузка скина доступна в приложении', 'error')
      return
    }
    void pickTexture()
      .then(async (p) => {
        if (p) await acceptSkin(p.name, p.data)
      })
      .catch((e) => {
        trackFailure('skins', e, { step: 'skin_pick' })
        showToast('Не удалось загрузить: ' + e, 'error')
      })
  }
  pickSkinRef.current = pickSkin

  // Загрузки своих плащей больше нет: плащ можно только получить — с лицензии
  // Mojang или в каталоге Millida. Ранее загруженные плащи остаются в списке
  // (группа «Загружено ранее»), но новых добавить нельзя.

  /// Общий приём импортированной текстуры: кладём в локальную библиотеку, в
  /// каталог аккаунта и сразу показываем в превью.
  const acceptSkin = async (name: string, data: string) => {
    // Загрузка — тоже выбор: обновление каталога по ходу не должно вернуть на
    // фигуру прежний скин аккаунта.
    startSkinPick()
    const first = !mySkins.length && firstSkinEver()
    let slim = false
    try {
      slim = await detectSlimFromUrl(data)
    } catch {}
    const next = await saveTexture('skins', name.replace(/\.png$/i, ''), data, slim)
    setMySkins(next)
    setSkinSrc(data)
    setActiveMy(next[0]?.file ?? null)
    setActiveWardrobe(null)
    chooseVariant(next[0] ? 'm:' + next[0].file : 'n:' + nick, slim ? 'slim' : 'classic', false)
    if (hasMillidaAccount()) {
      try {
        await addToWardrobe({ kind: 'skin', name: name.replace(/\.png$/i, ''), pngBase64: await toPngBase64(data), slim })
        await refreshWardrobe()
        // Обновление каталога подсвечивает скин, надетый на аккаунте, а надет
        // там пока прежний: без этого «Применить» уходило под его именем.
        setActiveWardrobe(null)
        setActiveMy(next[0]?.file ?? null)
      } catch (e) {
        showToast('В каталог аккаунта не сохранилось: ' + e, 'error')
      }
    }
    const title = name.replace(/\.png$/i, '')
    const arms = slim ? 'Тонкие руки' : 'Классические руки'
    if (first)
      showReward({
        items: [{ name: title, art: <SkinBody url={data} model={slim ? 'slim' : 'default'} height={200} fallback={<SkinThumb url={data} slim={slim} />} /> }],
        tone: 'var(--m-accent)',
        kicker: 'Первый свой скин',
        title,
        sub: arms,
      })
    else showReward({ level: 'small', items: [{ name: title, icon: 'ws-skin' }], title: 'Скин «' + title + '» загружен', sub: arms })
  }

  const [importOpen, setImportOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)

  const importByUrl = async () => {
    const url = importUrl.trim()
    if (!url) return
    if (!hasTauri()) {
      showToast('Импорт по ссылке доступен в приложении', 'error')
      return
    }
    setImporting(true)
    try {
      const data = await fetchTexture(url)
      const name = decodeURIComponent(url.split('/').pop() || 'Скин по ссылке').slice(0, 40)
      await acceptSkin(name, data)
      setImportUrl('')
      setImportOpen(false)
    } catch (e) {
      showToast('Не удалось забрать скин: ' + e, 'error')
    } finally {
      setImporting(false)
    }
  }

  const importByNick = async () => {
    const player = importUrl.trim()
    if (!NICK_RE.test(player)) {
      showToast('Ник — 3–16 символов: буквы, цифры и подчёркивание', 'error')
      return
    }
    if (!hasTauri()) {
      showToast('Импорт игрока доступен в приложении', 'error')
      return
    }
    setImporting(true)
    try {
      const t = await mcTextures(player)
      if (!t.skin) throw new Error('у игрока стандартный скин')
      const data = await fetchTexture(t.skin)
      await acceptSkin(player, data)
      setImportUrl('')
      setImportOpen(false)
    } catch (e) {
      showToast('Не удалось забрать скин игрока: ' + e, 'error')
    } finally {
      setImporting(false)
    }
  }

  // Стояла рядом с «Применить» и срабатывала с первого промаха: сброс уносит и
  // скин на лицензии Microsoft, вернуть его лаунчер уже не может.
  const useWardrobeSkin = (item: WardrobeItem): Promise<void> => {
    setSkinSrc(item.url)
    setActiveWardrobe(item.id)
    setActiveMy(null)
    chooseVariant('w:' + item.id, recallVariant('w:' + item.id) || (item.model === 'slim' ? 'slim' : 'classic'), false)
    const token = startSkinPick()
    const stale = () => token !== skinPick.current
    return queueSkin(token, async () => {
      try {
        await applyWardrobeItem(item.id)
        appliedRef.current = item.url
        if (!stale()) showToast('Скин «' + item.name + '» надет')
      } catch (e) {
        if (!stale()) showToast('Не удалось надеть скин: ' + e, 'error')
        return
      }
      if (stale()) return
      try {
        await syncLocalSkin(item.url, item.model === 'slim')
      } catch (e) {
        showToast('На этом компьютере скин не обновился — в сборках останется прежний: ' + e, 'error')
      }
    })
  }

  /**
   * Удаление скина — один клик и «Отменить» в тосте. Карточка пропадает
   * сразу, а сам файл или запись на сервере стираются, только когда тост
   * ушёл: окно подтверждения на каждую карточку раздражало (владелец 23.09.2026).
   */
  const removeWardrobeSkin = (item: WardrobeItem) => {
    const at = wardrobe.findIndex((i) => i.id === item.id)
    setWardrobe((cur) => cur.filter((i) => i.id !== item.id))
    if (activeWardrobe === item.id) setActiveWardrobe(null)
    const commit = setTimeout(() => {
      void removeWardrobeItem(item.id).catch((e) => {
        showToast(apiErrorText(e, 'Скин не удалился'), 'error')
        void refreshWardrobe()
      })
    }, SKIN_UNDO_MS)
    showToast('Скин «' + item.name + '» удалён', undefined, undefined, {
      label: 'Отменить',
      run: () => {
        clearTimeout(commit)
        setWardrobe((cur) => (cur.some((i) => i.id === item.id) ? cur : [...cur.slice(0, at), item, ...cur.slice(at)]))
      },
    })
  }

  const removeMySkin = (i: number) => {
    const target = mySkins[i]
    if (!target) return
    const wasActive = activeMy === target.file
    setMySkins((cur) => cur.filter((s) => s.file !== target.file))
    if (wasActive) {
      setActiveMy(null)
      setSkinSrc('')
    }
    const commit = setTimeout(() => {
      if (wasActive) void dropLocalSkin()
      void deleteTexture('skins', target.file)
        .then(setMySkins)
        .catch((e) => showToast('Не удалось удалить: ' + e, 'error'))
    }, SKIN_UNDO_MS)
    showToast('Скин «' + target.name + '» удалён', undefined, undefined, {
      label: 'Отменить',
      run: () => {
        clearTimeout(commit)
        setMySkins((cur) => (cur.some((s) => s.file === target.file) ? cur : [...cur.slice(0, i), target, ...cur.slice(i)]))
      },
    })
  }
  const removeMyCape = (i: number) => {
    const target = myCapes[i]
    if (!target) return
    setMyCapes(myCapes.filter((_, x) => x !== i))
    if (cape === 'my:' + i) chooseCape('none')
    void deleteTexture('capes', target.file)
      .then(setMyCapes)
      .catch((e) => showToast('Не удалось удалить: ' + e, 'error'))
  }

  const selectCatalog = (it: CatalogSkin) => {
    const texture = it.url || skinUrl(it.nick || 'MHF_Steve')
    if (it.nick) setNick(it.nick)
    // Текстура запоминается целиком: «применить» обязано отправить именно тот
    // скин, который человек видит в превью, а не подставлять его по нику.
    setSkinSrc(texture)
    setActiveMy(null)
    setActiveWardrobe(null)
    autoVariant(texture, it.url ? 's:' + it.url : 'n:' + (it.nick || 'MHF_Steve'))
    void applyToMillida(texture)
  }

  const readyRewards = rewards.filter((r) => r.done && !r.claimed).length


  // Каталог из семисот вещей одним списком не читается: режем по разделу и
  // чипу. Поиск — по всему каталогу сразу, как в Roblox: ищут вещь, а не место.
  const cosmeticQueryNorm = cosmeticQuery.trim().toLowerCase()

  const sections = useMemo(() => cosmeticSections(cosmetics.map((c) => c.slot)), [cosmetics])

  const sectionDef = sections.find((s) => s.key === section)
  const chipKey = chipBy[section] ?? (sectionDef ? sectionDef.chips[0].key : section === 'skin' ? 'mine' : 'all')
  const chipDef = sectionDef ? sectionDef.chips.find((c) => c.key === chipKey) ?? sectionDef.chips[0] : undefined

  const ownOk = (c: CosmeticItem) => {
    if (own === 'all') return true
    return !(c.access !== 'FREE' && !cosmeticOwned.includes(c.id))
  }

  /** Вещи на экране: результаты поиска или содержимое чипа (у плащей — косметические плащи). */
  const shelf = useMemo(() => {
    let list: CosmeticItem[]
    if (cosmeticQueryNorm) list = cosmetics.filter((c) => c.name.toLowerCase().includes(cosmeticQueryNorm))
    else if (section === 'cape') list = chipKey === 'all' ? cosmetics.filter((c) => c.slot === 'CAPE') : []
    else if (chipDef) list = cosmetics.filter((c) => chipDef.slots.includes(c.slot))
    else list = []
    // Отмеченное звёздочкой идёт первым: из сотни вещей подписки человек носит
    // десяток, и искать их каждый раз заново - работа, а не удовольствие.
    return starredFirst(list.filter(ownOk), (item) => item.id, stars)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmetics, cosmeticQueryNorm, section, chipKey, chipDef, own, cosmeticOwned, stars])

  const shelfKey = cosmeticQueryNorm ? 'q:' + cosmeticQueryNorm : section + ':' + chipKey

  // Условие задания живёт в окне, а не на карточке: на карточке оно
  // занимало три строки и повторялось в подсказке кнопки.
  const [capeInfo, setCapeInfo] = useState<CapeOption | null>(null)

  const use3d = svReady && !fallback
  const currentCape = capes.find((c) => c.id === cape)

  const skinTitle = (): string => {
    const stored = activeWardrobe ? wardrobe.find((i) => i.id === activeWardrobe) : null
    if (stored) return stored.name
    const my = mySkinOf(activeMy)
    if (my) return my.name
    return 'Скин ' + nick
  }

  const refreshHead = async (texture: string) => {
    const cur = getAccount()
    if (!cur) return
    try {
      const head = await headDataUrl(texture)
      const st = useAccounts.getState()
      st.save(st.list.map((x) => (x.id === cur.id ? { ...x, avatar: head, avatarFrom: texture } : x)))
    } catch {}
  }

  /**
   * Лицо в углу берётся из сохранённой картинки, а её рисовали один раз - при
   * «Применить скин». Скин же меняется и мимо этой кнопки: на сайте, на другой
   * машине, при сбросе. Тогда в углу оставалось прежнее лицо, а иногда и вовсе
   * чужое, и человек решал, что скин у него сбросили (жалоба 16.09.2026).
   *
   * Поэтому лицо перерисовывается всякий раз, когда скин аккаунта оказался не
   * тем, из которого оно нарисовано, - и только тогда: рисование стоит дорого.
   */
  const syncHead = (skinUrl: string | null) => {
    const cur = getAccount()
    if (!cur || !skinUrl) return
    if (cur.avatar && cur.avatarFrom === skinUrl) return
    void refreshHead(skinUrl)
  }

  /// Cape must be switched on Mojang itself, otherwise online sessions keep the old one.
  const applyLicensedCape = async (): Promise<boolean> => {
    if (!hasTauri()) return false
    const target = currentCape ? capeTarget(currentCape) : null
    if (target) return switchLicensedCape(target.accId, target.msId)
    if (currentCape) return false
    const acc = getAccount()
    if (!acc || acc.kind !== 'microsoft') return false
    const own = msCapes[acc.id] || []
    if (!own.some((c) => c.active)) return false
    const ms = await ensureMsAuth(acc)
    if (!ms) return false
    await msSetCape(ms.id, '')
    setMsCapes({ ...msCapes, [acc.id]: own.map((c) => ({ ...c, active: false })) })
    texCache.delete(acc.uuid || acc.nick)
    return true
  }

  /**
   * Выбор скина и есть применение. Кнопки «Применить» больше нет: она стояла
   * между «я выбрал» и «готово» и ничего к выбору не добавляла - человек и так
   * нажал на тот скин, который хочет.
   */
  const pickAndApply = (texture: string, after?: () => void) => {
    setSkinSrc(texture)
    after?.()
    void applyToMillida(texture)
  }

  /**
   * Применение скина идёт очередью, и побеждает последний клик. Раньше два
   * быстрых выбора отправлялись параллельно: первый доезжал до сервера позже
   * второго, и на аккаунте оставался не тот скин, что на фигуре.
   */
  const applyToMillida = (picked?: string, arms?: string): Promise<void> => {
    const texture = picked ?? skinSrc
    if (!texture) {
      showToast('Сначала выбери скин — свой, из каталога или из аккаунта', 'error')
      return Promise.resolve()
    }
    const token = startSkinPick()
    return queueSkin(token, () => applyToMillidaNow(token, texture, arms))
  }

  const applyToMillidaNow = async (token: number, texture: string, arms?: string) => {
    const stale = () => token !== skinPick.current
    // Руки — по самой текстуре (переключателя больше нет): состояние variant
    // могло ещё не догнать только что выбранный скин.
    const slimArms = arms ? arms === 'slim' : await detectSlimFromUrl(texture).catch(() => variant === 'slim')
    if (stale()) return
    const prev = appliedRef.current
    const undo =
      prev && prev !== texture
        ? {
            label: 'Вернуть',
            run: () => {
              setSkinSrc(prev)
              setActiveMy(null)
              setActiveWardrobe(null)
              void applyToMillida(prev)
            },
          }
        : undefined
    try {
      const skin = await toPngBase64(texture).catch(() => {
        throw new Error('картинка скина не читается — выбери его заново')
      })
      const capePng = currentCape
        ? await toPngBase64(currentCape.url).catch(() => {
            throw new Error('плащ «' + currentCape.name + '» не скачался — выбери другой')
          })
        : null
      if (stale()) return
      if (hasTauri())
        await setLocalSkin(skin, capePng ?? '', slimArms).catch((e) => {
          throw new Error('скин не сохранился на этом компьютере: ' + e)
        })
      const acc = getAccount()
      let licensed = false
      let capeLocalOnly = ''
      try {
        licensed = await applyLicensedCape()
      } catch (e) {
        trackFailure('skins', e, { step: 'license_cape' })
        showToast('Плащ лицензии не переключился: ' + e, 'error')
      }
      // Скин на лицензию уходит независимо от аккаунта Millida: раньше он был
      // привязан к загрузке в каталог, и без входа в Millida на аккаунте
      // менялся только плащ — скин оставался прежним.
      if (acc && acc.kind === 'microsoft' && hasTauri()) {
        const ms = await ensureMsAuth(acc)
        if (ms) {
          try {
            await msUploadSkin(ms.id, skin, slimArms)
            texCache.delete(acc.uuid || acc.nick)
            licensed = true
          } catch (e) {
            trackFailure('skins', e, { step: 'license_skin' })
            showToast('На лицензию скин не уехал: ' + e, 'error')
          }
        }
      }
      if (hasMillidaAccount()) {
        if (skinSource() !== 'millida') setSkinSource('millida')
        if (stale()) return
        const applied = await uploadTexture('skin', skin, slimArms, skinTitle()).catch((e) => {
          throw new Error(
            'скин не сохранился в аккаунте Millida (' +
              apiErrorText(e, 'Millida не приняла скин') +
              ')' +
              (licensed ? ' — на лицензии он уже применён' : ''),
          )
        })
        if (!applied || !applied.skinUrl) throw new Error('сервер не сохранил скин')
        // Пока ехали, выбрали другой скин: он уже стоит в очереди следом и
        // перезапишет этот. Карточки и тосты — его забота.
        if (stale()) return
        // Локальная копия только что записана этими же байтами: помечаем её,
        // чтобы обновление каталога не качало тот же скин ещё раз.
        if (hasTauri()) localSkinRef.current = localMark(applied.skinUrl, slimArms)
        // Плащ из каталога аккаунта надевается по id: повторная заливка того же
        // PNG заводит в каталоге вторую карточку той же текстуры.
        // Плащ на аккаунт ставится только по идентификатору: из каталога
        // аккаунта или из каталога Millida. Заливка PNG плащом больше не
        // считается — иначе плащ выдавал себе кто угодно запросом мимо лаунчера.
        if (!currentCape) {
          if (capeTouched.current) await uploadTexture('cape', null)
        } else if (currentCape.wardrobeId) await applyWardrobeItem(currentCape.wardrobeId)
        else if (currentCape.catalogId) await applyCatalogCape(currentCape.catalogId)
        else capeLocalOnly = currentCape.name
        await loadMillidaProfile().catch(() => {})
        await refreshHead(texture)
        await refreshWardrobe()
        await refreshRewards()
        if (capeLocalOnly)
          showToast(
            'Плащ «' + capeLocalOnly + '» виден только на этом компьютере: на аккаунт ставятся плащи из каталога',
          )
        appliedRef.current = texture
        showToast(
          licensed
            ? 'Скин применён — сохранён в каталоге Millida и на лицензии'
            : 'Скин применён и сохранён в каталоге Millida',
          undefined,
          undefined,
          undo,
        )
      } else {
        await refreshHead(texture)
        appliedRef.current = texture
        showToast(
          licensed
            ? 'Скин применён на лицензии Microsoft'
            : 'Скин применён — увидишь его в игре на модовых сборках после запуска',
          undefined,
          undefined,
          undo,
        )
      }
      track('skin_apply', {
        cape: currentCape ? currentCape.name : 'нет',
        variant,
        account: hasMillidaAccount() ? 'millida' : 'local',
        licensed,
      })
    } catch (e) {
      if (!stale()) trackFailure('skins', e, { step: 'apply' })
      if (!stale()) showToast(apiErrorText(e, 'Не удалось применить скин'), 'error')
    }
  }

  // ---- образы ----
  // Образ — весь набор разом: скин с руками, плащ и косметика. Хранится в
  // памяти лаунчера за аккаунтом (src/state/outfits.ts), надевается теми же
  // функциями, что и отдельные вещи на этом экране.
  const [outfits, setOutfits] = useState<Outfit[]>(() => loadOutfits(activeId || ''))
  const [outfitBusy, setOutfitBusy] = useState<string | null>(null)
  useEffect(() => setOutfits(loadOutfits(activeId || '')), [activeId])
  const keepOutfits = (next: Outfit[]) => {
    setOutfits(next)
    saveOutfits(activeId || '', next)
  }

  // Скин образа — тот, что на фигуре. Карточка гардероба запоминается, только
  // если это она и есть: до первого выбора фигура показывает скин по нику, а
  // карточка аккаунта уже отмечена активной.
  const currentLook = (): Look => ({
    skin: {
      url: skinSrc || skinUrl(nick),
      slim: variant === 'slim',
      wardrobeId:
        activeWardrobe && wardrobe.some((i) => i.id === activeWardrobe && i.url === (skinSrc || skinUrl(nick)))
          ? activeWardrobe
          : undefined,
      myFile: mySkinOf(activeMy)?.file,
    },
    cape,
    cosmetics: worn.map((w) => ({ id: w.id, slot: w.slot, variant: w.variant })),
  })
  const activeOutfit = outfits.find((o) => sameLook(o, currentLook()))?.id ?? null

  const saveOutfit = () => {
    const same = outfits.find((o) => o.id === activeOutfit)
    if (same) {
      // Тот же набор — ведём переодеться: новый образ из тех же вещей не нужен.
      showToast('Это «' + same.name + '». Надень другое — и сохрани')
      pickSection('skin')
      return
    }
    if (outfits.length >= OUTFITS_LIMIT) {
      showToast('Больше ' + OUTFITS_LIMIT + ' образов не сохранить', 'error')
      return
    }
    const next = addOutfit(outfits, currentLook())
    keepOutfits(next)
    showReward({
      level: 'mid',
      items: [{ name: 'Образ', art: figureArt(64) }],
      title: 'Образ сохранён',
      sub: '«' + next[next.length - 1].name + '»',
    })
  }

  const dropOutfit = (o: Outfit) => {
    const before = outfits
    keepOutfits(removeOutfit(outfits, o.id))
    // Удаление без окна подтверждения, но с откатом: образ собирали руками.
    showToast('Образ «' + o.name + '» удалён', undefined, undefined, {
      label: 'Вернуть',
      run: () => keepOutfits(before),
    })
  }

  /**
   * Надеть образ. Порядок важен: сначала скин — applyToMillida заново ставит
   * на аккаунт плащ, выбранный до нажатия, и плащ образа должен лечь после
   * него. То, что уже надето, не трогаем: лишний запрос — лишний тост.
   */
  const wearOutfit = async (o: Outfit) => {
    if (outfitBusy || cosmeticBusy) return
    const now = currentLook()
    const arms = o.skin.slim ? 'slim' : 'classic'
    let skipped = 0
    setOutfitBusy(o.id)
    try {
      if (now.skin.url !== o.skin.url || now.skin.slim !== o.skin.slim) {
        const item = o.skin.wardrobeId
          ? wardrobe.find((i) => i.id === o.skin.wardrobeId && i.kind === 'skin')
          : undefined
        if (item && (item.model === 'slim') === o.skin.slim) {
          await useWardrobeSkin(item)
          chooseVariant('w:' + item.id, arms, false)
        } else {
          const my = o.skin.myFile ? mySkins.findIndex((s) => s.file === o.skin.myFile) : -1
          const url = my >= 0 ? mySkins[my].data : o.skin.url
          setSkinSrc(url)
          setActiveMy(my >= 0 ? mySkins[my].file : null)
          setActiveWardrobe(null)
          chooseVariant(my >= 0 ? 'm:' + mySkins[my].file : 's:' + url, arms, false)
          await applyToMillida(url, arms)
        }
      }

      if (o.cape !== now.cape) {
        if (o.cape === 'none') {
          chooseCape('none')
          if (hasMillidaAccount()) await uploadTexture('cape', null).then(() => refreshWardrobe())
        } else {
          const c = capes.find((x) => x.id === o.cape)
          if (!c || c.locked) skipped++
          else {
            chooseCape(c.id)
            const target = capeTarget(c)
            const [millida, license] = await Promise.allSettled([
              wearOnMillida(c),
              target ? switchLicensedCape(target.accId, target.msId) : Promise.resolve(false),
            ])
            if (millida.status === 'rejected') throw millida.reason
            if (license.status === 'rejected') showToast('Плащ лицензии не переключился: ' + license.reason, 'error')
          }
        }
      }

      // Закрытое — снятое с подписки или непокупленное — пропускаем: сервер
      // отказал бы всему набору из-за одной вещи.
      const { wear, skipped: locked } = splitWearable(o.cosmetics, (id) => {
        const item = cosmetics.find((c) => c.id === id)
        return !!item && !cosmeticLocked(item)
      })
      skipped += locked.length
      const same =
        wear.length === worn.length && wear.every((w) => worn.some((x) => x.id === w.id && x.variant === w.variant))
      if (!same) {
        await applyCosmetics(wear)
        setWorn(wear)
        setFitting([])
      }

      if (skipped) showToast('«' + o.name + '» надет, закрытых вещей пропущено: ' + skipped)
      else showReward({ level: 'small', items: [{ name: o.name, icon: 'looks' }], title: '«' + o.name + '» надет' })
    } catch (e) {
      trackFailure('skins', e, { step: 'outfit' })
      showToast(apiErrorText(e, 'Образ надет не целиком'), 'error')
    } finally {
      setOutfitBusy(null)
    }
  }

  /**
   * Карточка образа: фигура под своим углом и вещи образа миниатюрами. Одна и
   * та же фигура в одной позе на всех карточках читалась как ряд копий
   * (владелец 24.09.2026: «образы выглядят однотипно»).
   */
  const OUTFIT_YAW = [-0.9, 0.7, -0.35, 1.0, -0.6, 0.35]
  const OUTFIT_TONE = [
    'var(--m-rarity-rare)',
    'var(--m-rarity-epic)',
    'var(--m-rarity-legendary)',
    'var(--m-accent)',
    'var(--m-ruby)',
    'var(--m-rarity-uncommon)',
  ]
  const outfitArt = (o: Outfit) => {
    // По месту в ряду, а не по id: соседние карточки гарантированно разного цвета.
    const at = Math.max(0, outfits.findIndex((x) => x.id === o.id))
    const yaw = OUTFIT_YAW[at % OUTFIT_YAW.length] as number
    const tone = OUTFIT_TONE[at % OUTFIT_TONE.length] as string
    const items = o.cosmetics
      .map((c) => cosmetics.find((x) => x.id === c.id))
      .filter((c): c is CosmeticItem => !!c)
    const capeUrl = o.cape !== 'none' ? capes.find((c) => c.id === o.cape)?.url : undefined
    return (
      <span className="ch-look-art" style={{ '--look-tone': tone } as CSSProperties}>
        <SkinBody
          url={o.skin.url}
          model={o.skin.slim ? 'slim' : 'default'}
          height={120}
          yaw={yaw}
          fallback={<SkinThumb url={o.skin.url} slim={o.skin.slim} />}
        />
        {items.length || capeUrl ? (
          <span className="ch-look-items">
            {capeUrl ? (
              <span className="ch-look-item">
                <CapePreview url={capeUrl} h={26} />
              </span>
            ) : null}
            {items.slice(0, capeUrl ? 3 : 4).map((it) => (
              <span key={it.id} className="ch-look-item">
                <CosmeticArt item={it} height={30} />
              </span>
            ))}
          </span>
        ) : null}
      </span>
    )
  }

  // ---- разделы, чипы, полоса «Надето» ----

  const figureArt = (h: number) => (
    <SkinBody
      url={skinSrc || skinUrl(nick)}
      model={variant === 'slim' ? 'slim' : 'default'}
      height={h}
      fallback={<SkinThumb url={skinSrc || skinUrl(nick)} size={32} slim={variant === 'slim'} />}
    />
  )
  /* Разделы — одноцветными значками, как в Essential Mod (владелец 23.09.2026,
     «возьми с Essential для кнопок разделов косметики»). Картинки вещей в
     кнопках раздела сливались в пёструю полосу. */
  const sectionList: Section[] = [
    { key: 'looks', name: 'Образы', icon: 'ws-looks' },
    { key: 'skin', name: 'Скины', icon: 'ws-skin' },
    { key: 'cape', name: 'Плащи', icon: 'ws-cape', alert: readyRewards > 0 },
    ...sections.map((sec) => ({ key: sec.key, name: sec.name, icon: 'ws-' + sec.key })),
  ]

  const pickSection = (key: string) => {
    setSection(key)
    setCosmeticQuery('')
  }


  const pickChip = (key: string) => {
    setChipBy((now) => ({ ...now, [section]: key }))
    if (section === 'skin' && key !== 'mine') {
      const kind = key as ShowcaseKind
      if (catKind === kind && chipKey === key) void loadCatalog(kind)
      else setCatKind(kind)
    }
  }

  const chipList =
    section === 'skin'
      ? SKIN_CHIPS.map((c) => ({ key: c.key, name: c.name }))
      : section === 'cape'
        ? earnedCapes.length
          ? [
              { key: 'all', name: 'Все', count: ownCapes.length + cosmetics.filter((c) => c.slot === 'CAPE').length },
              { key: 'quest', name: 'За задания', count: earnedCapes.length },
            ]
          : []
        : sectionDef
          ? sectionDef.chips.map((c) => ({
              key: c.key,
              name: c.name,
              count: cosmetics.filter((x) => c.slots.includes(x.slot)).length,
            }))
          : []

  const ownFilter = (
    <div className="segs ch-own">
      {(
        [
          ['all', 'Все'],
          ['mine', 'Мои'],
        ] as [string, string][]
      ).map(([key, label]) => (
        <button key={key} className={'seg' + (own === key ? ' on' : '')} data-track={'wardrobe_own_' + key} onClick={() => setOwn(key)}>
          {label}
        </button>
      ))}
    </div>
  )

  const cosmeticTile = (c: CosmeticItem) => {
    const locked = cosmeticLocked(c)
    return (
      <ItemTile
        key={c.id}
        art={<CosmeticArt item={c} height={128} />}
        name={c.name}
        rarity={(c as CosmeticItem & { rarity?: string }).rarity}
        locked={locked}
        plus={locked && c.access === 'PLUS'}
        priceRubies={locked && onSale(c) ? c.priceRubies : undefined}
        note={locked ? earnedNote(c) : undefined}
        on={worn.some((w) => w.id === c.id)}
        trying={fitting.some((f) => f.id === c.id)}
        loading={fitLoading.includes(c.id) || cosmeticBusy === c.id}
        track={worn.some((w) => w.id === c.id) ? 'item_take_off' : locked ? 'item_try_on' : 'item_wear'}
        kind="item"
        itemId={c.id}
        onClick={() => cardAction(c)}
        star={{ on: stars.includes(c.id), toggle: () => setStars(toggleStar(c.id)) }}
      />
    )
  }

  /** Плащ аккаунта: нажатие на надетый снимает его — так же, как у косметики. */
  const capeTile = (c: CapeOption) => {
    const my = c.id.startsWith('my:')
    return (
      <ItemTile
        key={c.id}
        art={<CapePreview url={c.url} h={128} />}
        name={c.name}
        note={c.locked ? (c.rewardReady ? 'Можно забрать' : c.requirement || 'Пока закрыт') : undefined}
        rarity={c.rarity}
        locked={c.locked}
        on={c.id === cape}
        track={c.id === cape && !c.locked ? 'cape_take_off' : 'cape_pick'}
        kind="cape"
        itemId={my ? 'my' : c.id}
        onClick={() => (c.id === cape && !c.locked ? takeOffCape() : pickCapeOption(c))}
        onRemove={my ? () => removeMyCape(Number(c.id.slice(3))) : undefined}
      />
    )
  }

  /**
   * Плитки «Открыть с PLUS» больше нет: PLUS не даёт вещей, это только платная
   * строка бонуса (решение владельца 24.09.2026, 18:22). Вещи бывшего набора —
   * в магазине за рубины.
   */
  const plusTile =
    false && !plus?.active && own === 'all' && shelf.some((c) => c.access === 'PLUS' && cosmeticLocked(c)) ? (
      <ItemTile
        key="plus"
        action
        art={
          <span className="ch-plus-art">
            <Icon id="i-star" />
          </span>
        }
        name={plusBusy ? 'Открываем…' : 'Открыть с PLUS'}
        status={rubles(plus?.priceKopecks ?? 29900) + ' в месяц'}
        track="plus_subscribe"
        onClick={plusBusy ? undefined : () => void startPlus()}
      />
    ) : null

  const shownShelf = shelf.slice(0, shownIn(shelfKey))
  const shelfTail =
    shelf.length > shownShelf.length ? (
      <LoadMore key={shelfKey + ':' + shownShelf.length} onMore={() => showMoreIn(shelfKey)} />
    ) : null

  const capesShown = (list: CapeOption[]) =>
    list
      .filter((c) => (own === 'mine' ? !c.locked : true))
      .filter((c) => !cosmeticQueryNorm || c.name.toLowerCase().includes(cosmeticQueryNorm))

  const searchBox = (placeholder: string, value: string, set: (v: string) => void, onEnter?: () => void) => (
    <div className="input sm ch-search">
      <Icon id="i-search" />
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.()
        }}
      />
      {value ? (
        <button className="ch-search-x" aria-label="Очистить" data-track="search_clear" onClick={() => set('')}>
          <Icon id="i-x" />
        </button>
      ) : null}
    </div>
  )

  const catalogBroken =
    cosmetics.length === 0 ? (
      <div className="load-again">
        <span>{cosmeticsFailed ? 'Каталог не загрузился' : 'Каталог пока пуст'}</span>
        <button className="btn sm secondary" onClick={() => void refreshCosmetics()}>
          <Icon id="i-restart" />
          Повторить
        </button>
      </div>
    ) : null

  const nothing = <div className="ch-nothing">Ничего не нашлось</div>

  const skinPanel = (
    <>
      {importOpen ? (
        <div className="ch-import">
          <div className="input sm">
            <Icon id="i-link" />
            <input
              placeholder="Ссылка на PNG или ник игрока…"
              value={importUrl}
              autoFocus
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                if (NICK_RE.test(importUrl.trim())) void importByNick()
                else void importByUrl()
              }}
            />
          </div>
          <button className="btn sm ghost" onClick={() => setImportOpen(false)}>
            Отмена
          </button>
          <button
            className="btn sm primary"
            disabled={importing || !importUrl.trim()}
            onClick={() => (NICK_RE.test(importUrl.trim()) ? void importByNick() : void importByUrl())}
          >
            {importing ? 'Забираем…' : 'Забрать'}
          </button>
        </div>
      ) : null}

      {chipKey === 'mine' ? (
        <>
          {hasMillidaAccount() ? null : (
            <div className="ch-warn">
              <Icon id="i-lock" />
              <span>Скины только на этом компьютере</span>
              <button className="btn sm secondary" onClick={() => logoutToLogin()}>
                <Icon id="i-login" />
                Войти
              </button>
            </div>
          )}
          <ItemGrid>
            {mySkins.map((sk, i) => (
              <ItemTile
                key={'my:' + sk.file}
                art={<SkinCardThumb url={sk.data} slim={sk.slim} />}
                name={sk.name}
                note={sk.slim ? 'Тонкие руки' : 'Классические руки'}
                on={activeMy === sk.file}
                onClick={() => {
                  chooseVariant('m:' + sk.file, sk.slim ? 'slim' : 'classic', false)
                  pickAndApply(sk.data, () => {
                    setActiveMy(sk.file)
                    setActiveWardrobe(null)
                  })
                }}
                onRemove={() => removeMySkin(i)}
              />
            ))}
            {wardrobe
              .filter((i) => i.kind === 'skin')
              .map((item) => (
                <ItemTile
                  key={item.id}
                  art={<SkinCardThumb url={item.url} slim={item.model === 'slim'} />}
                  name={item.name}
                  note={item.model === 'slim' ? 'Тонкие руки' : 'Классические руки'}
                  on={activeWardrobe === item.id}
                  onClick={() => void useWardrobeSkin(item)}
                  onRemove={() => removeWardrobeSkin(item)}
                />
              ))}
            {accounts.map((a) => (
              <ItemTile
                key={a.id}
                art={
                  <SkinCardThumb
                    url={textures[a.id] ? textures[a.id].skin : skinUrl(a.nick)}
                    slim={textures[a.id] ? textures[a.id].slim : undefined}
                  />
                }
                name={a.nick}
                note="Скин аккаунта"
                mark={a.id === activeId ? <Icon id="i-user" /> : undefined}
                onClick={() => {
                  const t = textures[a.id]
                  setNick(a.nick)
                  setSkinSrc(t ? t.skin : null)
                  setActiveMy(null)
                  setActiveWardrobe(null)
                  const savedVariant = recallVariant('n:' + a.nick)
                  if (savedVariant) chooseVariant('n:' + a.nick, savedVariant, false)
                  else if (t) chooseVariant('n:' + a.nick, t.slim ? 'slim' : 'classic', false)
                  else autoVariant(skinUrl(a.nick), 'n:' + a.nick)
                  void applyToMillida(t ? t.skin : skinUrl(a.nick))
                  if (t && t.cape) {
                    const wornCape = capes.find((c) => textureHash(c.url) === textureHash(t.cape))
                    chooseCape(wornCape ? wornCape.id : 'acc:' + a.id)
                  }
                }}
              />
            ))}
            <ItemTile
              action
              art={
                <span className="ch-plus-art brush">
                  <Icon id="i-brush" />
                </span>
              }
              name="Заказать свой скин"
              status="millida.net"
              track="skin_order"
              onClick={() => {
                track('store_open', { where: 'skins_order' })
                openExt(MILLIDA_SKINS_URL)
              }}
            />
          </ItemGrid>
          {wardrobeFailed && hasMillidaAccount() ? (
            <div className="load-again">
              <span>Каталог не загрузился</span>
              <button className="btn sm secondary" onClick={() => void refreshWardrobe()}>
                <Icon id="i-restart" />
                Повторить
              </button>
            </div>
          ) : null}
        </>
      ) : catFailed ? (
        <div className="load-again">
          <span>Каталог не загрузился</span>
          <button className="btn sm secondary" onClick={() => void loadCatalog(catKind)}>
            <Icon id="i-restart" />
            Повторить
          </button>
        </div>
      ) : catFound.length || NICK_RE.test(catQuery.trim()) ? (
        <ItemGrid>
          {NICK_RE.test(catQuery.trim()) ? (
            <ItemTile
              art={<CatalogThumb nick={catQuery.trim()} />}
              name={catQuery.trim()}
              note="Скин игрока"
              onClick={() => selectCatalog({ key: '', nick: catQuery.trim(), label: catQuery.trim() })}
            />
          ) : null}
          {catFound.map((c) => {
            const url = c.textureId ? showcaseSkinUrl(c.textureId) : ''
            return (
              <ItemTile
                key={c.name}
                art={<CatalogThumb nick={c.name} url={url} />}
                name={c.name}
                onClick={() => selectCatalog({ key: c.name, nick: c.name, label: c.name, url })}
              />
            )
          })}
        </ItemGrid>
      ) : (
        <div className="ch-nothing">{catQuery.trim() ? 'Ничего не нашли' : 'Каталог пока пуст'}</div>
      )}
    </>
  )

  const capePanel =
    chipKey === 'quest' && !cosmeticQueryNorm ? (
      <ItemGrid>{capesShown(earnedCapes).map(capeTile)}</ItemGrid>
    ) : (
      <>
        {capesShown(ownCapes).length || shownShelf.length ? (
          <ItemGrid>
            {capesShown(ownCapes).map(capeTile)}
            {shownShelf.map(cosmeticTile)}
          </ItemGrid>
        ) : (
          nothing
        )}
        {shelfTail}
      </>
    )

  const cosmeticPanel = catalogBroken || (
    <>
      {shelf.length ? (
        <ItemGrid>
          {plusTile}
          {shownShelf.map(cosmeticTile)}
        </ItemGrid>
      ) : (
        nothing
      )}
      {shelfTail}
    </>
  )

  const sectionName = sectionList.find((s) => s.key === section)?.name ?? 'Гардероб'

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-skins">
      <div className="ch-grid">
        <div className="ch-center">
          {/* Фон сцены — та же цветная сцена, что в лобби (правка 22:35): за
              сценой, а не внутри, чтобы не мешать 3D-холсту. */}
          <div className="ch-stage-bg" aria-hidden="true">
            <PixelField on={on} />
          </div>
          <div
            className="ch-stage"
            id="skinStage"
            ref={stageRef}
            onPointerDown={startTurn}
            onPointerUp={endTurn}
            onPointerCancel={endTurn}
            onPointerMove={turnOrAim}
            onWheel={zoomStage}
            onPointerLeave={endTurn}
            onDoubleClick={() => {
              viewerRef.current?.setPlayerYaw(0)
              viewerRef.current?.setZoom(1)
            }}
          >
            <div className="skin-aura" aria-hidden="true"></div>
            <canvas
              key={glEpoch}
              id="skinCanvas"
              ref={canvasRef}
              style={{
                imageRendering: 'auto',
                display: use3d ? undefined : 'none',
                opacity: modelShown ? 1 : 0,
                transition: 'opacity var(--m-t-base)',
              }}
            ></canvas>
            {use3d && !modelShown ? <span className="skin-loader" aria-label="Загружаем модель"></span> : null}
            {fitLoading.length ? (
              <span className="stage-note" aria-live="polite">
                <span className="stage-spin" aria-hidden="true"></span>
                Надеваем…
              </span>
            ) : null}
            {!use3d && fallback ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <SkinThumb url={skinSrc || skinUrl(nick)} size={288} slim={variant === 'slim'} />
              </div>
            ) : !use3d ? (
              <span className="skin-loader" aria-label="Загружаем модель"></span>
            ) : null}
          </div>

          <FittingBar
            pieces={fitting.map((item) => {
              const locked = cosmeticLocked(item)
              return {
                id: item.id,
                name: item.name,
                art: <CosmeticArt item={item} height={54} />,
                price: locked && onSale(item) ? item.priceRubies : undefined,
                note: locked ? earnedNote(item) : undefined,
                plus: locked && item.access === 'PLUS',
                loading: fitLoading.includes(item.id),
                tones: item.variants,
                tone: variantOf(item)?.name,
              }
            })}
            total={fittingTotal}
            rubies={rubies}
            busy={cosmeticBusy === 'fitting'}
            canWear={fitting.some((c) => !cosmeticLocked(c))}
            needLogin={!hasMillidaAccount()}
            onPick={(id) => {
              const item = fitting.find((c) => c.id === id)
              if (!item) return
              if (item.slot === 'CAPE') {
                pickSection('cape')
                return
              }
              const sec = sections.find((x) => x.chips.some((c) => c.slots.includes(item.slot)))
              const chip = sec?.chips.find((c) => c.slots.includes(item.slot))
              if (!sec || !chip) return
              setChipBy((now) => ({ ...now, [sec.key]: chip.key }))
              pickSection(sec.key)
            }}
            onTone={(id, tone) => setVariantById((now) => ({ ...now, [id]: tone }))}
            onClear={() => setFitting([])}
            onBuy={() => (!hasMillidaAccount() ? logoutToLogin() : void buyFitting())}
            onTopUp={() => setScreen('rubies')}
            onWear={() => void wearFitting()}
            onPlus={
              !plus?.active && fitting.some((c) => c.access === 'PLUS' && cosmeticLocked(c))
                ? () => void startPlus()
                : undefined
            }
          />

        </div>

        <div className="ch-panel">
          <SectionBar sections={sectionList} active={section} onPick={pickSection} />

          {gameNick.conflict ? (
            <div className="ch-warn">
              <Icon id="i-alert" />
              <span>
                В игре ты <b>{gameNick.name}</b> — ник занят
              </span>
              <button className="btn sm secondary" onClick={() => openExt(SUPPORT_URL)}>
                Поддержка
              </button>
            </div>
          ) : null}

          <div className="ch-bar">
            {chipList.length > 1 ? (
              <ChipRow chips={chipList} active={chipKey} onPick={pickChip} />
            ) : (
              <h3 className="ch-bar-title">{sectionName}</h3>
            )}
            {/* Одна раскладка во всех разделах (владелец 24.09.2026, 19:34): чипы
                слева, справа «Снять» (если в разделе что-то надето) и «Все/Мои».
                Поиска по вещам и «Снять всё» нет. */}
            {(() => {
              const off = sectionTakeOff(
                section,
                (sections.find((x) => x.key === section)?.chips ?? []).flatMap((c) => c.slots),
                worn,
                !!currentCape,
              )
              const cosmetic = section !== 'skin' && section !== 'looks'
              if (!off && !cosmetic) return null
              return (
                <div className="ch-tools">
                  {off ? (
                    <button
                      className="btn sm secondary"
                      disabled={!!cosmeticBusy}
                      data-track="take_off_section"
                      onClick={() => {
                        if (off.accountCape) takeOffCape()
                        void takeOffSlots(off.slots)
                      }}
                    >
                      <Icon id="i-x" /> Снять
                    </button>
                  ) : null}
                  {cosmetic ? ownFilter : null}
                </div>
              )
            })()}
          </div>

          {section === 'skin' && chipKey !== 'mine' ? (
            <div className="ch-bar">
              {searchBox('Ник или название…', catQuery, setCatQuery, () => {
                if (NICK_RE.test(catQuery.trim()))
                  selectCatalog({ key: '', nick: catQuery.trim(), label: catQuery.trim() })
              })}
            </div>
          ) : null}

          {plusJoy ? <PlusCelebration items={plus?.items ?? 100} onDone={endPlusJoy} /> : null}

          {section === 'skin' ? (
            skinPanel
          ) : section === 'looks' ? (
            <Outfits
              list={outfits}
              activeId={activeOutfit}
              busyId={outfitBusy}
              art={outfitArt}
              currentArt={figureArt(112)}
              onSave={saveOutfit}
              onWear={(o) => void wearOutfit(o)}
              onRename={(id, name) => keepOutfits(renameOutfit(outfits, id, name))}
              onRemove={dropOutfit}
            />
          ) : section === 'cape' ? (
            capePanel
          ) : (
            cosmeticPanel
          )}
        </div>
      </div>

      {capeInfo ? (
        <div className="modal-bg open vis" onClick={() => setCapeInfo(null)}>
          <div className="modal mw-xs" onClick={(e) => e.stopPropagation()}>
            <h3>{capeInfo.name}</h3>
            <div className="cape-info-art">
              <CapePreview url={capeInfo.url} h={120} />
            </div>
            <div className="sub">{capeInfo.requirement || 'Плащ каталога Millida'}</div>
            {capeInfo.progress !== undefined ? (
              <>
                <span className="cape-prog" style={{ marginTop: '14px' }}>
                  <span className="cape-prog-bar" style={{ width: capeInfo.progress + '%' }}></span>
                </span>
                <div className="cape-prog-txt">{capeInfo.progressLabel || capeInfo.progress + ' %'}</div>
              </>
            ) : null}
            {capeInfo.hint ? (
              <div className="sub" style={{ marginTop: '10px' }}>
                {capeInfo.hint}
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button className="btn md secondary" onClick={() => setCapeInfo(null)}>
                Закрыть
              </button>
              {capeInfo.rewardCode && capeInfo.rewardReady ? (
                <button
                  className="btn md primary"
                  disabled={claiming === capeInfo.rewardCode}
                  onClick={() => void takeCape(capeInfo)}
                >
                  {claiming === capeInfo.rewardCode ? 'Выдаём…' : 'Забрать'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
