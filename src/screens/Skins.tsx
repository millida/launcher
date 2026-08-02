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
  msSetCape,
  msUploadSkin,
  pickTexture,
  saveTexture,
  setLocalSkin,
  setTextureSlim,
} from '../ipc/commands'
import type { MsCape, TextureEntry, TextureKind } from '../ipc/commands'
import { loadSkinview } from '../lib/skinview'
import {
  addToWardrobe,
  applyWardrobeItem,
  loadWardrobe,
  removeWardrobeItem,
  setSkinSource,
  skinSource,
  uploadTexture,
} from '../lib/gameProfile'
import type { WardrobeItem } from '../lib/gameProfile'
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
const hashOf = (url: string | null | undefined) => {
  const m = /texture\/([0-9a-f]{40,})/i.exec(url || '')
  return m ? m[1] : ''
}
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

const skinUrl = (n: string) => 'https://mc-heads.net/skin/' + encodeURIComponent(n)

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('img'))
    i.src = url
  })
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

function SkinThumb({ url, size = 132, slim }: { url: string; size?: number; slim?: boolean }) {
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

function CatalogThumb({ nick, url }: { nick?: string; url?: string }) {
  const [failed, setFailed] = useState(false)
  const texture = url || skinUrl(nick || 'MHF_Steve')
  if (url || failed) return <SkinThumb url={texture} />
  return (
    <img
      className="skin-body3d"
      src={'https://mc-heads.net/body/' + encodeURIComponent(nick || 'MHF_Steve') + '/128'}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

interface AccTexture {
  skin: string
  cape: string | null
  slim: boolean
}

const texCache = new Map<string, { at: number; tex: AccTexture }>()
const TEX_TTL = 300000

async function loadAccountTexture(a: Account): Promise<AccTexture> {
  const key = a.uuid || a.nick
  const hit = texCache.get(key)
  if (hit && Date.now() - hit.at < TEX_TTL) return hit.tex
  if (hasTauri()) {
    try {
      const t = await mcTextures(key)
      const tex = { skin: t.skin || skinUrl(a.nick), cape: t.cape, slim: !!t.slim }
      texCache.set(key, { at: Date.now(), tex })
      return tex
    } catch {}
  }
  return { skin: skinUrl(a.nick), cape: null, slim: false }
}

/// Offline and Microsoft accounts keep the skin locally; mc-heads only knows Mojang uploads.
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

/// mc-heads and textures.minecraft.net are CORS-restricted, so re-encode through canvas.
async function toPngBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url.replace(/^data:image\/png;base64,/, '')
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
function CapePreview({ url, h = 64 }: { url: string; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const g = cv.getContext('2d')
      if (!g) return
      const s = img.width / 64
      cv.width = 10
      cv.height = 16
      g.imageSmoothingEnabled = false
      try {
        g.clearRect(0, 0, 10, 16)
        g.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, 10, 16)
      } catch {}
    }
    img.src = url
  }, [url])
  return (
    <canvas
      ref={ref}
      style={{ width: (h * 10) / 16 + 'px', height: h + 'px', imageRendering: 'pixelated', display: 'block', borderRadius: '4px' }}
    />
  )
}

const EMOTE_SEQ = ['look', 'wave', 'flex', 'shy', 'time']
type Cur = { hx: number; hy: number; hz: number; rx: number; rz: number; lx: number; lz: number; by: number }

function applyPose(skin: any, t: number, cur: Cur) {
  const name = EMOTE_SEQ[Math.floor(t / 3.6) % EMOTE_SEQ.length]
  const tgt: Cur = { hx: 0, hy: 0, hz: 0, rx: 0, rz: 0, lx: 0, lz: 0, by: 0 }
  // Past ~100 degrees the arm leaves the shoulder socket and looks detached.
  if (name === 'look') {
    tgt.hy = 0.5 * Math.sin(t * 0.7)
    tgt.hx = 0.13 * Math.sin(t * 0.45)
  } else if (name === 'wave') {
    tgt.rz = -2.5
    tgt.rx = 0.22 * Math.sin(t * 7)
    tgt.hz = -0.06
  } else if (name === 'flex') {
    tgt.rz = -2.5
    tgt.lz = 2.5
    tgt.rx = -0.12
    tgt.lx = -0.12
    tgt.hx = -0.1
  } else if (name === 'shy') {
    tgt.hx = 0.42
    tgt.hy = 0.28
    tgt.rx = -0.45
    tgt.lx = -0.45
    tgt.by = 0.16
  } else if (name === 'time') {
    tgt.rx = -1.6
    tgt.rz = 0.22
    tgt.hx = 0.32
    tgt.hy = -0.16
  }
  const k = 0.09
  cur.hx += (tgt.hx - cur.hx) * k
  cur.hy += (tgt.hy - cur.hy) * k
  cur.hz += (tgt.hz - cur.hz) * k
  cur.rx += (tgt.rx - cur.rx) * k
  cur.rz += (tgt.rz - cur.rz) * k
  cur.lx += (tgt.lx - cur.lx) * k
  cur.lz += (tgt.lz - cur.lz) * k
  cur.by += (tgt.by - cur.by) * k
  const sway = 0.05 * Math.sin(t * 1.4)
  try {
    skin.head.rotation.set(cur.hx, cur.hy, cur.hz)
    skin.rightArm.rotation.set(cur.rx + sway, 0, cur.rz)
    skin.leftArm.rotation.set(cur.lx - sway, 0, cur.lz)
    skin.body.rotation.set(0, cur.by, 0)
  } catch {}
}

