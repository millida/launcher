import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { getAccount, useAccounts } from '../state/accounts'
import type { Account } from '../state/accounts'
import { showToast } from '../state/ui'
import { accKindLabel } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import {
  deleteTexture,
  fetchTexture,
  listTextures,
  mcTextures,
  msProfile,
  msResetSkin,
  msSetCape,
  msUploadSkin,
  exportPng,
  pickTexture,
  saveTexture,
  setLocalSkin,
  setTextureSlim,
} from '../ipc/commands'
import type { MsCape, TextureEntry, TextureKind } from '../ipc/commands'
import { loadMine3d } from '../lib/mine3d'
import type { Mine3dModule } from '../lib/mine3d'
import type { ShotPresetId, SkinAnimId, SkinViewEngine } from '../vendor/mine3d'
import { textureSource } from '../lib/textureSource'
import { capeTitle, dedupeByTitle, dedupeCapes, textureHash } from '../lib/capes'
import { Select } from '../components/Select'
import { SkinBody } from '../components/SkinBody'
import { SkinDiag } from '../components/SkinDiag'
import { renderAvatar } from '../lib/skinBody'
import {
  addToWardrobe,
  applyCatalogCape,
  applyWardrobeItem,
  claimReward,
  loadCapeCatalog,
  loadRewards,
  loadWardrobe,
  removeWardrobeItem,
  setSkinSource,
  skinSource,
  uploadTexture,
} from '../lib/gameProfile'
import type { CapeCatalogItem, RewardItem, WardrobeItem } from '../lib/gameProfile'
import { refreshGameNick, useGameNick } from '../state/gameNick'
import { hasMillidaAccount, openExt } from '../lib/api'
import { track } from '../lib/telemetry'
import { loadMillidaProfile } from '../lib/session'
import { ensureMsAuth } from '../state/msLogin'

interface CatalogSkin {
  key: string
  label: string
  nick?: string
  url?: string
}

const mojangTexture = (hash: string) => 'https://textures.minecraft.net/texture/' + hash

const OFFICIAL_SKINS: CatalogSkin[] = [
  { key: 'off-steve', label: 'Стив', url: mojangTexture('31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb') },
  { key: 'off-alex', label: 'Алекс', url: mojangTexture('46acd06e8483b176e8ea39fc12fe105eb3a2a4970f5100057e9d84d4b60bdfa7') },
  { key: 'off-ari', label: 'Ари', url: mojangTexture('6ac6ca262d67bcfb3dbc924ba8215a18195497c780058a5749de674217721892') },
  { key: 'off-efe', label: 'Эфе', url: mojangTexture('fece7017b1bb13926d1158864b283b8b930271f80a90482f174cca6a17e88236') },
  { key: 'off-makena', label: 'Макена', url: mojangTexture('7cb3ba52ddd5cc82c0b050c3f920f87da36add80165846f479079663805433db') },
  { key: 'off-noor', label: 'Нур', url: mojangTexture('6c160fbd16adbc4bff2409e70180d911002aebcfa811eb6ec3d1040761aea6dd') },
  { key: 'off-zuri', label: 'Зури', url: mojangTexture('eee522611005acf256dbd152e992c60c0bb7978cb0f3127807700e478ad97664') },
]

const byNick = (nick: string, label?: string): CatalogSkin => ({ key: nick, nick, label: label || nick })

const CATALOG: { group: string; items: CatalogSkin[] }[] = [
  { group: 'Официальные Minecraft', items: OFFICIAL_SKINS },
  {
    group: 'Классические',
    items: [byNick('MHF_Steve', 'Классический Стив'), byNick('MHF_Alex', 'Классическая Алекс'), byNick('MHF_Herobrine', 'Херобрин')],
  },
  {
    group: 'Легенды Minecraft',
    items: [
      byNick('Notch'),
      byNick('jeb_'),
      byNick('Technoblade'),
      byNick('Herobrine'),
      byNick('hypixel', 'Hypixel'),
      byNick('deadmau5'),
      byNick('Dream'),
      byNick('Skeppy'),
    ],
  },
  {
    group: 'Русские блогеры',
    items: [
      byNick('MrLololoshka', 'MrLololoshka'),
      byNick('Lololoshka'),
      byNick('TheBrainDit', 'TheBrainDit'),
      byNick('DILLERON', 'Диллерон'),
      byNick('DILLER', 'Diller'),
      byNick('Kompot', 'Компот'),
      byNick('Compot', 'Compot'),
      byNick('Edison', 'Edison'),
      byNick('Marmok', 'Мармок'),
      byNick('EeOneGuy', 'Ивангай'),
      byNick('EvgenBro', 'ЕвгенБро'),
      byNick('FixEye', 'Фиксай'),
      byNick('Frost', 'Фрост'),
      byNick('kubik', 'Кубик'),
      byNick('Pozzy', 'Поззи'),
      byNick('NuBiK', 'Нубик'),
      byNick('Affka', 'Аффка'),
      byNick('hrustik', 'Хрустик'),
    ],
  },
  {
    group: 'Хардкор и технари',
    items: [
      byNick('Grian'),
      byNick('Mumbo_Jumbo', 'Mumbo Jumbo'),
      byNick('iskall85'),
      byNick('Etho'),
      byNick('Docm77'),
      byNick('xisumavoid'),
      byNick('VintageBeef'),
      byNick('CaptainSparklez'),
    ],
  },
  {
    group: 'Dream SMP',
    items: [
      byNick('TommyInnit'),
      byNick('Tubbo_', 'Tubbo'),
      byNick('Ranboo'),
      byNick('Quackity'),
      byNick('Purpled'),
      byNick('Antfrost'),
      byNick('BadBoyHalo'),
      byNick('Sapnap'),
      byNick('PhilzA', 'Philza'),
    ],
  },
]

const NICK_RE = /^[A-Za-z0-9_]{3,16}$/

const rewardProgress = (r: { unit: string; progress: number; goal: number }) =>
  r.unit === 'seconds'
    ? Math.floor(r.progress / 3600) + ' из ' + Math.floor(r.goal / 3600) + ' ч'
    : r.progress + ' из ' + r.goal

const MILLIDA_SKINS_URL = 'https://millida.net/skins'

const MILLIDA_CAPE = '/capes/millida.png'

