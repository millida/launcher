import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Head } from './Head'
import { Slider } from './Slider'
import {
  acceptCall,
  callQuality,
  declineCall,
  fmtCallTime,
  hangUp,
  ringRoom,
  setCallVolume,
  sharedScreens,
  toggleDeafen,
  toggleMute,
  toggleScreen,
  useCall,
  type CallParticipant,
} from '../state/call'
import { SCREEN_MAX_VIEWERS, canShareScreenTo } from '../lib/call/mesh-rules'
import { setStoredCallVolume } from '../lib/call/audio'
import { openChat, openRoomChat } from '../state/friends'
import { canShareScreen } from '../lib/call/screen'

/// Индикатор связи: точное значение задержки в панели звонка никому не нужно,
/// нужен ответ на вопрос «нормально ли слышно».
function qualityLabel(rttMs: number | null, lossPct: number): { text: string; cls: string } {
  if (rttMs === null) return { text: 'Соединяемся', cls: 'wait' }
  if (lossPct > 8 || rttMs > 350) return { text: 'Плохая связь', cls: 'bad' }
  if (lossPct > 3 || rttMs > 180) return { text: 'Связь так себе', cls: 'mid' }
  return { text: 'Связь хорошая', cls: 'ok' }
}

function Timer({ from }: { from: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{fmtCallTime(now - from)}</>
}

function IncomingCard() {
  const nick = useCall((s) => s.peerNick)
  return (
    <div className="call-ring">
      <div className="call-ring-card">
        <Head nick={nick || 'MHF_Steve'} size={56} />
        <div className="call-ring-body">
          <b>{nick || 'Друг'}</b>
          <span>Входящий звонок</span>
        </div>
        <div className="call-ring-acts">
          <button className="btn sm primary" onClick={() => void acceptCall()}>
            <Icon id="i-phone" />
            Ответить
          </button>
          <button className="btn sm danger" onClick={() => void declineCall()}>
            <Icon id="i-phone-hang" />
            Отклонить
          </button>
        </div>
      </div>
    </div>
  )
}

/// Шаг ленты графика и плотность точек: 50 мс дают видимый ход волны, но не
/// превращают речь в частокол.
const GRAPH_STEP_MS = 50
const GRAPH_PX_PER_POINT = 3
const GRAPH_HEIGHT = 52

const graphAmp = (level: number) => Math.min(1, Math.sqrt(Math.max(0, level)) * 1.5)

function themeColor(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * График речи: своя волна идёт вверх, волна собеседника — вниз, каждая своим
 * цветом. Разделение по стороне и цвету отвечает на вопрос «кто сейчас говорит»
 * без единой подписи.
 *
 * Рисование живёт вне React: уровень меняется десятки раз в секунду, и
 * перерисовывать ради него всю панель звонка незачем.
 */
function VoiceGraph() {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const box = wrap.current
    const cvs = canvas.current
    if (!box || !cvs) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    let mine: number[] = []
    let theirs: number[] = []
    let width = 0
    let colorMe = '#5EC64D'
    let colorPeer = '#6AA9E9'
    let colorGrid = 'rgba(255,255,255,.14)'

    const points = () => Math.max(24, Math.round(width / GRAPH_PX_PER_POINT))

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = box.clientWidth
      cvs.width = Math.max(1, Math.round(width * dpr))
      cvs.height = Math.round(GRAPH_HEIGHT * dpr)
      cvs.style.height = GRAPH_HEIGHT + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = points()
      const pad = (list: number[]) => (list.length >= n ? list.slice(-n) : new Array(n - list.length).fill(0).concat(list))
      mine = pad(mine)
      theirs = pad(theirs)
    }

    const readColors = () => {
      colorMe = themeColor(box, '--m-accent', colorMe)
      colorPeer = themeColor(box, '--m-info', colorPeer)
      colorGrid = themeColor(box, '--m-border-strong', colorGrid)
    }

    resize()
    readColors()
    const ro = new ResizeObserver(resize)
    ro.observe(box)

    let ticks = 0
    const push = setInterval(() => {
      const s = useCall.getState()
      const n = points()
      const ease = (list: number[], target: number) => {
        const prev = list.length ? list[list.length - 1] : 0
        return prev + (target - prev) * 0.55
      }
      // Волна собеседников общая: в группе говорить может не один, и график
      // отвечает на вопрос «есть ли речь с той стороны», а не «чья именно».
      const peerLevel = s.parts.reduce((top, p) => (p.muted ? top : Math.max(top, p.level)), 0)
      mine.push(ease(mine, s.muted ? 0 : graphAmp(s.level)))
      theirs.push(ease(theirs, graphAmp(peerLevel)))
      if (mine.length > n) mine = mine.slice(-n)
      if (theirs.length > n) theirs = theirs.slice(-n)
      if (++ticks % 20 === 0) readColors()
    }, GRAPH_STEP_MS)

    const wave = (list: number[], color: string, up: boolean) => {
      const mid = GRAPH_HEIGHT / 2
      const span = mid - 3
      const step = width / Math.max(1, list.length - 1)
      const y = (v: number) => mid + (up ? -v * span : v * span)
      ctx.beginPath()
      ctx.moveTo(0, y(list[0]))
      for (let i = 1; i < list.length; i++) {
        const x = i * step
        const px = (i - 1) * step
        ctx.bezierCurveTo(px + step / 2, y(list[i - 1]), px + step / 2, y(list[i]), x, y(list[i]))
      }
      ctx.lineTo(width, mid)
      ctx.lineTo(0, mid)
      ctx.closePath()
      ctx.globalAlpha = 0.26
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, width, GRAPH_HEIGHT)
      ctx.strokeStyle = colorGrid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, GRAPH_HEIGHT / 2 + 0.5)
      ctx.lineTo(width, GRAPH_HEIGHT / 2 + 0.5)
      ctx.stroke()
      wave(mine, colorMe, true)
      wave(theirs, colorPeer, false)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      ro.disconnect()
      clearInterval(push)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="call-graph" ref={wrap}>
      <canvas ref={canvas} />
    </div>
  )
}

