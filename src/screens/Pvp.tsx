import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Icon } from '../components/Icon'
import { Head } from '../components/Head'
import { api } from '../lib/api'
import { quickJoin } from '../lib/joinServer'
import { plural } from '../lib/format'
import { playSound } from '../lib/sound'
import { showToast } from '../state/ui'
import type { LobbyMode } from '../state/lobbyMode'
import { isLeader, usePartyStore } from '../state/party'
import { usePvp, usePvpQueue } from '../state/pvp'
import { TIER_SERVER, kitIcon, modeTitle, tierLevel, tierRank, useTiers, type TierMatch, type TierMode, type TierModeInfo, type TierPlayer } from '../state/tiers'
import { Row as TierRow, TierBadge, TierBoard, linesOf, tierNick } from '../components/top/TierBoard'
import { useTopBar } from '../state/topbar'
import '../styles/pixel/pvp.css'

/**
 * Раздел PvP — один экран (владелец 12.10.2026: «всё на одном экране, чтобы
 * не переключаться по разделам», «выбор кита и сразу играть»). Слева — киты
 * и кнопка «Играть», под ними свои последние матчи; справа — тир-лист с
 * местами #1, #2, #3 и отдельной строкой «Моё место». Игра стартует сборкой
 * «Millida PvP 26.2», которую лаунчер ставит сам.
 */

/**
 * Цвет кита и риг-арт (рендеры героев сайта). fx — где у рисунка середина
 * персонажа, % ширины: по ней он встаёт в центр карточки, а длинное оружие
 * уходит за край (владелец: «меч за кадром, чтобы перс был в центре»).
 */
const KIT_LOOK: Record<string, { c: string; rig: string; fx?: number }> = {
  vanilla: { c: '#6b3fb8', rig: 'vanilla' },
  sword: { c: '#2b63c4', rig: 'sword', fx: 33 },
  pot: { c: '#b8324a', rig: 'pot' },
  nethop: { c: '#4b3a55', rig: 'nethop', fx: 56 },
  uhc: { c: '#b8901f', rig: 'uhc' },
  smp: { c: '#3a7a4b', rig: 'smp', fx: 46 },
  axe: { c: '#7a4a2a', rig: 'axe', fx: 57 },
  mace: { c: '#565c69', rig: 'mace', fx: 47 },
  op: { c: '#b4472c', rig: 'op' },
  diasmp: { c: '#1f9bb5', rig: 'diasmp' },
  spear: { c: '#8a6a2a', rig: 'spear', fx: 44 },
  cart: { c: '#9e3a2a', rig: 'cart' },
  bow: { c: '#5f8722', rig: 'bow', fx: 40 },
  sumo: { c: '#2f9c55', rig: 'sumo', fx: 46 },
}
const look = (kit: string) => KIT_LOOK[kit] ?? { c: '#4a5560', rig: 'sword' }
const rigUrl = (kit: string) => '/mode-art/kit-rigs/' + look(kit).rig + '.webp'

const avatarUrl = (nick: string) => 'https://api.millida.net/v2/heads/avatar/' + encodeURIComponent(nick || 'Steve') + '?size=64&safe=1'

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (m < 1) return 'сейчас'
  if (m < 60) return m + ' мин'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' ч'
  return Math.round(h / 24) + ' дн'
}

export function Pvp({ on }: { on: boolean }) {
  const nick = tierNick()
  const view = usePvp((s) => s.view)

  useEffect(() => {
    if (!on) return
    const t = useTiers.getState()
    void t.load(nick)
    void t.loadLive()
    if (nick) void t.loadMatches(nick, true)
    const id = window.setInterval(() => void useTiers.getState().loadLive(), 30_000)
    return () => window.clearInterval(id)
  }, [on, nick])

  // Подстраница — «← Назад» в верхней строке вместо «← Лобби»; каждая открывается сверху.
  useEffect(() => {
    document.querySelector('.content')?.scrollTo({ top: 0 })
    if (!on || view === 'home') return
    useTopBar.getState().setBack(() => usePvp.getState().setView('home'))
    return () => useTopBar.getState().setBack(null)
  }, [on, view])

  if (view === 'tiers')
    return (
      <div className="pv-page" data-section="pvp_tiers">
        <h1 className="pv-page-title">Тир-лист</h1>
        <TierBoard on={on} />
      </div>
    )
  if (view === 'matches')
    return (
      <div className="pv-page" data-section="pvp_matches">
        <h1 className="pv-page-title">Мои матчи</h1>
        <MyMatches nick={nick} all />
      </div>
    )

  return (
    <div className="pv" data-section="pvp">
      <PvpPlay on={on} />
      <MyPlace />
      <TopTen />
      <MyMatches nick={nick} />
    </div>
  )
}

/* ---------------- Играть: кит и кнопка ---------------- */

/** Где игрок на сервере (/v2/tiers/state): очередь, бой, итог матча. */
interface ArenaState {
  state: string
  kit?: string
  since?: number
  mode?: string
  win?: boolean | null
  score?: string
  delta?: number | null
  opponent?: { name?: string; tier?: string }
}