// Mojang cape texture hashes, verified to resolve on textures.minecraft.net.
const OFFICIAL_CAPES: { id: string; name: string; hash: string }[] = [
  { id: 'off:migrator', name: 'Переселенец', hash: '2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933' },
  { id: 'off:vanilla', name: 'Vanilla', hash: 'f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4' },
  { id: 'off:cherry', name: 'Сакура', hash: 'afd553b39358a24edfe3b8a9a939fa5fa4faa4d9a9c3d6af8eafb377fa05c2bb' },
  { id: 'off:pan', name: 'Pan', hash: '28de4a81688ad18b49e735a273e086c18f1e3966956123ccb574034c06f5d336' },
  { id: 'off:mojang', name: 'Mojang Studios', hash: '9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7' },
  { id: 'off:anniv15', name: '15 лет', hash: 'cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625' },
  { id: 'off:cobalt', name: 'Cobalt', hash: 'ca29f5dd9e94fb1748203b92e36b66fda80750c87ebc18d6eafdb0e28cc1d05f' },
  { id: 'off:minecon2011', name: 'MineCon 2011', hash: '953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6' },
  { id: 'off:minecon2012', name: 'MineCon 2012', hash: 'a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6' },
  { id: 'off:minecon2013', name: 'MineCon 2013', hash: '153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da' },
  { id: 'off:minecon2015', name: 'MineCon 2015', hash: 'b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635' },
  { id: 'off:minecon2016', name: 'MineCon 2016', hash: 'e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980' },
]
const capeTexUrl = (h: string) => 'https://textures.minecraft.net/texture/' + h
const OFFICIAL_HASHES = new Set(OFFICIAL_CAPES.map((c) => c.hash))

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

const skinUrl = (n: string) => 'https://api.millida.net/v2/heads/skin/' + encodeURIComponent(n)

function loadImg(url: string): Promise<HTMLImageElement> {
  return textureSource(url).then(
    (src) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.crossOrigin = 'anonymous'
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('текстура недоступна: ' + url))
        i.src = src
      }),
  )
}

type SkinArea = [number, number, number, number]

const AREAS_UNUSED_BY_SLIM: SkinArea[] = [
  [50, 16, 2, 4],
  [54, 20, 2, 12],
  [42, 48, 2, 4],
  [46, 52, 2, 12],
]

type PixelTest = (d: Uint8ClampedArray, i: number) => boolean

const isOpaquePixel: PixelTest = (d, i) => d[i + 3] === 255
const isBlackPixel: PixelTest = (d, i) => d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255
const isWhitePixel: PixelTest = (d, i) => d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255 && d[i + 3] === 255

function detectSlim(img: HTMLImageElement): boolean {
  if (img.height < img.width) return false
  try {
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return false
    g.drawImage(img, 0, 0)
    const s = img.width / 64
    const everyPixel = (a: SkinArea, ok: PixelTest) => {
      const d = g.getImageData(
        Math.round(a[0] * s),
        Math.round(a[1] * s),
        Math.max(1, Math.round(a[2] * s)),
        Math.max(1, Math.round(a[3] * s)),
      ).data
      for (let i = 0; i < d.length; i += 4) if (!ok(d, i)) return false
      return true
    }
    const hasTransparency = AREAS_UNUSED_BY_SLIM.some((a) => !everyPixel(a, isOpaquePixel))
    const filledFlat =
      AREAS_UNUSED_BY_SLIM.every((a) => everyPixel(a, isBlackPixel)) ||
      AREAS_UNUSED_BY_SLIM.every((a) => everyPixel(a, isWhitePixel))
    return hasTransparency || filledFlat
  } catch {
    return false
  }
}

function detectSlimFromUrl(url: string): Promise<boolean> {
  return loadImg(url).then(detectSlim)
}

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

function recallVariant(key: string): string | null {
  const v = readVariants()[key]
  return v === 'slim' || v === 'classic' ? v : null
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

/// Front projection of a skin texture; legacy 64x32 has no second layer and mirrors limbs.
function drawFront(g: CanvasRenderingContext2D, img: HTMLImageElement, slim: boolean) {
  const s = img.width / 64
  const is64 = img.height >= img.width
  const armW = slim ? 3 : 4
  g.imageSmoothingEnabled = false
  g.clearRect(0, 0, 16, 32)
  const px = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => {
    try {
      g.drawImage(img, sx * s, sy * s, sw * s, sh * s, dx, dy, sw, sh)
    } catch {}
  }
  px(8, 8, 8, 8, 4, 0) // head
  px(20, 20, 8, 12, 4, 8) // body
  px(44, 20, armW, 12, 4 - armW, 8) // right arm
  if (is64) px(36, 52, armW, 12, 12, 8)
  else px(44, 20, armW, 12, 12, 8) // left arm (legacy: mirrored right arm)
  px(4, 20, 4, 12, 4, 20) // right leg
  if (is64) px(20, 52, 4, 12, 8, 20)
  else px(4, 20, 4, 12, 8, 20) // left leg
  if (is64) {
    px(40, 8, 8, 8, 4, 0) // hat layer
    px(20, 36, 8, 12, 4, 8) // jacket
    px(44, 36, armW, 12, 4 - armW, 8) // right sleeve
    px(52, 52, armW, 12, 12, 8) // left sleeve
    px(4, 36, 4, 12, 4, 20) // right pant
    px(4, 52, 4, 12, 8, 20) // left pant
  }
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
          fontSize: '10px',
          textAlign: 'center',
          lineHeight: 1.2,
        }}
      >
        нет
        <br />
        картинки
      </span>
    )
  return (
    <canvas
      ref={ref}
      style={{ width: (h * 10) / 16 + 'px', height: h + 'px', imageRendering: 'pixelated', display: 'block', borderRadius: '4px' }}
    />
  )
}

const SHOT_PRESETS: { id: ShotPresetId; label: string; fillY: number; offsetY: number }[] = [
  { id: 'hero', label: 'Герой', fillY: 0.74, offsetY: 0 },
  { id: 'bust', label: 'Бюст', fillY: 0.8, offsetY: -0.02 },
  { id: 'back', label: 'Спина', fillY: 0.74, offsetY: 0 },
]

const MILLIDA_LIGHT = {
  keyAzimuthDeg: 52,
  keyElevationDeg: 38,
  keyIntensity: 2.05,
  ambientIntensity: 0.32,
  fillIntensity: 0.46,
  shadowRadius: 4.8,
  shadowIntensity: 0.66,
}

const ANIMATIONS: { value: SkinAnimId; label: string }[] = [
  { value: 'idle', label: 'Спокойствие' },
  { value: 'run', label: 'Бег' },
  { value: 'wave', label: 'Приветствие' },
  { value: 'dance', label: 'Танец' },
  { value: 'cool', label: 'Поза' },
  { value: 'victory', label: 'Победа' },
  { value: 'sneak', label: 'Крадётся' },
  { value: 'look', label: 'Осматривается' },
  { value: 'glide', label: 'Полёт' },
  { value: 'sad', label: 'Грусть' },
]