function newCur(): Cur {
  return { hx: 0, hy: 0, hz: 0, rx: 0, rz: 0, lx: 0, lz: 0, by: 0 }
}

function resetBones(viewer: any) {
  try {
    const s = viewer.playerObject.skin
    ;['head', 'rightArm', 'leftArm', 'body', 'rightLeg', 'leftLeg'].forEach((b) => s[b].rotation.set(0, 0, 0))
  } catch {}
}

export function Skins({ on }: { on: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<any>(null)
  const accounts = useAccounts((s) => s.list)
  const activeId = useAccounts((s) => s.active)
  const [nick, setNick] = useState(() => (getAccount() || { nick: '' }).nick || 'MHF_Steve')
  const [skinSrc, setSkinSrc] = useState<string | null>(null)
  const [variant, setVariant] = useState('classic')
  const [cape, setCape] = useState('none')
  const [tab, setTab] = useState('my')
  const [catQuery, setCatQuery] = useState('')
  const [fallback, setFallback] = useState(false)
  const [svReady, setSvReady] = useState(false)
  const [mySkins, setMySkins] = useState<MySkin[]>([])
  const [myCapes, setMyCapes] = useState<MySkin[]>([])
  const [textures, setTextures] = useState<Record<string, AccTexture>>({})
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([])
  const [activeWardrobe, setActiveWardrobe] = useState<string | null>(null)
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

  useEffect(() => {
    void refreshWardrobe()
  }, [])

  const gameNick = useGameNick()
  useEffect(() => {
    void refreshGameNick()
  }, [])

  const syncedRef = useRef(false)
  useEffect(() => {
    if (syncedRef.current || !hasMillidaAccount()) return
    if (!mySkins.length && !myCapes.length) return
    syncedRef.current = true
    void (async () => {
      const KEY = 'm-wardrobe-synced'
      let done: string[] = []
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
        done = Array.isArray(raw) ? raw : []
      } catch {}
      const pending = [
        ...mySkins.map((s) => ({ kind: 'skin' as const, item: s, tag: 's:' + s.file })),
        ...myCapes.map((c) => ({ kind: 'cape' as const, item: c, tag: 'c:' + c.file })),
      ].filter((p) => !done.includes(p.tag))
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
  }, [mySkins, myCapes])

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
          licensedHashes.add(hashOf(c.url))
          licensed.push({
            id: 'ms:' + a.id + ':' + c.id,
            name: c.alias || OFFICIAL_CAPES.find((o) => o.hash === hashOf(c.url))?.name || 'Плащ',
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
        .map((a) => ({ nick: a.nick, kind: a.kind, id: a.id, url: textures[a.id].cape as string, hash: hashOf(textures[a.id].cape) }))
      const accHashes = new Set(accCapes.map((c) => c.hash).filter(Boolean))
      const stored: CapeOption[] = wardrobe
        .filter((i) => i.kind === 'cape')
        .map((i) => ({ id: 'w:' + i.id, name: i.name, url: i.url, sub: 'В каталоге Millida', wardrobeId: i.id }))
      const official: CapeOption[] = OFFICIAL_CAPES.filter((c) => !licensedHashes.has(c.hash)).map((c) => ({
        id: c.id,
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
      const design: CapeOption[] = [{ id: 'millida', name: 'Millida', url: MILLIDA_CAPE, sub: 'Плащ лаунчера' }]
      const mine: CapeOption[] = myCapes.map((c, i) => ({ id: 'my:' + i, name: c.name, url: c.data, sub: 'Свой дизайн' }))
      // Millida capes first, Microsoft and Mojang designs after them.
      return design.concat(stored).concat(mine).concat(licensed).concat(acc).concat(official)
    },
    [accounts, textures, myCapes, msCapes, wardrobe],
  )

  useEffect(() => {
    let alive = true
    Promise.all(accounts.map((a) => loadAccountTexture(a).then((t) => [a.id, t] as const))).then((pairs) => {
      if (alive) setTextures(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [accounts])

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
    const h = hashOf(t ? t.cape : null)
    if (!h) return
    const same = capes.find((c) => hashOf(c.url) === h)
    if (same) setCape(same.id)
  }, [capes, textures, activeId])

  const chooseCape = (id: string) => {
    capeTouched.current = true
    setCape(id)
  }

  // Capes are matched by texture hash, but Mojang only accepts the cape id from the profile.
  const capeTarget = (c: CapeOption): { accId: string; msId: string } | null => {
    if (c.accId && c.msId) return { accId: c.accId, msId: c.msId }
    const h = hashOf(c.url)
    if (!h) return null
    for (const a of accounts) {
      const hit = (msCapes[a.id] || []).find((x) => hashOf(x.url) === h)
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

  const ensureViewer = () => {
    const SV = window.skinview3d
    const canvas = canvasRef.current
    if (viewerRef.current || !SV || !canvas) return viewerRef.current
    try {
      viewerRef.current = new SV.SkinViewer({ canvas, width: 260, height: 380 })
      viewerRef.current.zoom = 0.9
      viewerRef.current.fov = 40
      try {
        viewerRef.current.background = null
      } catch {}
      if (viewerRef.current.controls) {
        viewerRef.current.controls.enableZoom = false
        viewerRef.current.controls.enablePan = false
      }
    } catch {
      viewerRef.current = null
    }
    return viewerRef.current
  }

  useEffect(() => {
    if (!on || svReady) return
    let alive = true
    loadSkinview()
      .then(() => {
        if (alive) setSvReady(true)
      })
      .catch(() => {
        if (alive) setFallback(true)
      })
    return () => {
      alive = false
    }
  }, [on, svReady])

  useEffect(() => {
    if (!svReady) return
    const SV = window.skinview3d
    if (!SV || !ensureViewer()) {
      setFallback(true)
      return
    }
    setFallback(false)
    const viewer = viewerRef.current
    viewer.loadSkin(skinSrc || skinUrl(nick), { model: variant === 'slim' ? 'slim' : 'default' }).catch(() => {})
    const c = capes.find((x) => x.id === cape)
    if (!c) {
      try {
        viewer.loadCape(null)
      } catch {}
    } else {
      viewer.loadCape(c.url).catch(() => {})
    }
  }, [nick, skinSrc, variant, cape, capes, svReady])

  // skinview3d runs its own RAF loop and does not know the window is hidden, which kept the GPU busy.
  useEffect(() => {
    if (!svReady || fallback) return
    const setPaused = (v: boolean) => {
      const viewer = viewerRef.current
      if (viewer) {
        try {
          viewer.renderPaused = v
        } catch {}
      }
    }
    const onVis = () => setPaused(document.hidden)
    const onBlur = () => setPaused(true)
    const onFocus = () => setPaused(false)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    setPaused(document.hidden || !document.hasFocus())
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      setPaused(false)
    }
  }, [svReady, fallback])

  // Prefer the bundled PlayerAnimation; fall back to a manual RAF loop when it is missing.
  useEffect(() => {
    if (!svReady || fallback) return
    const viewer = viewerRef.current
    const SV = window.skinview3d
    if (!viewer) return
    if (SV && SV.PlayerAnimation) {
      try {
        const inst: any = new SV.PlayerAnimation()
        inst._cur = newCur()
        inst.animate = function (player: any) {
          applyPose(player.skin, this.progress, this._cur)
        }
        viewer.animation = inst
      } catch {}
      return () => {
        try {
          viewer.animation = null
          resetBones(viewer)
        } catch {}
      }
    }
    let raf = 0
    let alive = true
    const cur = newCur()
    const loop = (ts: number) => {
      if (!alive) return
      raf = requestAnimationFrame(loop)
      if (document.hidden || !document.hasFocus()) return
      try {
        applyPose(viewer.playerObject.skin, ts / 1000, cur)
      } catch {}
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      resetBones(viewer)
    }
  }, [svReady, fallback])

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
      await setLocalSkin('', null, false).catch(() => {})
      if (hasMillidaAccount()) {
        await uploadTexture('skin', null)
        await uploadTexture('cape', null)
        await loadMillidaProfile().catch(() => {})
        await refreshWardrobe()
      }
      const acc = getAccount()
      if (acc && acc.kind === 'microsoft' && hasTauri()) {
        const ms = await ensureMsAuth(acc)
        if (ms) await msSetCape(ms.id, '').catch(() => {})
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
    setSkinSrc(it.url ? it.url : null)
    setActiveMy(null)
    setActiveWardrobe(null)
    autoVariant(texture, it.url ? 's:' + it.url : 'n:' + (it.nick || 'MHF_Steve'))
    showToast('Скин «' + it.label + '» применён')
  }

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
    setApplying(true)
    const texture = skinSrc || skinUrl(nick)
    try {
      const skin = await toPngBase64(texture)
      const capePng = currentCape ? await toPngBase64(currentCape.url) : null
      await setLocalSkin(skin, capePng, variant === 'slim').catch(() => {})
      const acc = getAccount()
      let licensed = false
      try {
        licensed = await applyLicensedCape()
      } catch (e) {
        showToast('Плащ лицензии не переключился: ' + e, 'error')
      }
      if (hasMillidaAccount()) {
        if (skinSource() !== 'millida') setSkinSource('millida')
        const applied = await uploadTexture('skin', skin, variant === 'slim', skinTitle())
        await uploadTexture('cape', capePng, false, currentCape ? currentCape.name : undefined)
        if (acc && acc.kind === 'microsoft' && applied?.skinUrl && hasTauri()) {
          const ms = await ensureMsAuth(acc)
          if (ms) {
            try {
              await msUploadSkin(ms.id, applied.skinUrl, variant === 'slim')
              licensed = true
            } catch (e) {
              showToast('На лицензию скин не уехал: ' + e, 'error')
            }
          }
        }
        await loadMillidaProfile().catch(() => {})
        await refreshHead(texture)
        await refreshWardrobe()
        showToast(
          licensed
            ? 'Скин применён — сохранён в каталоге Millida и на лицензии'
            : 'Скин применён и сохранён в каталоге Millida',
        )
      } else {
        await refreshHead(texture)
        showToast('Скин применён — увидишь его в игре на модовых сборках после запуска')
      }
      track('skin_apply', {
        cape: currentCape ? currentCape.name : 'нет',
        variant,
        account: hasMillidaAccount() ? 'millida' : 'local',
        licensed,
      })
    } catch (e) {
      showToast('Не удалось применить скин: ' + e, 'error')
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
          <div className="skin-stage" id="skinStage">
            <div className="skin-aura" aria-hidden="true"></div>
            <canvas
              id="skinCanvas"
              ref={canvasRef}
              style={{ imageRendering: 'auto', width: '100%', height: '100%', display: use3d ? undefined : 'none' }}
            ></canvas>
            {use3d ? null : fallback ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
                <SkinThumb url={skinSrc || skinUrl(nick)} size={240} slim={variant === 'slim'} />
              </div>
            ) : (
              <span className="skin-loader" aria-label="Загружаем модель"></span>
            )}
          </div>
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
                  <span style={{ fontSize: '11px', color: 'var(--m-fg-faint)' }}>PNG 64×64</span>
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
                      <SkinThumb url={sk.data} slim={sk.slim} />
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
                              <SkinThumb url={item.url} slim={item.model === 'slim'} />
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
                          const worn = capes.find((c) => hashOf(c.url) === hashOf(t.cape))
                          chooseCape(worn ? worn.id : 'acc:' + a.id)
                        }
                        showToast('Скин аккаунта ' + a.nick + ' применён')
                      }}
                    >
                      <span className="skin-thumb">
                        <SkinThumb
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
                  <div key={c.id} className={'cape-card' + (c.id === cape ? ' on' : '') + (my ? ' sk-removable' : '')}>
                    <button
                      className={my ? 'sk-card-hit' : 'cape-hit'}
                      title={c.name + ' · ' + c.sub}
                      onClick={() => pickCapeOption(c)}
                    >
                      <span className="cape-render">
                        <CapePreview url={c.url} h={92} />
                      </span>
                      <b>{c.name}</b>
                      <span className="cape-sub">
                        {c.onAccount ? <span className="cape-ok">✓ на аккаунте</span> : c.sub}
                      </span>
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
          </div>

        </div>
      </div>
    </section>
  )
}