function useArenaState(uuid: string | null): ArenaState | null {
  const [st, setSt] = useState<ArenaState | null>(null)
  useEffect(() => {
    if (!uuid) return
    let alive = true
    let busy = false
    const tick = () => {
      // Прошлый ответ ещё не пришёл — не копим запросы на медленном сервере.
      if (document.hidden || busy) return
      busy = true
      api<ArenaState>('/tiers/state/' + encodeURIComponent(uuid))
        .then((r) => alive && setSt(r && typeof r.state === 'string' ? { ...r, since: typeof r.since === 'number' ? Date.now() - r.since : undefined } : null))
        .catch(() => alive && setSt(null))
        .finally(() => {
          busy = false
        })
    }
    tick()
    const id = window.setInterval(tick, 2500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [uuid])
  return st
}

function PvpPlay({ on }: { on: boolean }) {
  const nick = tierNick()
  const me = useTiers((s) => (s.nick === nick ? s.me : undefined))
  const modes = useTiers((s) => s.modes)
  const kit = usePvp((s) => s.kit)
  const setKit = usePvp((s) => s.setKit)
  const [busy, setBusy] = useState(false)
  const [launchAt, setLaunchAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const st = useArenaState(on ? me?.uuid ?? null : null)
  const q = usePvpQueue()

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const kits: TierModeInfo[] = modes.length ? modes : Object.keys(KIT_LOOK).map((slug) => ({ slug, title: slug.toUpperCase(), first_to: 1 }))

  const party = usePartyStore((p) => p.party)
  const partyMe = usePartyStore((p) => p.me)
  // 2 на 2 — пати ровно из двух, жмёт лидер (сервер проверяет то же самое).
  const duo = !!party && party.members.length === 2 && isLeader(party, partyMe)

  /**
   * Очередь из лаунчера: игра стартует, когда соперник найден. Сервер её ещё
   * не умеет — заявка в очередь кита и сразу вход на сервер.
   */
  const play = async (k: string = kit) => {
    setBusy(true)
    try {
      if (me?.uuid) {
        const res = await usePvpQueue.getState().start({ kit: k, ranked: true, uuid: me.uuid })
        if (res === 'queued') return
        if (res === 'error') {
          showToast('Очередь не ответила — попробуй ещё раз', 'error')
          return
        }
      }
      const intent = api('/tiers/intent', { method: 'POST', body: JSON.stringify({ kit: k, ranked: true }) }).catch(() => {})
      await Promise.race([intent, new Promise((r) => setTimeout(r, 3000))])
      setLaunchAt(Date.now())
      await quickJoin(TIER_SERVER.ip, TIER_SERVER.name, false, TIER_SERVER.versions).catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  /** 2 на 2 из пати лаунчера: заявка на обоих, затем обычный запуск пати на сервер. */
  const playDuo = async () => {
    if (!party) return
    setBusy(true)
    try {
      await api('/tiers/intent', { method: 'POST', body: JSON.stringify({ kit, ranked: true, party: party.members.map((m) => m.userId) }) })
    } catch (e) {
      const msg = String(e)
      showToast(/403/.test(msg) ? 'Позвать в 2 на 2 может только лидер пати' : /404/.test(msg) ? 'У напарника ещё нет игрового профиля Millida' : 'Сервер не принял заявку 2 на 2 — попробуй ещё раз', 'error')
      setBusy(false)
      return
    }
    const mode: LobbyMode = { kind: 'server', slug: 'millida-smp', name: TIER_SERVER.name, ip: TIER_SERVER.ip, logo: null, banner: null, versions: TIER_SERVER.versions, licensed: false }
    setLaunchAt(Date.now())
    const { partyPlayPressed } = await import('../lib/partyPlay')
    await partyPlayPressed(mode).catch(() => {})
    setBusy(false)
  }

  const queued = q.phase === 'queued' || st?.state === 'queue' || st?.state === 'party' || st?.state === 'queued'
  const found = q.phase === 'matched' || q.phase === 'joining'
  const fighting = st?.state === 'match' || st?.state === 'bot'
  const launching = !queued && !fighting && launchAt > 0 && now - launchAt < 90_000 && (!st || st.state === 'offline')
  const result = st?.state === 'result' ? st : null
  const queueSince = q.phase === 'queued' ? q.since : st?.since ?? 0
  const title = modeTitle(modes, kit)

  return (
    <section className="pv-play" style={{ '--kc': look(kit).c } as CSSProperties}>
      <KitCarousel kits={kits} kit={kit} me={me ?? null} onPick={setKit} onPlay={(k) => void play(k)} />

      {found && q.opponent ? <MatchFound q={q} now={now} modes={modes} /> : null}

      <div className="pv-go-row">
        {result ? <ResultLine r={result} modes={modes} /> : null}
        {q.phase === 'queued' ? (
          <button className="btn lg secondary pv-go is-queue" data-sound="close" data-track="pvp_queue_cancel" data-id={q.kit} onClick={() => void q.cancel()}>
            <span>
              Поиск соперника · {clock(now - q.since)}
              <em>
                {modeTitle(modes, q.kit)}
                {q.waiting ? ' · ' + q.waiting + ' в очереди' : ''} · нажми, чтобы отменить
              </em>
            </span>
          </button>
        ) : (
          <button
            className={'btn lg primary pv-go' + (queued ? ' is-queue' : fighting ? ' is-fight' : '')}
            data-sound="open"
            data-track={result ? 'pvp_requeue' : 'pvp_play'}
            data-id={kit}
            disabled={busy || queued || fighting || found || launching}
            onClick={() => void play()}
          >
            <Icon id={queued || found || launching ? 'i-clock' : 'i-play'} />
            <span>
              {found ? 'Соперник найден' : queued ? 'В очереди' : fighting ? 'Идёт бой' : launching ? 'Запускаем игру' : result ? 'Ещё раз' : 'Играть'}
              <em>{queued && queueSince ? title + ' · ' + clock(now - queueSince) : title}</em>
            </span>
          </button>
        )}
        {!queued && !fighting && !found && q.phase !== 'queued' ? (
          <button className="btn lg secondary pv-roll" data-nosound data-track="pvp_kit_random" aria-label="Случайный кит" disabled={busy || launching} onClick={() => usePvp.getState().roll()}>
            <DicePx />
            Случайный
          </button>
        ) : null}
        {duo && !queued && !fighting ? (
          <button className="btn lg secondary pv-duo" data-sound="open" data-track="pvp_play_2v2" data-id={kit} disabled={busy || found} onClick={() => void playDuo()}>
            <Icon id="i-users" />2 на 2
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Карусель китов — «обложки на кольце» (владелец 12.10.2026: «совмести первый
 * вариант и седьмой… и удиви»). Спереди — веер обложек лицом к центру, дальше
 * карточки уходят по кольцу и видны дальней дугой над веером. Выбранный кит
 * выезжает вперёд, а его фигура выходит из рамки карточки. «Случайный»
 * раскручивает кольцо, как колесо, и останавливает на случайном ките.
 *
 * Листается бесконечно: позиция (дробный номер кита) плавно догоняет цель, а
 * каждая карточка ставится по расстоянию до неё с переносом через край.
 * Свайп тачпада, перетаскивание, стрелки, клик по карточке и клавиши; колесо
 * мыши листает страницу, а не ленту.
 */
const STEP = 150 // сколько px перетаскивания — один кит
const EASE = 0.2 // доля оставшегося пути за кадр
const SPIN_MS = 2600 // сколько крутится «Случайный»
const CAM = 1500 // расстояние до «камеры», px
const TILT_SIN = Math.sin((9 * Math.PI) / 180) // кольцо наклонено к зрителю на 9°
const TILT_COS = Math.cos((9 * Math.PI) / 180)
const FACE_HALF = 94 // половина внутренней ширины рамки карточки, px
const RIG_H = 214 // высота фигуры в карточке, px

/**
 * Доля полукруга, которую карточка прошла к дальней стороне кольца (0 — центр,
 * 1 — напротив). Спереди шаги мелкие — обложки стоят веером внахлёст; к дальней
 * стороне шаги крупные — задняя дуга читается тремя-четырьмя карточками.
 */
const RING_P: [number, number][] = [[0, 26], [0.14, 13], [0.36, 12], [0.5, 16], [0.64, 30], [0.79, 42], [1, 50]]
const ringShare = (() => {
  const N = 96
  const density = (t: number) => {
    for (let j = 1; j < RING_P.length; j++) {
      const [t0, v0] = RING_P[j - 1]!
      const [t1, v1] = RING_P[j]!
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
    }
    return 50
  }
  const acc = [0]
  for (let j = 1; j <= N; j++) acc.push(acc[j - 1]! + density((j - 0.5) / N))
  return (u: number) => {
    const x = Math.max(0, Math.min(1, u)) * N
    const j = Math.min(N - 1, Math.floor(x))
    return (acc[j]! + (acc[j + 1]! - acc[j]!) * (x - j)) / acc[N]!
  }
})()
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Фон сцены — пиксельная мозаика в цвет кита (владелец 12.10.2026: «предметы на фоне —
 * отстой, хотя бы пикселизируй фон»). Крошечный холст «клетка = пиксель», растянутый без
 * сглаживания: ступенчатое пятно света за выбранной карточкой, лучи от него и лёгкий разнобой
 * клеток. При смене кита цвет расходится от центра волной — один раз, не «для живости».
 */
const CELL = 24 // сторона клетки мозаики, px
const WAVE_MS = 300 // за сколько волна доходит до края
const FADE_MS = 190 // за сколько перекрашивается одна клетка
const DARK = [11, 13, 16] as const
const cellNoise = (x: number, y: number, k: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453
  return v - Math.floor(v)
}
interface Mosaic {
  cols: number
  rows: number
  /** Яркость клетки 0…1 и задержка её перекраски в волне, мс. */
  lum: Float32Array
  delay: Float32Array
  from: Float32Array
  to: [number, number, number]
  t0: number
  raf: number
  color: string
}
function buildMosaic(cols: number, rows: number): Mosaic {
  const lum = new Float32Array(cols * rows)
  const delay = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const nx = (x + 0.5) / cols - 0.5
      const ny = (y + 0.5) / rows - 0.66
      const d = Math.min(1, Math.hypot(nx / 0.6, ny / 0.8))
      const band = Math.round((1 - d) * 6) / 6
      const ray = Math.floor(((Math.atan2(ny, nx * (cols / rows)) + Math.PI) / (2 * Math.PI)) * 30) % 2 ? 0.075 : 0
      lum[y * cols + x] = Math.max(0.18, Math.min(0.96, 0.3 + 0.5 * band + ray + (cellNoise(x, y, 1) - 0.5) * 0.11))
      delay[y * cols + x] = d * WAVE_MS + cellNoise(x, y, 2) * 110
    }
  return { cols, rows, lum, delay, from: new Float32Array(cols * rows * 3), to: [43, 99, 196], t0: 0, raf: 0, color: '' }
}
const hexRgb = (c: string): [number, number, number] => {
  const n = parseInt(c.replace('#', ''), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** Перекрасить мозаику в цвет: волной от центра или сразу (первый кадр, «меньше движения»). */
function paintMosaic(cv: HTMLCanvasElement, m: Mosaic, color: string, instant: boolean) {
  const g = cv.getContext('2d')
  if (!g) return
  const { cols, rows, lum, delay } = m
  const n = cols * rows
  const now = performance.now()
  const img = g.createImageData(cols, rows)
  const px = img.data
  // Откуда красим: то, что на экране сейчас (волна могла не дойти до конца).
  const shown = (i: number, ch: number, t: number) => {
    const k = Math.max(0, Math.min(1, (t - delay[i]!) / FADE_MS))
    const target = DARK[ch]! + (m.to[ch]! - DARK[ch]!) * lum[i]!
    return m.from[i * 3 + ch]! + (target - m.from[i * 3 + ch]!) * k
  }
  const age = m.t0 ? now - m.t0 : Infinity
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) m.from[i * 3 + ch] = m.color ? shown(i, ch, age) : DARK[ch]!
  m.to = hexRgb(color)
  m.color = color
  m.t0 = instant ? now - WAVE_MS - FADE_MS - 200 : now
  cancelAnimationFrame(m.raf)
  const frame = () => {
    const t = performance.now() - m.t0
    for (let i = 0; i < n; i++) {
      px[i * 4] = shown(i, 0, t)
      px[i * 4 + 1] = shown(i, 1, t)
      px[i * 4 + 2] = shown(i, 2, t)
      px[i * 4 + 3] = 255
    }
    g.putImageData(img, 0, 0)
    m.raf = t < WAVE_MS + FADE_MS + 130 ? requestAnimationFrame(frame) : 0
  }
  frame()
}

/** Кубик пикселями — своего значка в спрайте нет. */
function DicePx() {
  return (
    <svg className="icon" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M1 0h8v1h1v8H9v1H1V9H0V1h1zM2 2v2h2V2zM6 2v2h2V2zM4 4v2h2V4zM2 6v2h2V6zM6 6v2h2V6z" />
    </svg>
  )
}

function KitCarousel({
  kits,
  kit,
  me,
  onPick,
  onPlay,
}: {
  kits: TierModeInfo[]
  kit: string
  me: TierPlayer | null
  onPick: (k: string) => void
  onPlay: (k: string) => void
}) {
  const n = kits.length
  const track = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const sparks = useRef<HTMLSpanElement>(null)
  const back = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const mosaic = useRef<Mosaic | null>(null)
  /** Кит под указателем прямо сейчас: по нему красится сцена, не дожидаясь остановки ленты. */
  const live = useRef(-1)
  /** Сколько фигуры срезает рамка слева и справа, пока карточка не в центре (по ширине картинки). */
  const clips = useRef<[number, number][]>([])
  /** Насколько фигура вырастает в центре: широкие (вагонетка, зелье) растут меньше, чтобы не закрыть соседей. */
  const pops = useRef<number[]>([])
  const spin = useRef<{ from: number; dist: number; t0: number } | null>(null)
  const lastNear = useRef(0)
  const lastTick = useRef(0)
  const rollSeq = usePvp((p) => p.rollSeq)
  const pos = useRef(Math.max(0, kits.findIndex((k) => k.slug === kit)))
  const target = useRef(pos.current)
  const raf = useRef(0)
  const snap = useRef(0)
  const drag = useRef<{ x: number; pos: number; moved: boolean; lastX: number; lastT: number; v: number } | null>(null)
  const kitsRef = useRef(kits)
  kitsRef.current = kits
  /** Точка опоры фигуры по горизонтали (%) у каждого кита — чтобы кадр не читал CSS-переменные. */
  const looks = useRef<number[]>([])
  looks.current = kits.map((k) => look(k.slug).fx ?? 50)
  const kitRef = useRef(kit)
  kitRef.current = kit
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  const mod = (a: number) => ((a % n) + n) % n
  /** Кратчайшее смещение карточки i от позиции p с переносом через край: (−n/2, n/2]. */
  const offset = (i: number, p: number) => {
    let d = (i - p) % n
    if (d > n / 2) d -= n
    if (d <= -n / 2) d += n
    return d
  }

  const layout = () => {
    const el = ring.current
    const box = track.current
    if (!el || !box || !n) return
    const R = Math.max(340, Math.min(520, box.clientWidth * 0.42))
    const H = n / 2
    // Точка схода выше центра кольца: дальняя дуга поднимается над веером.
    const oy = -box.clientHeight * 0.31
    const list = el.children as HTMLCollectionOf<HTMLElement>
    for (let i = 0; i < list.length; i++) {
      const card = list[i]!
      const d = offset(i, pos.current)
      const ad = Math.abs(d)
      const sg = d < 0 ? -1 : 1
      const near = Math.max(0, 1 - ad)
      const th = sg * 180 * ringShare(ad / H)
      const rad = (th * Math.PI) / 180
      // Спереди — обложки лицом к центру; у дальней стороны карточка доворачивается лицом внутрь кольца.
      const w = smooth(70, 110, Math.abs(th))
      const yaw = (1 - w) * -sg * 56 * Math.min(ad, 1) + w * (th - sg * 180)
      const zr = R * Math.cos(rad) - R
      // Проекцию считаем сами (наклон кольца, перспектива, порядок по глубине), а не общей 3D-сценой
      // браузера: там, где у вебвью нет ускоренной композиции (часть Linux), 3D-сцена схлопывается и
      // дальняя карточка ложится поверх выбранной. Так порядок и размеры верны везде, а без
      // ускорения теряется только «трапеция» поворота.
      const z3 = zr + near * 96
      const zT = z3 * TILT_COS
      const k = CAM / (CAM - zT)
      const tf =
        'translate3d(' + (R * Math.sin(rad) * k).toFixed(1) + 'px,' + (oy + (z3 * TILT_SIN - oy) * k).toFixed(1) + 'px,0) scale(' + (k * (1 + near * 0.14)).toFixed(4) + ') perspective(1100px) rotateY(' + yaw.toFixed(2) + 'deg)'
      if (card.style.transform !== tf) card.style.transform = tf
      const zi = String(2000 + Math.round(zT))
      if (card.style.zIndex !== zi) card.style.zIndex = zi
      // Затемнение — прозрачностью тёмных слоёв поверх фона и ленты. Не фильтром и не CSS-переменной
      // на карточке: фильтр дёргает кадры, а переменная заставляет перекрашивать рамку каждый кадр.
      const dim = Math.min(0.74, 0.16 * Math.min(ad, 1) - zr / 1250).toFixed(3)
      const kids = card.children
      const rig = kids[1] as HTMLElement | undefined
      const shadeA = kids[0]?.lastElementChild as HTMLElement | null
      const shadeB = kids[2]?.lastElementChild as HTMLElement | null
      const tag = kids[3] as HTMLElement | undefined
      if (shadeA && shadeA.style.opacity !== dim) shadeA.style.opacity = dim
      if (shadeB && shadeB.style.opacity !== dim) shadeB.style.opacity = dim
      const tg = Math.max(0, Math.min(1, 1.6 - ad * 0.5)).toFixed(2)
      if (tag && tag.style.opacity !== tg) tag.style.opacity = tg
      if (!rig) continue
      const c = clips.current[i] || [0, 0]
      const open = near * 90
      const rt = 'translateX(-' + (looks.current[i] ?? 50) + '%) scale(' + (1 + near * (pops.current[i] ?? 0.3)).toFixed(3) + ')'
      if (rig.style.transform !== rt) rig.style.transform = rt
      const clip = near > 0.995 ? 'none' : 'inset(' + (-open).toFixed(1) + 'px ' + (c[1] * (1 - near) - open).toFixed(1) + 'px 0 ' + (c[0] * (1 - near) - open).toFixed(1) + 'px)'
      if (rig.style.clipPath !== clip) rig.style.clipPath = clip
      const ro = (1 - Number(dim) * 0.85).toFixed(3)
      if (rig.style.opacity !== ro) rig.style.opacity = ro
    }
    // Сцена в цвет кита (владелец 12.10.2026: «чтобы менялся цвет фона и что-нибудь сзади, когда
    // меняется кит»): подложка, подиум и большой значок кита за кольцом.
    // Красим на подлёте к цели, а не на каждом пролетающем ките: перекраска большой подложки
    // двадцать раз в секунду роняла кадры во время «Случайного».
    const now = mod(Math.round(pos.current))
    const calm = live.current < 0 || Math.abs(target.current - pos.current) < 1.2
    if (calm && now !== live.current) {
      live.current = now
      const k = kitsRef.current[now]
      if (k) {
        const color = look(k.slug).c
        back.current?.style.setProperty('--kl', color)
        const cv = canvas.current
        if (cv) {
          const cols = Math.max(8, Math.round(box.clientWidth / CELL))
          const rows = Math.max(4, Math.round(box.clientHeight / CELL))
          let m = mosaic.current
          const fresh = !m || m.cols !== cols || m.rows !== rows
          if (fresh) {
            if (m) cancelAnimationFrame(m.raf)
            cv.width = cols
            cv.height = rows
            m = mosaic.current = buildMosaic(cols, rows)
          }
          paintMosaic(cv, m!, color, fresh || matchMedia('(prefers-reduced-motion: reduce)').matches)
        }
      }
    }
  }

  /** Карточка встала на место — искры в цвет кита; один раз, не «для живости». */
  const burst = (color: string) => {
    const box = sparks.current
    if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    box.textContent = ''
    for (let j = 0; j < 14; j++) {
      const a = -Math.PI * (0.12 + 0.76 * (j / 13))
      const r0 = 96 + Math.random() * 20
      const r1 = r0 + 70 + Math.random() * 80
      const e = document.createElement('i')
      e.style.setProperty('--c', j % 3 ? color : '#fff')
      e.style.setProperty('--x0', (Math.cos(a) * r0 * 1.15).toFixed(0) + 'px')
      e.style.setProperty('--y0', (Math.sin(a) * r0 * 1.5 - 30).toFixed(0) + 'px')
      e.style.setProperty('--x1', (Math.cos(a) * r1 * 1.15).toFixed(0) + 'px')
      e.style.setProperty('--y1', (Math.sin(a) * r1 * 1.5 - 40).toFixed(0) + 'px')
      box.append(e)
    }
  }

  const settle = () => {
    const k = kitsRef.current[mod(Math.round(pos.current))]
    if (k && k.slug !== kitRef.current) {
      burst(look(k.slug).c)
      pickRef.current(k.slug)
    }
  }
  const tick = () => {
    const sp = spin.current
    if (sp) {
      const t = Math.min(1, (performance.now() - sp.t0) / SPIN_MS)
      pos.current = sp.from + sp.dist * (1 - Math.pow(1 - t, 3))
      if (t >= 1) {
        pos.current = target.current
        spin.current = null
      }
      // Щелчок храповика: слышно, как киты проходят под указателем.
      const near = Math.round(pos.current)
      const now = performance.now()
      if (near !== lastNear.current && now - lastTick.current > 55) {
        lastTick.current = now
        playSound('click')
      }
      lastNear.current = near
      layout()
      raf.current = requestAnimationFrame(tick)
      return
    }
    const diff = target.current - pos.current
    if (Math.abs(diff) < 0.002) {
      pos.current = target.current
      layout()
      raf.current = 0
      if (!drag.current) {
        // Числа не должны расти без конца: после остановки сворачиваем в [0, n).
        pos.current = target.current = mod(pos.current)
        settle()
      }
      return
    }
    pos.current += diff * EASE
    layout()
    raf.current = requestAnimationFrame(tick)
  }
  const run = () => {
    if (!raf.current) raf.current = requestAnimationFrame(tick)
  }
  const go = (to: number) => {
    spin.current = null
    target.current = to
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pos.current = to
    run()
  }
  const step = (d: number) => go(Math.round(target.current) + d)
  /** «Случайный»: полтора-два оборота кольца и плавная остановка. */
  const roll = () => {
    if (n < 2 || drag.current) return
    const to = Math.round(pos.current) + n + 3 + Math.floor(Math.random() * n)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return go(to)
    target.current = to
    lastNear.current = Math.round(pos.current)
    spin.current = { from: pos.current, dist: to - pos.current, t0: performance.now() }
    run()
  }
  const rollRef = useRef(roll)
  rollRef.current = roll
  const firstRoll = useRef(rollSeq)
  useEffect(() => {
    if (rollSeq !== firstRoll.current) rollRef.current()
  }, [rollSeq])

  // Старт, смена размера и смена кита снаружи (не нашей прокруткой).
  useEffect(() => {
    if (!n) return
    const want = kits.findIndex((k) => k.slug === kit)
    if (want >= 0 && mod(Math.round(target.current)) !== want) go(pos.current + offset(want, pos.current))
    else layout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, n])

  useEffect(() => {
    const el = track.current
    if (!el) return
    // Свайп тачпада по горизонтали ведёт ленту за пальцем; после паузы — к ближайшей карточке.
    const onWheel = (e: WheelEvent) => {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return
      e.preventDefault()
      spin.current = null
      target.current += dx / STEP
      pos.current = target.current
      layout()
      window.clearTimeout(snap.current)
      snap.current = window.setTimeout(() => go(Math.round(target.current)), 110)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    const onResize = () => {
      live.current = -1
      layout()
    }
    window.addEventListener('resize', onResize)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf.current)
      raf.current = 0
      window.clearTimeout(snap.current)
      if (mosaic.current) cancelAnimationFrame(mosaic.current.raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'Enter') onPlay(kit)
    else return
    e.preventDefault()
  }

  // Перетаскивание: лента едет за курсором, отпустил — докатывается по инерции до карточки.
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    cancelAnimationFrame(raf.current)
    raf.current = 0
    if (spin.current) {
      // Поймали колесо рукой: дальше оно едет от того места, где остановили.
      spin.current = null
      target.current = pos.current
    }
    drag.current = { x: e.clientX, pos: pos.current, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 }
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 6) return
    if (!d.moved) {
      d.moved = true
      track.current?.classList.add('dragging')
      track.current?.setPointerCapture(e.pointerId)
    }
    const now = performance.now()
    if (now > d.lastT) d.v = 0.7 * d.v + 0.3 * ((e.clientX - d.lastX) / (now - d.lastT))
    d.lastX = e.clientX
    d.lastT = now
    pos.current = target.current = d.pos - dx / STEP
    layout()
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const el = track.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (!d.moved) return
    // Класс снимаем после клика, который браузер шлёт следом за отпусканием.
    window.setTimeout(() => el?.classList.remove('dragging'), 0)
    const fling = Math.max(-3, Math.min(3, (-d.v * 220) / STEP))
    go(Math.round(pos.current + fling))
  }

  return (
    <div className="pv-car">
      <button className="pv-car-arrow l" aria-label="Предыдущий кит" data-track="pvp_kit_prev" onClick={() => step(-1)}>
        <Icon id="i-chev-l" />
      </button>
      <span className="pv-car-back" ref={back} aria-hidden="true">
        <canvas className="pv-car-mosaic" ref={canvas} />
        <i className="pv-car-floor" />
      </span>
      <div
        className="pv-car-track"
        ref={track}
        role="listbox"
        aria-label="Кит"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="pv-ring" ref={ring}>
        {kits.map((m, i) => {
          const t = me?.modes?.[m.slug]
          const tier = t && tierRank(t.tier) !== null ? t.tier.toUpperCase() : null
          const sel = kit === m.slug
          return (
            <button
              key={m.slug}
              role="option"
              aria-selected={sel}
              tabIndex={-1}
              className={'pv-kcard' + (sel ? ' on' : '')}
              style={{ '--kc': look(m.slug).c } as CSSProperties}
              data-track={'pvp_kit_' + m.slug}
              onClick={() => {
                if (track.current?.classList.contains('dragging')) return
                go(Math.round(target.current) + offset(i, Math.round(target.current)))
              }}
              onDoubleClick={() => onPlay(m.slug)}
            >
              <span className="pv-card-face">
                <span className="pv-card-bg" />
                <i className="pv-card-shade" />
              </span>
              {/* Фигура — отдельным слоем перед рамкой: сбоку обрезана по рамке, в центре выходит из неё. */}
              <img
                className="pv-card-rig"
                src={rigUrl(m.slug)}
                alt=""
                draggable={false}
                style={{ '--fx': (look(m.slug).fx ?? 50) + '%', transformOrigin: (look(m.slug).fx ?? 50) + '% 100%' } as CSSProperties}
                onLoad={(e) => {
                  const img = e.currentTarget
                  if (!img.naturalHeight) return
                  const w = (img.naturalWidth / img.naturalHeight) * RIG_H
                  const ax = ((look(m.slug).fx ?? 50) / 100) * w
                  clips.current[i] = [Math.max(0, ax - FACE_HALF), Math.max(0, w - ax - FACE_HALF)]
                  pops.current[i] = Math.max(0.08, Math.min(0.3, 300 / w - 1))
                  layout()
                }}
              />
              {/* Лента с названием — как баннеры китов у Dawn; под ней мой тир (нет — прочерк). */}
              <span className="pv-card-banner">
                <span className="pv-card-banner-in">
                  <img src={kitIcon(m.slug)} alt="" width={22} height={22} draggable={false} />
                  <b>{m.title}</b>
                </span>
                <i className="pv-card-shade" />
              </span>
              <b className={'pv-card-tiertag' + (tier ? '' : ' none')} data-lv={tier ? tierLevel(tier) : undefined}>
                {tier ?? '—'}
              </b>
            </button>
          )
        })}
        </div>
      </div>
      <span className="pv-sparks" ref={sparks} aria-hidden="true" />
      <button className="pv-car-arrow r" aria-label="Следующий кит" data-track="pvp_kit_next" onClick={() => step(1)}>
        <Icon id="i-chev-r" />
      </button>
    </div>
  )
}

/** Итог матча (сервер держит 30 с): победа или поражение, счёт и ±ELO — рядом «Ещё раз». */
function ResultLine({ r, modes }: { r: ArenaState; modes: TierModeInfo[] }) {
  const cls = r.win === true ? 'win' : r.win === false ? 'loss' : 'draw'
  return (
    <span className={'pv-result ' + cls}>
      <b>{r.win === true ? 'Победа' : r.win === false ? 'Поражение' : 'Ничья'}</b>
      {r.score ? <span>{r.score}</span> : null}
      {r.opponent?.name ? <span className="pv-result-opp">vs {r.opponent.name}</span> : null}
      {r.kit ? <span className="pv-result-kit">{modeTitle(modes, r.kit)}</span> : null}
      {typeof r.delta === 'number' && r.delta ? <em className={r.delta > 0 ? 'up' : 'down'}>{(r.delta > 0 ? '+' : '') + r.delta}</em> : null}
    </span>
  )
}

/** «Матч найден» как у Dawn: соперник, его тир, кит и сколько осталось на вход. */
function MatchFound({ q, now, modes }: { q: { phase: string; kit: string; opponent: { name: string; tier?: string } | null; joinBy: number | null }; now: number; modes: TierModeInfo[] }) {
  if (!q.opponent) return null
  const left = q.joinBy ? Math.max(0, q.joinBy - now) : 0
  return (
    <div className="pv-found" role="alertdialog" aria-label="Матч найден" style={{ '--kc': look(q.kit).c } as CSSProperties}>
      <span className="pv-found-cap">Матч найден</span>
      <span className="pv-found-who">
        <Head nick={q.opponent.name} size={56} src={avatarUrl(q.opponent.name)} />
        <b>{q.opponent.name}</b>
        {q.opponent.tier && tierRank(q.opponent.tier) !== null ? <TierBadge tier={q.opponent.tier.toUpperCase()} /> : null}
      </span>
      <span className="pv-found-sub">
        {modeTitle(modes, q.kit)} · {q.phase === 'joining' ? 'запускаем игру прямо в матч' : 'готовим вход'}
        {left ? ' · ' + clock(left) : ''}
      </span>
    </div>
  )
}

/* ---------------- Мои матчи: последние, под кнопкой ---------------- */

const TYPE_NAME: Record<string, string> = { ranked: 'Рейтинговый', casual: 'Без рейтинга', duel: 'Дуэль', bot: 'Бот' }

function MyMatches({ nick, all }: { nick: string; all?: boolean }) {
  const modes = useTiers((s) => s.modes)
  const rows = useTiers((s) => (nick ? s.matches[nick.toLowerCase()] : null))
  if (!rows || !rows.length) return all ? <div className="fr-blank"><b>Матчей пока нет</b></div> : null
  const shown = all ? rows : rows.slice(0, 6)
  return (
    <section className="pv-matches" aria-label="Мои матчи">
      {all ? null : (
        <header className="pv-sec-head">
          <h2 className="pv-cap">Мои матчи</h2>
          {rows.length > shown.length ? (
            <button className="btn sm secondary" data-track="pvp_matches_all" onClick={() => usePvp.getState().setView('matches')}>
              Все матчи
            </button>
          ) : null}
        </header>
      )}
      <div className="pv-m-list">
        {shown.map((m) => (
          <div key={m.id} className={'pv-m ' + (m.win ? 'win' : 'loss')}>
            <span className="pv-m-kit">
              <img src={kitIcon(m.kit)} alt="" width={30} height={30} draggable={false} />
              <span>
                <b>{modeTitle(modes, m.kit)}</b>
                <i>{TYPE_NAME[m.type] ?? m.type}</i>
              </span>
            </span>
            <span className="pv-m-opp">
              <Head nick={m.opponent} size={32} src={avatarUrl(m.opponent)} />
              <span>
                <b>{m.opponent}</b>
                <i>{ago(m.playedAt)} назад</i>
              </span>
            </span>
            <span className="pv-m-elo">{m.type === 'ranked' && m.delta ? <em className={m.delta > 0 ? 'up' : 'down'}>{(m.delta > 0 ? '+' : '') + m.delta} ELO</em> : null}</span>
            <span className="pv-m-res">
              <i>{m.win ? 'Победа' : 'Поражение'}</i>
              <b>{m.score.replace(':', ' – ')}</b>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------------- Тир-лист справа: места и «Моё место» ---------------- */

/** Сколько мест видно на главной раздела; остальные — по «Показать всех». */
const TOP_SHOWN = 10

const pts = (n: number) => n + ' ' + plural(n, 'очко', 'очка', 'очков')
const badgeOf = (t: string | undefined) => (t && tierRank(t) !== null ? t.toUpperCase() : undefined)

/**
 * Сколько дней тир ещё держится без рейтинговых игр: через 30 дней он
 * становится «???» (пик сохраняется). Срок отдаёт сервер (decayAt); у
 * старого ответа считаем сами по последнему рейтинговому матчу.
 */
function decayOf(m: TierMode | undefined, tier: string | null, kit: string, matches: TierMatch[] | null | undefined, now: number): number | null {
  if (!tier) return null
  const day = 86_400_000
  if (m?.decayAt) return Math.max(0, Math.ceil((m.decayAt - now) / day))
  const last = (matches || []).filter((x) => x.kit === kit && x.type === 'ranked').reduce((a, x) => Math.max(a, x.playedAt), 0)
  return last ? Math.max(0, 30 - Math.floor((now - last) / day)) : null
}

/**
 * «Моё место» — карточка игрока под кнопкой. Общий рейтинг — сумма очков за
 * тиры в лучших китах: место, общий тир, очки. Ниже — тиры во всех китах
 * (клик выбирает кит) и строка про кит, выбранный в карусели: место в нём,
 * ELO, подсказка сервера «что дальше» и сколько тир ещё держится без игр.
 */
function MyPlace() {
  const nick = tierNick()
  const me = useTiers((s) => (s.nick === nick ? s.me : undefined))
  const modes = useTiers((s) => s.modes)
  const matches = useTiers((s) => (nick ? s.matches[nick.toLowerCase()] : null))
  const kit = usePvp((s) => s.kit)
  if (!nick || me === undefined) return null
  if (!me)
    return (
      <section className="pv-me none">
        <h2 className="pv-cap">Моё место</h2>
        <span className="pv-me-none">Пока без тира. Первый тир — экзамен с ботом, выше LT3 — тесты с игроками</span>
      </section>
    )
  const m = me.modes?.[kit]
  const tier = m ? badgeOf(m.tier) ?? null : null
  const overall = badgeOf(me.overallTier)
  const decay = decayOf(m, tier, kit, matches, Date.now())
  const title = modeTitle(modes, kit)
  return (
    <section className="pv-me" style={{ '--kc': look(kit).c } as CSSProperties}>
      <h2 className="pv-cap">Моё место</h2>
      <div className="pv-me-card">
        <div className="pv-me-top">
          <Head nick={me.name} size={64} src={avatarUrl(me.name)} />
          <span className="pv-me-txt">
            <b>{me.name}</b>
            <i>{me.title}</i>
          </span>
          <div className="pv-me-stat">
            <i>Общий рейтинг · очки за тиры во всех китах</i>
            <span>
              <b className="pv-me-num">{me.rank ? '#' + me.rank : '—'}</b>
              {overall ? <TierBadge tier={overall} big /> : null}
              <em>{pts(me.points)}</em>
            </span>
          </div>
        </div>
        <div className="pv-me-kits" role="listbox" aria-label="Мои тиры по китам">
          {modes.map((k) => {
            const t = badgeOf(me.modes?.[k.slug]?.tier)
            return (
              <button key={k.slug} role="option" aria-selected={kit === k.slug} className={'pv-me-kit' + (kit === k.slug ? ' on' : '') + (t ? '' : ' none')} data-tip={k.title} data-track={'pvp_me_kit_' + k.slug} onClick={() => usePvp.getState().setKit(k.slug)}>
                <img src={kitIcon(k.slug)} alt={k.title} width={22} height={22} draggable={false} />
                {t ? <TierBadge tier={t} /> : <i>—</i>}
              </button>
            )
          })}
        </div>
        <div className="pv-me-kitline">
          <span className="pv-me-kitname">
            <img src={kitIcon(kit)} alt="" width={20} height={20} draggable={false} />
            {title}
          </span>
          {m && tier ? (
            <>
              <span>
                <b>{m.rank ? '#' + m.rank : '—'}</b> в ките
              </span>
              <span>
                <b>{m.elo}</b> ELO
              </span>
              <span>
                <b>
                  {m.wins}–{m.losses}
                </b>{' '}
                побед–поражений
              </span>
              {m.next ? <span className={'pv-me-next' + (m.test ? ' open' : '')}>{m.next}</span> : null}
              {decay !== null ? (
                <span className={'pv-me-decay' + (decay <= 5 ? ' soon' : '')}>
                  {/* Защиты тира нет: взятый тестом не падает, только «???» после 30 дней без рейтинга. */}
                  {decay > 0 ? 'без рейтинга станет «???» через ' + decay + ' ' + plural(decay, 'день', 'дня', 'дней') : 'сегодня без рейтинговой игры станет «???»'}
                </span>
              ) : null}
            </>
          ) : (
            <span>тира пока нет — первый даёт экзамен с ботом</span>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Топ-10 на главной раздела — десять подробных строк: место, игрок, его тиры
 * по китам (за них очки общего рейтинга), общий тир и очки; в топе кита —
 * тир, ELO и победы. Все места — отдельной страницей.
 */
function TopTen() {
  const nick = tierNick()
  const me = useTiers((s) => (s.nick === nick ? s.me : undefined))
  const top = useTiers((s) => s.top)
  const modes = useTiers((s) => s.modes)
  const kit = usePvp((s) => s.kit)
  const board = usePvp((s) => s.board)
  const kitRows = useTiers((s) => s.kitRows[kit] ?? null)

  useEffect(() => {
    if (board === 'kit') void useTiers.getState().loadKit(kit)
  }, [board, kit])

  const lines = linesOf(board === 'all' ? 'all' : kit, 'tier', top, kitRows, undefined, modes.map((m) => m.slug))
  const meName = (me?.name ?? nick).toLowerCase()

  return (
    <section className="pv-top" aria-label="Тир-лист">
      <header className="pv-sec-head">
        <h2 className="pv-cap">Тир-лист · топ-10</h2>
        <div className="segs pv-board-segs" role="tablist" aria-label="Какой топ">
          <button role="tab" aria-selected={board === 'all'} className={'seg' + (board === 'all' ? ' on' : '')} data-track="pvp_board_all" onClick={() => usePvp.getState().setBoard('all')}>
            Общий
          </button>
          <button role="tab" aria-selected={board === 'kit'} className={'seg' + (board === 'kit' ? ' on' : '')} data-track="pvp_board_kit" onClick={() => usePvp.getState().setBoard('kit')}>
            {modeTitle(modes, kit)}
          </button>
        </div>
      </header>
      <div className="stack tb-list tl-list pv-top-list">
        {lines === null
          ? Array.from({ length: TOP_SHOWN }, (_, i) => <div key={i} className="tb-row skel" style={{ height: 72 }} aria-hidden="true" />)
          : lines.length
            ? lines.slice(0, TOP_SHOWN).map((l) => <TierRow key={l.pos + l.name} l={l} modes={modes} mine={l.name.toLowerCase() === meName} />)
            : <span className="pv-mine-none">Здесь пока пусто — стань первым</span>}
      </div>
      <button
        className="btn secondary pv-board-all"
        data-track="pvp_board_show_all"
        onClick={() => {
          // Полный список — отдельной страницей раздела, на том же ките.
          useTiers.getState().setKit(board === 'kit' ? kit : 'all')
          usePvp.getState().setView('tiers')
        }}
      >
        Показать всех
      </button>
    </section>
  )
}