const FULL_FILL_Y = 0.74

export function Skins({ on }: { on: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<SkinViewEngine | null>(null)
  const accounts = useAccounts((s) => s.list)
  const activeId = useAccounts((s) => s.active)
  const [nick, setNick] = useState(() => (getAccount() || { nick: '' }).nick || 'MHF_Steve')
  const [diagOpen, setDiagOpen] = useState(false)
  const [skinSrc, setSkinSrc] = useState<string | null>(null)
  const [variant, setVariant] = useState('classic')
  const [cape, setCape] = useState('none')
  const [tab, setTab] = useState('my')
  const [catQuery, setCatQuery] = useState('')
  const [fallback, setFallback] = useState(false)
  const [svReady, setSvReady] = useState(false)
  const [m3d, setM3d] = useState<Mine3dModule | null>(null)
  const [engineReady, setEngineReady] = useState(false)
  const [modelShown, setModelShown] = useState(false)
  const [shot, setShot] = useState<ShotPresetId | null>(null)
  const [anim, setAnim] = useState<SkinAnimId>('idle')
  const [mySkins, setMySkins] = useState<MySkin[]>([])
  const [myCapes, setMyCapes] = useState<MySkin[]>([])
  const [textures, setTextures] = useState<Record<string, AccTexture>>({})
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([])
  const [millidaTex, setMillidaTex] = useState<AccTexture | null>(null)
  const [rewards, setRewards] = useState<RewardItem[]>([])
  const [claiming, setClaiming] = useState('')
  const [activeWardrobe, setActiveWardrobe] = useState<string | null>(null)
  // Каталог плащей Millida: и открытые, и закрытые — закрытые показываем
  // затемнёнными с условием, ради них и играют.
  const [capeCatalog, setCapeCatalog] = useState<CapeCatalogItem[]>([])
  // Все плащи лицензии по аккаунтам: сессионный профиль отдаёт только надетый,
  // из-за чего «на аккаунте» помечался ровно один плащ.
  const [msCapes, setMsCapes] = useState<Record<string, MsCape[]>>({})
  const [activeMy, setActiveMy] = useState<number | null>(null)
  const activeMyRef = useRef<number | null>(null)
  activeMyRef.current = activeMy
  const capeTouched = useRef(false)
  const wardrobeVariantRef = useRef(false)
  // Request sequence: a late autodetect answer must not override a newer choice.
  const autoSeq = useRef(0)

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

  const refreshWardrobe = async () => {
    if (!hasMillidaAccount()) return
    try {
      const w = await loadWardrobe()
      setWardrobe(w.items)
      setMillidaTex(
        w.active.skinUrl
          ? { skin: w.active.skinUrl, cape: w.active.capeUrl, slim: w.active.model === 'slim' }
          : null,
      )
      const cur = w.items.find((i) => i.kind === 'skin' && i.url === w.active.skinUrl)
      setActiveWardrobe(cur ? cur.id : null)
      if (!wardrobeVariantRef.current) {
        wardrobeVariantRef.current = true
        const key = cur ? 'w:' + cur.id : null
        const saved = key ? recallVariant(key) : null
        if (saved || w.active.skinUrl) {
          autoSeq.current++
          setVariant(saved || (w.active.model === 'slim' ? 'slim' : 'classic'))
        }
      }
    } catch (e) {
      showToast('Каталог скинов недоступен: ' + e, 'error')
    }
  }

  const refreshRewards = async () => {
    if (!hasMillidaAccount()) return
    try {
      const r = await loadRewards()
      setRewards(r.items)
    } catch (e) {
      showToast('Награды не загрузились: ' + e, 'error')
    }
  }

  useEffect(() => {
    void refreshWardrobe()
    void refreshRewards()
  }, [])

  const takeReward = async (r: RewardItem) => {
    setClaiming(r.code)
    try {
      await claimReward(r.code)
      await refreshRewards()
      await refreshWardrobe()
      setTab('capes')
      showToast('Плащ «' + r.title + '» твой — он уже в каталоге аккаунта')
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

  const setMySlim = (i: number, slim: boolean) => {
    const target = mySkins[i]
    if (!target) return
    setMySkins(mySkins.map((s, x) => (x === i ? { ...s, slim, slimManual: true } : s)))
    void setTextureSlim('skins', target.file, slim, true)
      .then(setMySkins)
      .catch((e) => showToast('Не удалось сохранить тип рук: ' + e, 'error'))
  }

  const skinKey = useMemo(() => {
    if (activeWardrobe) return 'w:' + activeWardrobe
    if (activeMy !== null && mySkins[activeMy]) return 'm:' + mySkins[activeMy].file
    if (skinSrc && !skinSrc.startsWith('data:')) return 's:' + skinSrc
    return 'n:' + nick
  }, [activeWardrobe, activeMy, mySkins, skinSrc, nick])

  const autoVariant = (url: string, key: string) => {
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
      const active = activeMyRef.current
      if (active !== null && next[active]) setVariant(next[active].slim ? 'slim' : 'classic')
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
    setNick(a.nick)
    const t = textures[a.id]
    setSkinSrc(t ? t.skin : null)
    const saved = recallVariant('n:' + a.nick)
    if (saved) setVariant(saved)
    else if (t) setVariant(t.slim ? 'slim' : 'classic')
    else autoVariant(skinUrl(a.nick), 'n:' + a.nick)
  }, [activeId, textures])

  const catGroups = useMemo(() => {
    const needle = catQuery.trim().toLowerCase()
    if (!needle) return CATALOG
    return CATALOG.map((sec) => ({
      group: sec.group,
      items: sec.items.filter(
        (it) => it.label.toLowerCase().includes(needle) || (it.nick || '').toLowerCase().includes(needle),
      ),
    })).filter((sec) => sec.items.length > 0)
  }, [catQuery])
  const catFound = useMemo(() => catGroups.flatMap((s) => s.items), [catGroups])

  const capes = useMemo<CapeOption[]>(
    () => {
      const licensed: CapeOption[] = []
      const licensedHashes = new Set<string>()
      for (const a of accounts) {
        for (const c of msCapes[a.id] || []) {
          if (!c.url) continue
          licensedHashes.add(textureHash(c.url))
          licensed.push({
            id: 'ms:' + a.id + ':' + c.id,
            name: c.alias || OFFICIAL_CAPES.find((o) => o.hash === textureHash(c.url))?.name || 'Плащ',
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
      // Копии одного плаща, накопленные прошлыми версиями (каждое «Применить»
      // заливало его заново), различаются адресом, но не именем.
      const stored: CapeOption[] = dedupeByTitle(
        wardrobe
          .filter((i) => i.kind === 'cape')
          .map((i) => ({ id: 'w:' + i.id, name: i.name, url: i.url, sub: 'В каталоге Millida', wardrobeId: i.id })),
      )
      // Плащ на аккаунт Millida ставит сервер по идентификатору карточки
      // (catalogId), файл туда не уходит: список открытых плащей — серверный.
      const official: CapeOption[] = OFFICIAL_CAPES.filter((c) => !licensedHashes.has(c.hash)).map((c) => ({
        id: c.id,
        catalogId: c.id,
        name: c.name,
        url: capeTexUrl(c.hash),
        sub: 'Дизайн Mojang',
        onAccount: accHashes.has(c.hash),
      }))
      const acc: CapeOption[] = accCapes
        .filter((c) => !OFFICIAL_HASHES.has(c.hash))
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
      // Плащи каталога Millida. Уже лежащие в гардеробе аккаунта не дублируем.
      const storedHashes = new Set(stored.map((s) => textureHash(s.url)).filter(Boolean))
      const storedUrls = new Set(stored.map((s) => s.url))
      // Надетый плащ каталога лежит в аккаунте уже своей копией: адрес у неё
      // другой, а имя — то же, по нему повтор и опознаётся.
      const storedNames = new Set(stored.map((s) => capeTitle(s.name)))
      const catalog: CapeOption[] = capeCatalog
        .filter(
          (c) =>
            c.url &&
            !storedUrls.has(c.url) &&
            !storedNames.has(capeTitle(c.name)) &&
            !(textureHash(c.url) && storedHashes.has(textureHash(c.url))),
        )
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
          }
        })
      // Ранее загруженные свои плащи. Новые загрузить нельзя, но старые надеть — да.
      const mine: CapeOption[] = myCapes.map((c, i) => ({
        id: 'my:' + i,
        name: c.name,
        url: c.data,
        sub: 'Загружено ранее',
      }))
      const open = catalog.filter((c) => !c.locked)
      const shut = catalog.filter((c) => c.locked)
      return dedupeCapes(
        licensed.concat(stored).concat(open).concat(acc).concat(design).concat(mine).concat(official).concat(shut),
      )
    },
    [accounts, textures, myCapes, msCapes, wardrobe, capeCatalog],
  )

  useEffect(() => {
    let alive = true
    Promise.all(accounts.map((a) => loadAccountTexture(a, millidaTex).then((t) => [a.id, t] as const))).then((pairs) => {
      if (alive) setTextures(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [accounts, millidaTex])

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
    const h = textureHash(t ? t.cape : null)
    if (!h) return
    const same = capes.find((c) => textureHash(c.url) === h)
    if (same) setCape(same.id)
  }, [capes, textures, activeId])

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
    // Закрытый плащ каталога надеть нельзя — вместо этого напоминаем условие.
    if (c.locked) {
      showToast(c.requirement ? c.name + ' · ' + c.requirement : 'Плащ «' + c.name + '» ещё не открыт')
      return
    }
    chooseCape(c.id)
    const target = capeTarget(c)
    if (!target) {
      showToast('Плащ: ' + c.name)
      return
    }
    void switchLicensedCape(target.accId, target.msId)
      .then((done) => showToast(done ? 'Плащ «' + c.name + '» надет на лицензию' : 'Плащ: ' + c.name))
      .catch((e) => showToast('Плащ лицензии не переключился: ' + e, 'error'))
  }

  const shotRef = useRef<ShotPresetId | null>(null)
  shotRef.current = shot
  const animRef = useRef<SkinAnimId>(anim)
  animRef.current = anim

  const fitViewer = () => {
    const engine = viewerRef.current
    const stage = stageRef.current
    if (!engine || !stage) return
    const preset = SHOT_PRESETS.find((p) => p.id === shotRef.current)
    try {
      engine.setSize(stage.clientWidth || 250, stage.clientHeight || 360)
      engine.fitPlayerToFrame({
        fillY: preset ? preset.fillY : FULL_FILL_Y,
        offsetY: preset ? preset.offsetY : 0,
      })
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!m3d || !canvas) return
    let engine: SkinViewEngine
    try {
      engine = new m3d.SkinViewEngine(canvas, {
        autoResize: false,
        autoDetectModel: false,
        transparent: true,
        enableControls: true,
      })
    } catch {
      setFallback(true)
      return
    }
    engine.applyLightSettings(MILLIDA_LIGHT)
    engine.setContactShadowVisible(true)
    engine.setCursorFollow(true)
    viewerRef.current = engine
    setEngineReady(true)
    setFallback(false)
    fitViewer()
    engine.start()
    return () => {
      viewerRef.current = null
      setEngineReady(false)
      engine.dispose()
    }
  }, [m3d])

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
          if (shotRef.current) engine.applyShotPreset(shotRef.current)
          fitViewer()
          requestAnimationFrame(() => requestAnimationFrame(() => setModelShown(true)))
        })
        .catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [nick, skinSrc, engineReady])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !m3d) return
    engine.setModelType(variant === 'slim' ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
  }, [variant, m3d, engineReady])

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
      if (alive) engine.setCape(src).catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [cape, capes, engineReady])

  useEffect(() => {
    const engine = viewerRef.current
    if (!engine || !m3d) return
    if (shot) {
      engine.applyShotPreset(shot)
    } else {
      engine.clearShotPreset()
      engine.setPresentationMode('full')
      engine.setAnimation(m3d.createSkinAnimation(anim))
      engine.setCursorFollow(anim === 'idle')
    }
    fitViewer()
  }, [shot, anim, m3d, engineReady])

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
    }
    const onVis = () => setPaused(document.hidden)
    const onBlur = () => setPaused(true)
    const onFocus = () => setPaused(false)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    setPaused(document.hidden || !document.hasFocus() || !on)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [engineReady, on])

  const aimAtCursor = (e: { clientX: number; clientY: number }) => {
    const engine = viewerRef.current
    const stage = stageRef.current
    if (!engine || !stage || !engine.cursorFollow) return
    const r = stage.getBoundingClientRect()
    if (!r.width || !r.height) return
    engine.setCursorAim(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
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
      .catch((e) => showToast('Не удалось загрузить: ' + e, 'error'))
  }

  // Загрузки своих плащей больше нет: плащ можно только получить — с лицензии
  // Mojang или в каталоге Millida. Ранее загруженные плащи остаются в списке
  // (группа «Загружено ранее»), но новых добавить нельзя.

  /// Общий приём импортированной текстуры: кладём в локальную библиотеку, в
  /// каталог аккаунта и сразу показываем в превью.
  const acceptSkin = async (name: string, data: string) => {
    let slim = false
    try {
      slim = await detectSlimFromUrl(data)
    } catch {}
    const next = await saveTexture('skins', name.replace(/\.png$/i, ''), data, slim)
    setMySkins(next)
    setSkinSrc(data)
    setActiveMy(0)
    setActiveWardrobe(null)
    chooseVariant(next[0] ? 'm:' + next[0].file : 'n:' + nick, slim ? 'slim' : 'classic', false)
    if (hasMillidaAccount()) {
      try {
        await addToWardrobe({ kind: 'skin', name: name.replace(/\.png$/i, ''), pngBase64: await toPngBase64(data), slim })
        await refreshWardrobe()
      } catch (e) {
        showToast('В каталог аккаунта не сохранилось: ' + e, 'error')
      }
    }
    showToast('Скин «' + name + '» загружен · ' + (slim ? 'тонкие руки' : 'классические руки'))
  }

  const [savingAvatar, setSavingAvatar] = useState(false)

  const saveAvatar = async () => {
    if (!hasTauri()) {
      showToast('Сохранение аватара доступно в приложении', 'error')
      return
    }
    setSavingAvatar(true)
    try {
      const png = await renderAvatar(skinSrc || skinUrl(nick), variant === 'slim' ? 'slim' : 'default')
      const path = await exportPng('avatar-' + nick, png)
      if (path) showToast('Аватар сохранён: ' + path)
    } catch (e) {
      showToast('Аватар не сохранился: ' + String(e).replace(/^Error:\s*/, ''), 'error')
    } finally {
      setSavingAvatar(false)
    }
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

  const resetSkin = async () => {
    setApplying(true)
    try {
      await setLocalSkin('', '', false).catch(() => {})
      if (hasMillidaAccount()) {
        await uploadTexture('skin', null)
        await uploadTexture('cape', null)
        await loadMillidaProfile().catch(() => {})
        await refreshWardrobe()
      }
      const acc = getAccount()
      if (acc && acc.kind === 'microsoft' && hasTauri()) {
        const ms = await ensureMsAuth(acc)
        if (ms) {
          await msSetCape(ms.id, '').catch(() => {})
          await msResetSkin(ms.id).catch((e) => showToast('Скин на лицензии остался прежним: ' + e, 'error'))
          texCache.delete(acc.uuid || acc.nick)
        }
      }
      setSkinSrc(null)
      setActiveMy(null)
      setActiveWardrobe(null)
      chooseCape('none')
      showToast('Скин сброшен — вернулся стандартный')
    } catch (e) {
      showToast('Не удалось сбросить скин: ' + e, 'error')
    } finally {
      setApplying(false)
    }
  }

  const useWardrobeSkin = async (item: WardrobeItem) => {
    setSkinSrc(item.url)
    setActiveWardrobe(item.id)
    setActiveMy(null)
    chooseVariant('w:' + item.id, recallVariant('w:' + item.id) || (item.model === 'slim' ? 'slim' : 'classic'), false)
    try {
      await applyWardrobeItem(item.id)
      showToast('Скин «' + item.name + '» надет')
    } catch (e) {
      showToast('Не удалось надеть скин: ' + e, 'error')
      return
    }
    // Локальную копию обновляем тем же скином: сборки с модом скинов читают её,
    // и без этой записи в игре оставался скин с прошлого «Применить».
    if (hasTauri()) {
      try {
        await setLocalSkin(await toPngBase64(item.url), null, item.model === 'slim')
      } catch (e) {
        showToast('На этом компьютере скин не обновился — в сборках останется прежний: ' + e, 'error')
      }
    }
  }

  const removeWardrobeSkin = (item: WardrobeItem) => {
    setWardrobe(wardrobe.filter((i) => i.id !== item.id))
    if (activeWardrobe === item.id) setActiveWardrobe(null)
    void removeWardrobeItem(item.id).catch((e) => {
      showToast('Не удалось удалить из каталога: ' + e, 'error')
      void refreshWardrobe()
    })
  }

  const removeMySkin = (i: number) => {
    const target = mySkins[i]
    if (!target) return
    setMySkins(mySkins.filter((_, x) => x !== i))
    if (activeMy === i) setActiveMy(null)
    void deleteTexture('skins', target.file)
      .then(setMySkins)
      .catch((e) => showToast('Не удалось удалить: ' + e, 'error'))
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
    showToast('Скин «' + it.label + '» применён')
  }

  const readyRewards = rewards.filter((r) => r.done && !r.claimed).length

  const use3d = svReady && !fallback
  const currentCape = capes.find((c) => c.id === cape)
  const [applying, setApplying] = useState(false)

  const skinTitle = (): string => {
    const stored = activeWardrobe ? wardrobe.find((i) => i.id === activeWardrobe) : null
    if (stored) return stored.name
    if (activeMy !== null && mySkins[activeMy]) return mySkins[activeMy].name
    return 'Скин ' + nick
  }

  const refreshHead = async (texture: string) => {
    const cur = getAccount()
    if (!cur) return
    try {
      const head = await headDataUrl(texture)
      const st = useAccounts.getState()
      st.save(st.list.map((x) => (x.id === cur.id ? { ...x, avatar: head } : x)))
    } catch {}
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

  const applyToMillida = async () => {
    const texture = skinSrc
    if (!texture) {
      showToast('Сначала выбери скин — свой, из каталога или из аккаунта', 'error')
      return
    }
    setApplying(true)
    try {
      const skin = await toPngBase64(texture).catch(() => {
        throw new Error('картинка скина не читается — выбери его заново')
      })
      const capePng = currentCape
        ? await toPngBase64(currentCape.url).catch(() => {
            throw new Error('плащ «' + currentCape.name + '» не скачался — выбери другой')
          })
        : null
      if (hasTauri())
        await setLocalSkin(skin, capePng ?? '', variant === 'slim').catch((e) => {
          throw new Error('скин не сохранился на этом компьютере: ' + e)
        })
      const acc = getAccount()
      let licensed = false
      let capeLocalOnly = ''
      try {
        licensed = await applyLicensedCape()
      } catch (e) {
        showToast('Плащ лицензии не переключился: ' + e, 'error')
      }
      // Скин на лицензию уходит независимо от аккаунта Millida: раньше он был
      // привязан к загрузке в каталог, и без входа в Millida на аккаунте
      // менялся только плащ — скин оставался прежним.
      if (acc && acc.kind === 'microsoft' && hasTauri()) {
        const ms = await ensureMsAuth(acc)
        if (ms) {
          try {
            await msUploadSkin(ms.id, skin, variant === 'slim')
            texCache.delete(acc.uuid || acc.nick)
            licensed = true
          } catch (e) {
            showToast('На лицензию скин не уехал: ' + e, 'error')
          }
        }
      }
      if (hasMillidaAccount()) {
        if (skinSource() !== 'millida') setSkinSource('millida')
        const applied = await uploadTexture('skin', skin, variant === 'slim', skinTitle()).catch((e) => {
          throw new Error(
            'скин не сохранился в аккаунте Millida (' +
              String(e).replace(/^Error:\s*/, '') +
              ')' +
              (licensed ? ' — на лицензии он уже применён' : ''),
          )
        })
        if (!applied || !applied.skinUrl) throw new Error('сервер не сохранил скин')
        // Плащ из каталога аккаунта надевается по id: повторная заливка того же
        // PNG заводит в каталоге вторую карточку той же текстуры.
        // Плащ на аккаунт ставится только по идентификатору: из каталога
        // аккаунта или из каталога Millida. Заливка PNG плащом больше не
        // считается — иначе плащ выдавал себе кто угодно запросом мимо лаунчера.
        if (!currentCape) await uploadTexture('cape', null)
        else if (currentCape.wardrobeId) await applyWardrobeItem(currentCape.wardrobeId)
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
        showToast(
          licensed
            ? 'Скин применён — сохранён в каталоге Millida и на лицензии'
            : 'Скин применён и сохранён в каталоге Millida',
        )
      } else {
        await refreshHead(texture)
        showToast(
          licensed
            ? 'Скин применён на лицензии Microsoft'
            : 'Скин применён — увидишь его в игре на модовых сборках после запуска',
        )
      }
      track('skin_apply', {
        cape: currentCape ? currentCape.name : 'нет',
        variant,
        account: hasMillidaAccount() ? 'millida' : 'local',
        licensed,
      })
    } catch (e) {
      showToast('Не удалось применить скин: ' + String(e).replace(/^Error:\s*/, ''), 'error')
    } finally {
      setApplying(false)
    }
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-skins">
      <div className="page-head">
        <h1>Скины</h1>
      </div>

      <div className="skins-grid">
        <div className="card skin-preview">
          <div
            className="skin-stage"
            id="skinStage"
            ref={stageRef}
            onPointerMove={aimAtCursor}
            onPointerLeave={() => viewerRef.current?.setCursorAim(0, 0)}
            onDoubleClick={() => viewerRef.current?.nudge()}
          >
            <div className="skin-aura" aria-hidden="true"></div>
            <canvas
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
            {use3d ? (
              modelShown ? <span className="skin-rot">Потяни мышью, чтобы повернуть</span> : null
            ) : fallback ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <SkinThumb url={skinSrc || skinUrl(nick)} size={240} slim={variant === 'slim'} />
              </div>
            ) : (
              <span className="skin-loader" aria-label="Загружаем модель"></span>
            )}
          </div>
          {use3d ? (
            <>
              <div className="skin-shots">
                {SHOT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={'skin-shot' + (shot === p.id ? ' on' : '')}
                    onClick={() => setShot(shot === p.id ? null : p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="skin-anim">
                <Select
                  value={shot ? '' : anim}
                  options={ANIMATIONS}
                  placeholder="Кадр по пресету"
                  width="100%"
                  onChange={(v) => {
                    setShot(null)
                    setAnim(v as SkinAnimId)
                  }}
                />
              </div>
              <button
                type="button"
                className="skin-shot wide"
                disabled={savingAvatar}
                onClick={() => void saveAvatar()}
              >
                <Icon id="i-user" />
                {savingAvatar ? 'Готовим аватар…' : 'Сохранить аватар'}
              </button>
            </>
          ) : null}
          <div className="segs" style={{ marginTop: '14px' }}>
            {[
              ['classic', 'Классик'],
              ['slim', 'Тонкий'],
            ].map(([k, label]) => (
              <button
                key={k}
                className={'seg' + (variant === k ? ' on' : '')}
                data-skvar={k}
                style={{ height: '32px', fontSize: '12.5px' }}
                onClick={() => {
                  chooseVariant(skinKey, k, true)
                  if (activeMy !== null) setMySlim(activeMy, k === 'slim')
                  if (activeWardrobe)
                    setWardrobe(
                      wardrobe.map((i) => (i.id === activeWardrobe ? { ...i, model: k === 'slim' ? 'slim' : 'classic' } : i)),
                    )
                  showToast('Модель: ' + (k === 'slim' ? 'тонкие руки' : 'классические руки'))
                }}
              >
                <Icon id={k === 'slim' ? 'i-user' : 'i-users'} />
                {label}
              </button>
            ))}
          </div>
          <div className="skin-cape-cur">
            {currentCape ? (
              <>
                <CapePreview url={currentCape.url} h={30} />
                <span>Плащ: {currentCape.name}</span>
              </>
            ) : (
              <span style={{ color: 'var(--m-fg-faint)' }}>Без плаща</span>
            )}
          </div>
          <button
            className="btn sm primary"
            id="skinApply"
            style={{ width: '100%', marginTop: '14px' }}
            disabled={applying}
            onClick={() => void applyToMillida()}
          >
            <Icon id="i-check" />
            {applying ? 'Применяем…' : 'Применить скин'}
          </button>
          <button
            className="btn sm"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={applying}
            onClick={() => void resetSkin()}
          >
            <Icon id="i-trash" />
            Сбросить скин
          </button>
          {hasTauri() ? (
            <button className="btn sm" style={{ width: '100%', marginTop: '8px' }} onClick={() => setDiagOpen(true)}>
              <Icon id="i-info" />
              Скина нет в игре?
            </button>
          ) : null}
        </div>

        <div>
          {gameNick.conflict ? (
            <div
              className="card"
              style={{
                padding: '10px 12px',
                marginBottom: '12px',
                background: 'var(--m-danger-soft, var(--m-inset))',
                fontSize: '12.5px',
                lineHeight: 1.5,
              }}
            >
              В игру ты заходишь как <b>{gameNick.name}</b>, а не <b>{gameNick.accountNick || gameNick.name}</b>:
              игровой ник занят другим
              аккаунтом Millida. Поэтому в игре видно чужой скин — напиши в поддержку, чтобы освободить ник.
            </div>
          ) : null}
          <div className="segs" style={{ marginBottom: '14px' }}>
            <button className={'seg' + (tab === 'my' ? ' on' : '')} data-sktab="my" onClick={() => setTab('my')}>
              <Icon id="i-user" />
              Мои скины
            </button>
            <button className={'seg' + (tab === 'cat' ? ' on' : '')} data-sktab="cat" onClick={() => setTab('cat')}>
              <Icon id="i-grid" />
              Каталог
            </button>
            <button className={'seg' + (tab === 'capes' ? ' on' : '')} data-sktab="capes" onClick={() => setTab('capes')}>
              <Icon id="i-flag" />
              Плащи <span style={{ opacity: 0.6, fontSize: '11px' }}>{capes.length}</span>
            </button>
            <button
              className={'seg' + (tab === 'rewards' ? ' on' : '')}
              data-sktab="rewards"
              onClick={() => {
                setTab('rewards')
                void refreshRewards()
              }}
            >
              <Icon id="i-trophy" />
              Награды
              {readyRewards ? <span style={{ opacity: 0.85, fontSize: '11px' }}>{readyRewards}</span> : null}
            </button>
          </div>

          {tab === 'cat' ? (
            <div id="skTabCat">
              <div className="input sm" style={{ width: '100%', marginBottom: '14px' }}>
                <Icon id="i-search" />
                <input
                  placeholder="Ник игрока или название скина…"
                  value={catQuery}
                  onChange={(e) => setCatQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && NICK_RE.test(catQuery.trim())) selectCatalog({ key: '', nick: catQuery.trim(), label: catQuery.trim() })
                  }}
                />
              </div>

              {catFound.length === 0 && NICK_RE.test(catQuery.trim()) ? (
                <div className="skin-cards" style={{ marginBottom: '18px' }}>
                  <button
                    className="card hoverable skin-card"
                    onClick={() => selectCatalog({ key: '', nick: catQuery.trim(), label: catQuery.trim() })}
                  >
                    <span className="skin-thumb">
                      <CatalogThumb nick={catQuery.trim()} />
                    </span>
                    <span className="skin-body">
                      <b>{catQuery.trim()}</b>
                      <span style={{ fontSize: '11px', color: 'var(--m-fg-faint)' }}>Скин игрока Minecraft</span>
                    </span>
                  </button>
                </div>
              ) : null}

              {catGroups.map((sec) => (
                <div key={sec.group}>
                  <div className="side-cap" style={{ padding: '0 2px 8px' }}>
                    {sec.group}
                  </div>
                  <div className="skin-cards" style={{ marginBottom: '18px' }}>
                    {sec.items.map((it) => (
                      <button
                        key={it.key}
                        className="card hoverable skin-card"
                        data-nick={it.nick}
                        onClick={() => selectCatalog(it)}
                      >
                        <span className="skin-thumb">
                          <CatalogThumb nick={it.nick} url={it.url} />
                        </span>
                        <span className="skin-body">
                          <b>{it.label}</b>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {!catGroups.length && !NICK_RE.test(catQuery.trim()) ? (
                <p className="faint-note">Ничего не нашли. Введи ник игрока Minecraft — возьмём его скин.</p>
              ) : null}
            </div>
          ) : null}

          <div id="skTabMy" style={{ display: tab === 'my' ? '' : 'none' }}>
            <div className="side-cap" style={{ padding: '0 2px 8px' }}>
              Мои скины
            </div>

            {importOpen ? (
              <div className="card" style={{ padding: '12px', marginBottom: '14px', display: 'grid', gap: '10px' }}>
                <div className="input sm" style={{ width: '100%' }}>
                  <Icon id="i-search" />
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
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button className="btn sm primary" disabled={importing} onClick={() => void importByUrl()}>
                    <Icon id="i-download" />
                    По ссылке
                  </button>
                  <button className="btn sm" disabled={importing} onClick={() => void importByNick()}>
                    <Icon id="i-user" />
                    По нику игрока
                  </button>
                  <button className="btn sm" onClick={() => setImportOpen(false)}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}

            <div className="skin-cards" id="mySkins">
              <button className="card skin-card skin-add" onClick={pickSkin}>
                <span className="skin-thumb">
                  <Icon id="i-upload" />
                </span>
                <span className="skin-body">
                  <b>Загрузить</b>
                  <span style={{ fontSize: '11px', color: 'var(--m-fg-faint)' }}>PNG 64×64 или HD</span>
                </span>
              </button>
              <button className="card skin-card skin-add" onClick={() => setImportOpen(true)}>
                <span className="skin-thumb">
                  <Icon id="i-download" />
                </span>
                <span className="skin-body">
                  <b>Импортировать</b>
                  <span style={{ fontSize: '11px', color: 'var(--m-fg-faint)' }}>Ссылка или ник</span>
                </span>
              </button>
              <button
                className="card skin-card skin-order"
                onClick={() => {
                  track('store_open', { where: 'skins_order' })
                  openExt(MILLIDA_SKINS_URL)
                }}
              >
                <span className="skin-thumb">
                  <Icon id="i-brush" />
                </span>
                <span className="skin-body">
                  <b>Заказать уникальный</b>
                  <span style={{ fontSize: '11px', color: 'var(--m-fg-faint)' }}>Свой скин на Millida Skins</span>
                </span>
              </button>
              {mySkins.map((sk, i) => (
                <div
                  key={i}
                  className={'card hoverable skin-card sk-removable' + (activeMy === i ? ' on' : '')}
                  data-my={i}
                >
                  <button
                    className="sk-card-hit"
                    onClick={() => {
                      setSkinSrc(sk.data)
                      setActiveMy(i)
                      setActiveWardrobe(null)
                      chooseVariant('m:' + sk.file, sk.slim ? 'slim' : 'classic', false)
                      showToast('Скин «' + sk.name + '» применён')
                    }}
                  >
                    <span className="skin-thumb">
                      <SkinCardThumb url={sk.data} slim={sk.slim} />
                    </span>
                    <span className="skin-body">
                      <b>{sk.name}</b>
                      <span style={{ fontSize: '11px', color: 'var(--m-fg-subtle)' }}>
                        {sk.slim ? 'Тонкие руки' : 'Классические руки'}
                      </span>
                    </span>
                  </button>
                  <button className="sk-del" title="Удалить" onClick={() => removeMySkin(i)}>
                    <Icon id="i-trash" />
                  </button>
                </div>
              ))}
            </div>

            {hasMillidaAccount() ? (
              <>
                <div className="side-cap" style={{ padding: '18px 2px 8px' }}>
                  Каталог аккаунта Millida
                </div>
                {wardrobe.some((i) => i.kind === 'skin') ? (
                  <div className="skin-cards">
                    {wardrobe
                      .filter((i) => i.kind === 'skin')
                      .map((item) => (
                        <div
                          key={item.id}
                          className={'card hoverable skin-card sk-removable' + (activeWardrobe === item.id ? ' on' : '')}
                        >
                          <button className="sk-card-hit" onClick={() => void useWardrobeSkin(item)}>
                            <span className="skin-thumb">
                              <SkinCardThumb url={item.url} slim={item.model === 'slim'} />
                            </span>
                            <span className="skin-body">
                              <b>{item.name}</b>
                              <span style={{ fontSize: '11px', color: 'var(--m-fg-subtle)' }}>
                                {item.model === 'slim' ? 'Тонкие руки' : 'Классические руки'} · в аккаунте
                              </span>
                            </span>
                          </button>
                          <button className="sk-del" title="Убрать из каталога" onClick={() => removeWardrobeSkin(item)}>
                            <Icon id="i-trash" />
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="faint-note">
                    Каталог пуст. Загруженные и применённые скины сохраняются сюда — они будут на любой машине, где ты
                    войдёшь в Millida.
                  </p>
                )}
              </>
            ) : (
              <p className="faint-note" style={{ marginTop: '14px' }}>
                Войди в Millida — скины будут сохраняться в каталог аккаунта, а не только на этом компьютере.
              </p>
            )}

            {accounts.length ? (
              <>
                <div className="side-cap" style={{ padding: '18px 2px 8px' }}>
                  Скины моих аккаунтов
                </div>
                <div className="skin-cards" id="accSkins">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      className="card hoverable skin-card"
                      data-acc-skin={a.id}
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
                        if (t && t.cape) {
                          const worn = capes.find((c) => textureHash(c.url) === textureHash(t.cape))
                          chooseCape(worn ? worn.id : 'acc:' + a.id)
                        }
                        showToast('Скин аккаунта ' + a.nick + ' применён')
                      }}
                    >
                      <span className="skin-thumb">
                        <SkinCardThumb
                          url={textures[a.id] ? textures[a.id].skin : skinUrl(a.nick)}
                          slim={textures[a.id] ? textures[a.id].slim : undefined}
                        />
                      </span>
                      <span className="skin-body">
                        <b>{a.nick}</b>
                        <span style={{ fontSize: '11.5px', color: 'var(--m-fg-subtle)' }}>
                          {accKindLabel(a.kind) + (a.id === activeId ? ' · активный' : '')}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div id="skTabCapes" style={{ display: tab === 'capes' ? '' : 'none' }}>
            <div className="side-cap" style={{ padding: '0 2px 10px' }}>
              Выбери плащ
            </div>
            <div className="cape-cards">
              <button
                className={'cape-card' + (cape === 'none' ? ' on' : '')}
                onClick={() => {
                  chooseCape('none')
                  showToast('Плащ снят')
                }}
              >
                <span className="cape-render empty">нет</span>
                <b>Без плаща</b>
              </button>
              {capes.map((c) => {
                const my = c.id.startsWith('my:')
                return (
                  <div
                    key={c.id}
                    className={
                      'cape-card' +
                      (c.id === cape ? ' on' : '') +
                      (my ? ' sk-removable' : '') +
                      (c.locked ? ' locked' : '')
                    }
                  >
                    <button
                      className={my ? 'sk-card-hit' : 'cape-hit'}
                      title={c.name + ' · ' + c.sub}
                      onClick={() => pickCapeOption(c)}
                    >
                      <span className="cape-render">
                        <CapePreview url={c.url} h={92} />
                        {c.locked ? (
                          <span className="cape-lock">
                            <Icon id="i-lock" />
                          </span>
                        ) : null}
                      </span>
                      <b>{c.name}</b>
                      <span className="cape-sub">
                        {c.onAccount ? (
                          <span className="cape-ok">
                            <Icon id="i-check" />
                            на аккаунте
                          </span>
                        ) : (
                          c.sub
                        )}
                      </span>
                      {c.locked && c.progress !== undefined ? (
                        <span className="cape-prog" title={c.progressLabel || ''}>
                          <span className="cape-prog-bar" style={{ width: c.progress + '%' }}></span>
                        </span>
                      ) : null}
                      {c.locked && c.progressLabel ? <span className="cape-prog-txt">{c.progressLabel}</span> : null}
                    </button>
                    {my ? (
                      <button className="sk-del" title="Удалить" onClick={() => removeMyCape(Number(c.id.slice(3)))}>
                        <Icon id="i-trash" />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <p className="faint-note">
              Свои плащи загрузить нельзя: плащ выдаётся вместе с лицензией Mojang или открывается в каталоге Millida.
              Загруженные раньше плащи остались в списке и работают как прежде.
            </p>
          </div>

          {tab === 'rewards' ? (
            <div id="skTabRewards">
              <div className="side-cap" style={{ padding: '0 2px 10px' }}>
                Плащи за задания
              </div>
              {hasMillidaAccount() ? (
                <>
                  <p className="faint-note" style={{ marginBottom: '12px' }}>
                    Выполняй задания в лаунчере — забирай плащи. Каждый попадает в каталог аккаунта и надевается на
                    вкладке «Плащи».
                  </p>
                  <div className="cape-cards">
                    {rewards.map((r) => (
                      <div key={r.code} className={'cape-card' + (r.claimed ? ' on' : '')}>
                        {r.capeUrl ? (
                          <span className="cape-render">
                            <CapePreview url={r.capeUrl} h={92} />
                          </span>
                        ) : (
                          <span className="cape-render empty">
                            <Icon id="i-trophy" />
                          </span>
                        )}
                        <b>{r.title}</b>
                        <span className="cape-sub">{r.task}</span>
                        <span className="cape-sub" style={{ opacity: 0.75 }}>
                          {r.claimed ? 'Получен' : rewardProgress(r)}
                        </span>
                        {r.claimed ? null : (
                          <button
                            className={'btn sm' + (r.done ? ' primary' : '')}
                            style={{ width: '100%', marginTop: '6px' }}
                            disabled={!r.done || claiming === r.code}
                            title={r.done ? 'Забрать плащ' : r.hint}
                            onClick={() => void takeReward(r)}
                          >
                            {claiming === r.code ? 'Выдаём…' : r.done ? 'Забрать' : 'Не выполнено'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {rewards.length ? null : <p className="faint-note">Список наград загружается…</p>}
                </>
              ) : (
                <p className="faint-note">
                  Войди в Millida — награды за задания выдаются на аккаунт, чтобы плащ был на любом компьютере.
                </p>
              )}
            </div>
          ) : null}

        </div>
      </div>
      {diagOpen ? (
        <SkinDiag nick={gameNick.name || nick} online={hasMillidaAccount()} onClose={() => setDiagOpen(false)} />
      ) : null}
    </section>
  )
}