const DOCK_KEY = 'm-call-dock'
const DOCK_MIN_W = 260
const DOCK_MAX_W = 980
/// С этой ширины график переезжает в строку с ником: рядом с именем остаётся
/// пустое место, а вертикаль нужнее показу экрана.
const DOCK_WIDE_W = 460
/// Дрожь руки на клике — не перетаскивание.
const DRAG_SLOP = 4

/// Отпущенное после перетаскивания нажатие не должно открывать переписку или
/// разворачивать экран: гасим ровно один клик, пришедший следом.
function suppressNextClick() {
  const kill = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', kill, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', kill, true), 0)
}
const DOCK_EDGE = 8

interface DockBox {
  x: number | null
  y: number | null
  w: number
}

const clampWidth = (w: number) => Math.max(DOCK_MIN_W, Math.min(DOCK_MAX_W, Math.min(window.innerWidth - DOCK_EDGE * 2, w)))

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function loadDock(): DockBox {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null')
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>
      return { x: finite(r.x), y: finite(r.y), w: clampWidth(finite(r.w) ?? 300) }
    }
  } catch {
    // Значение мог записать другой формат — берём умолчание, а не падаем.
  }
  return { x: null, y: null, w: 300 }
}

const saveDock = (b: DockBox) => {
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(b))
  } catch {
    // Переполненное хранилище не повод ронять звонок.
  }
}

function clampPos(x: number, y: number, el: HTMLElement): { x: number; y: number } {
  const w = el.offsetWidth
  const h = el.offsetHeight
  const maxX = Math.max(DOCK_EDGE, window.innerWidth - w - DOCK_EDGE)
  const maxY = Math.max(DOCK_EDGE, window.innerHeight - h - DOCK_EDGE)
  return { x: Math.min(Math.max(DOCK_EDGE, x), maxX), y: Math.min(Math.max(DOCK_EDGE, y), maxY) }
}

/** Положение и ширина дока: человек двигает панель туда, где она не мешает игре или чату. */
function useDockBox(ref: React.RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState<DockBox>(loadDock)
  const boxRef = useRef(box)
  boxRef.current = box

  const commit = useCallback((next: DockBox) => {
    boxRef.current = next
    setBox(next)
  }, [])

  useLayoutEffect(() => {
    const onResize = () => {
      const el = ref.current
      if (!el) return
      const cur = boxRef.current
      const w = clampWidth(cur.w)
      if (cur.x === null || cur.y === null) {
        if (w !== cur.w) commit({ ...cur, w })
        return
      }
      const pos = clampPos(cur.x, cur.y, el)
      commit({ x: pos.x, y: pos.y, w })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [ref, commit])

  const [dragging, setDragging] = useState<'move' | 'size' | null>(null)

  const drag = useCallback(
    (kind: 'move' | 'size', e: React.PointerEvent) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const grabX = e.clientX - rect.left
      const grabY = e.clientY - rect.top
      const startX = e.clientX
      const startY = e.clientY
      const startW = boxRef.current.w
      // Панель тянется откуда угодно, включая кнопки: пока указатель не ушёл на
      // DRAG_SLOP, это ещё клик, и кнопка под пальцем должна сработать обычно.
      let started = kind === 'size'
      if (started) setDragging(kind)
      const move = (ev: PointerEvent) => {
        const cur = boxRef.current
        if (kind === 'size') {
          const w = clampWidth(startW + (ev.clientX - startX))
          if (cur.x === null || cur.y === null) commit({ ...cur, w })
          else commit({ ...clampPos(cur.x, cur.y, el), w })
          return
        }
        if (!started) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_SLOP) return
          started = true
          setDragging('move')
        }
        commit({ ...cur, ...clampPos(ev.clientX - grabX, ev.clientY - grabY, el) })
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        setDragging(null)
        if (kind === 'move' && started) suppressNextClick()
        if (started) saveDock(boxRef.current)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      // preventDefault здесь съел бы двойной клик по грипу: выделение и так
      // выключено стилем, а совместимые мышиные события нужны живыми.
    },
    [ref, commit],
  )

  const reset = useCallback(() => {
    const next: DockBox = { x: null, y: null, w: 300 }
    commit(next)
    saveDock(next)
  }, [commit])

  return { box, dragging, drag, reset }
}

/**
 * Кто в разговоре: голова светится, пока человек говорит, значок показывает
 * выключенный микрофон и показ экрана. Это ответ на единственный вопрос,
 * который возникает в группе — «кто сейчас говорит».
 */
function RoomParticipants({ parts, screenOf }: { parts: CallParticipant[]; screenOf: string }) {
  const set = useCall((s) => s.set)
  if (!parts.length) {
    return <div className="call-room-empty">Пока ты один — позови остальных</div>
  }
  return (
    <div className="call-room">
      {parts.map((p) => (
        <button
          key={p.userId}
          className={
            'call-part' +
            (p.speaking ? ' talking' : '') +
            (p.muted ? ' muted' : '') +
            (p.connection === 'failed' ? ' lost' : '')
          }
          title={
            p.connection === 'failed'
              ? p.nick + ' — связь потеряна'
              : p.sharing
                ? p.nick + ' показывает экран'
                : p.nick
          }
          onClick={() => {
            if (p.screen) set({ screenOf: p.userId, screenFull: true })
          }}
        >
          <Head nick={p.nick} size={30} />
          <span className="call-part-nick">{p.nick}</span>
          {p.muted ? <Icon id="i-mic-off" /> : null}
          {p.sharing ? (
            <Icon id="i-screen-share" />
          ) : null}
          {p.userId === screenOf ? <span className="call-part-live" /> : null}
        </button>
      ))}
    </div>
  )
}

function ScreenVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])
  // Звук показа идёт отдельной дорожкой через свой элемент, поэтому видео
  // немое: иначе он играл бы дважды.
  return <video ref={ref} muted playsInline />
}

function ScreenFull({ stream, onClose }: { stream: MediaStream; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="call-screen-full" onClick={onClose}>
      <div className="call-screen-stage" onClick={(e) => e.stopPropagation()}>
        <ScreenVideo stream={stream} />
      </div>
      <button className="call-screen-x" title="Свернуть (Esc)" onClick={onClose}>
        <Icon id="i-minimize" />
      </button>
    </div>
  )
}

export function CallPanel() {
  const status = useCall((s) => s.status)
  const mode = useCall((s) => s.mode)
  const nick = useCall((s) => s.peerNick)
  const peerId = useCall((s) => s.peerId)
  const roomId = useCall((s) => s.roomId)
  const roomTitle = useCall((s) => s.roomTitle)
  const muted = useCall((s) => s.muted)
  const deafened = useCall((s) => s.deafened)
  const sharing = useCall((s) => s.sharing)
  const parts = useCall((s) => s.parts)
  const speaking = useCall((s) => s.speaking)
  const answeredAt = useCall((s) => s.answeredAt)
  const screenOf = useCall((s) => s.screenOf)
  const screenFull = useCall((s) => s.screenFull)
  const volume = useCall((s) => s.volume)
  const set = useCall((s) => s.set)
  const peer = parts[0]
  const peerMuted = mode === 'dm' && !!peer?.muted
  const peerSpeaking = parts.some((p) => p.speaking)
  const quality = callQuality(parts)
  const shown = sharedScreens(parts)
  const screenBlocked = mode === 'room' && !sharing && !canShareScreenTo(parts.length)
  const remoteScreen = (shown.find((p) => p.userId === screenOf) || shown[0])?.screen || null
  const [volOpen, setVolOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const { box, dragging, drag, reset } = useDockBox(dockRef)

  if (status === 'idle') return null
  if (status === 'incoming') return <IncomingCard />

  const q = qualityLabel(quality?.rttMs ?? null, quality?.lossPct ?? 0)
  const state = status === 'outgoing' ? 'Звоним…' : status === 'connecting' ? 'Соединяем…' : q.text
  const placed = box.x !== null && box.y !== null
  const dockStyle = placed
    ? { left: box.x + 'px', top: box.y + 'px', bottom: 'auto', width: box.w + 'px' }
    : { width: box.w + 'px' }
  const dockCls =
    'call-dock' +
    (speaking ? ' talking' : '') +
    (peerSpeaking ? ' peer-talking' : '') +
    (remoteScreen && screenFull ? ' above' : '') +
    (dragging ? ' dragging' : '')

  return (
    <>
      {remoteScreen && screenFull ? (
        <ScreenFull stream={remoteScreen} onClose={() => set({ screenFull: false })} />
      ) : null}
      <div
        ref={dockRef}
        className={dockCls}
        style={dockStyle}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if ((e.target as HTMLElement).closest('input, .m-slider, .call-dock-resize')) return
          drag('move', e)
        }}
      >
        <div className={'call-head' + (box.w >= DOCK_WIDE_W ? ' wide' : '')}>
          <div className="call-dock-top">
            <span
              className="call-dock-grip"
              title="Перетащить панель (двойной клик — вернуть на место)"
              onDoubleClick={reset}
            >
              <Icon id="i-grip" />
            </span>
            <button
              className="call-dock-who"
              title={mode === 'room' ? 'Открыть переписку группы' : 'Открыть переписку'}
              onClick={() =>
                mode === 'room' ? void openRoomChat(roomId, roomTitle) : void openChat(peerId, nick)
              }
            >
              {mode === 'room' ? (
                <span className="room-ava">
                  <Icon id="i-users" />
                </span>
              ) : (
                <Head nick={nick || 'MHF_Steve'} size={34} />
              )}
              <span className="call-dock-name">
                <b>{mode === 'room' ? roomTitle || 'Группа' : nick || 'Друг'}</b>
                <span className={'call-dock-state ' + (status === 'active' ? q.cls : 'wait')}>
                  {status === 'active' ? <Timer from={answeredAt} /> : null}
                  {status === 'active' ? ' · ' : ''}
                  {mode === 'room' && status === 'active' ? parts.length + 1 + ' в разговоре · ' : ''}
                  {state}
                  {peerMuted ? ' · без микрофона' : ''}
                </span>
              </span>
            </button>
          </div>

          <VoiceGraph />
        </div>

        {mode === 'room' ? <RoomParticipants parts={parts} screenOf={screenOf} /> : null}

        {remoteScreen && !screenFull ? (
          <div className="call-screen-mini" onDoubleClick={() => set({ screenFull: true })}>
            <ScreenVideo stream={remoteScreen} />
            <span className="call-screen-hint">
              {mode === 'room'
                ? 'Экран · ' + (shown.find((p) => p.screen === remoteScreen)?.nick || 'участник')
                : 'Экран собеседника'}
            </span>
            <button
              className="call-screen-max"
              title="Развернуть на весь экран"
              onClick={() => set({ screenFull: true })}
            >
              <Icon id="i-maximize" />
            </button>
          </div>
        ) : null}

        <div className="call-dock-acts">
          <button
            className={'tb-btn' + (muted ? ' off' : '')}
            title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
            onClick={toggleMute}
          >
            <Icon id={muted ? 'i-mic-off' : 'i-mic'} />
          </button>
          <button
            className={'tb-btn' + (deafened ? ' off' : '')}
            title={deafened ? 'Включить звук' : 'Заглушить звук'}
            onClick={toggleDeafen}
          >
            <Icon id={deafened ? 'i-headset-off' : 'i-headset'} />
          </button>
          {canShareScreen() ? (
            <button
              className={'tb-btn' + (sharing ? ' on' : '')}
              title={
                screenBlocked
                  ? 'Показ экрана — пока в разговоре не больше ' + (SCREEN_MAX_VIEWERS + 1) + ' человек'
                  : sharing
                    ? 'Остановить показ экрана'
                    : 'Показать экран'
              }
              disabled={status !== 'active' || screenBlocked}
              onClick={() => void toggleScreen()}
            >
              <Icon id="i-screen-share" />
            </button>
          ) : null}
          <button
            className={'tb-btn' + (volOpen ? ' on' : '')}
            title="Громкость собеседника"
            onClick={() => setVolOpen((v) => !v)}
          >
            <Icon id="i-volume" />
          </button>
          {mode === 'room' ? (
            <button className="tb-btn" title="Позвать остальных" onClick={() => void ringRoom(roomId)}>
              <Icon id="i-bell" />
            </button>
          ) : null}
          <button
            className="btn sm danger"
            title={mode === 'room' ? 'Выйти из разговора' : 'Завершить звонок'}
            onClick={() => void hangUp()}
          >
            <Icon id="i-phone-hang" />
          </button>
        </div>

        {volOpen ? (
          <div className="call-vol">
            <Icon id="i-volume" />
            <Slider
              value={volume}
              onChange={(v) => {
                setCallVolume(v)
                setStoredCallVolume(v)
              }}
            />
            <span>{volume}%</span>
          </div>
        ) : null}

        <span className="call-dock-resize" title="Изменить размер" onPointerDown={(e) => drag('size', e)} />
      </div>
    </>
  )
}
