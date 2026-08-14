import { create } from 'zustand'
import { openMic, playRemote, storedCallVolume, type MicChain, type RemoteAudio } from '../lib/call/audio'
import { iceConfig, supportsCalls } from '../lib/call/ice'
import { createPeer, type Peer, type PeerFlags, type PeerQuality } from '../lib/call/peer'
import { newCallId, sendSignal, startSignalPump, type CallEvent } from '../lib/call/signal'
import { startRing, stopRing } from '../lib/call/ringtone'
import { canShareScreen, screenErrorText, shareScreen, storedScreenQuality, type ScreenShare } from '../lib/call/screen'
import { micErrorText } from '../lib/audioDevices'
import { storedMicGain, storedNoiseMode, type NoiseMode } from '../lib/call/mic-worklet'
import { openSettings, showToast } from './ui'
import { useGame } from './game'
import { overlayNotify } from '../ipc/commands'
import { restoreLauncher } from '../lib/window'
import { useFriends } from './friends'

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

interface CallState {
  status: CallStatus
  callId: string
  peerId: string
  peerNick: string
  answeredAt: number
  muted: boolean
  deafened: boolean
  sharing: boolean
  peerMuted: boolean
  peerSharing: boolean
  /** Уровень своего микрофона и факт речи — для индикатора в панели. */
  level: number
  speaking: boolean
  quality: PeerQuality | null
  connection: RTCPeerConnectionState | 'new'
  remoteScreen: MediaStream | null
  screenFull: boolean
  volume: number
  noise: NoiseMode
  micGain: number
  set: (patch: Partial<CallState>) => void
}

const IDLE = {
  status: 'idle' as CallStatus,
  callId: '',
  peerId: '',
  peerNick: '',
  answeredAt: 0,
  muted: false,
  deafened: false,
  sharing: false,
  peerMuted: false,
  peerSharing: false,
  level: 0,
  speaking: false,
  quality: null,
  connection: 'new' as const,
  remoteScreen: null,
  screenFull: false,
}

export const useCall = create<CallState>((set) => ({
  ...IDLE,
  volume: storedCallVolume(),
  noise: storedNoiseMode(),
  micGain: storedMicGain(),
  set: (patch) => set(patch as CallState),
}))

/** Дозвон без ответа. Дольше держать бессмысленно: человека нет на месте. */
const RING_TIMEOUT_MS = 45_000

/** Столько ждём соединения после ответа: дальше это не «соединяем», а тишина. */
const CONNECT_TIMEOUT_MS = 30_000

/** Сорванное соединение чиним один раз молча, дальше это уже не связь. */
const RETRY_LIMIT = 1

let peer: Peer | null = null
let mic: MicChain | null = null
let remote: RemoteAudio | null = null
let remoteScreenAudio: RemoteAudio | null = null
let screen: ScreenShare | null = null
let ringTimer: ReturnType<typeof setTimeout> | null = null
let statsTimer: ReturnType<typeof setInterval> | null = null
let retries = 0
/// Роль в звонке: от неё зависит вежливость при пересогласовании, и меняться
/// она не должна — даже когда соединение пересобирается после обрыва.
let amCaller = false

const st = () => useCall.getState()

function clearTimers() {
  if (ringTimer) clearTimeout(ringTimer)
  ringTimer = null
  if (statsTimer) clearInterval(statsTimer)
  statsTimer = null
}

/** Разбор всего разговора: дорожки, соединение, звук и таймеры. */
function teardown() {
  clearTimers()
  stopRing()
  if (screen) screen.stop()
  screen = null
  if (remoteScreenAudio) remoteScreenAudio.close()
  remoteScreenAudio = null
  if (remote) remote.close()
  remote = null
  if (peer) peer.close()
  peer = null
  if (mic) mic.close()
  mic = null
  retries = 0
}

function reset() {
  teardown()
  st().set({ ...IDLE })
}

async function openMicOrFail(): Promise<MicChain | null> {
  try {
    const chain = await openMic()
    chain.onLevel((l) => {
      const cur = st()
      if (cur.status === 'idle') return
      cur.set({ level: l.level, speaking: l.open && !cur.muted })
    })
    chain.setMuted(st().muted)
    return chain
  } catch (e) {
    showToast(micErrorText(e), 'error', undefined, {
      label: 'Настроить',
      run: () => openSettings('sound', 'mic'),
    })
    return null
  }
}

/**
 * Соединение с собеседником. Вежливость раздаётся по роли, а не по случайности:
 * звонящий — невежливый, отвечающий — вежливый, и обе стороны знают это без
 * дополнительного обмена.
 */
async function buildPeer(callId: string, peerId: string, polite: boolean): Promise<Peer> {
  const ice = await iceConfig()
  const created = createPeer(ice, polite, {
    onSignal: (kind, data) => {
      void sendSignal(callId, peerId, kind, data).catch(() => {})
    },
    onRemoteAudio: (stream) => {
      if (remote) remote.close()
      remote = playRemote(stream, st().volume)
      remote.setDeafened(st().deafened)
    },
    onRemoteScreenAudio: (stream) => {
      if (remoteScreenAudio) remoteScreenAudio.close()
      remoteScreenAudio = null
      if (!stream) return
      remoteScreenAudio = playRemote(stream, st().volume)
      remoteScreenAudio.setDeafened(st().deafened)
    },
    onRemoteScreen: (stream) => st().set({ remoteScreen: stream, peerSharing: !!stream }),
    onFlags: (flags: PeerFlags) => {
      const patch: Partial<CallState> = {}
      if (typeof flags.muted === 'boolean') patch.peerMuted = flags.muted
      if (typeof flags.screen === 'boolean') patch.peerSharing = flags.screen
      st().set(patch)
    },
    onConnection: (state) => {
      const cur = st()
      if (cur.status === 'idle') return
      cur.set({ connection: state })
      if (state === 'connected') {
        retries = 0
        if (cur.status !== 'active') markAnswered()
        return
      }
      if (state === 'failed') void recover()
    },
  })
  return created
}

/// Ответ получен, но соединение может так и не собраться — например, когда у
/// обеих сторон закрытый NAT, а ретранслятор не настроен. Ждать вечно нельзя.
function armConnectTimeout() {
  if (ringTimer) clearTimeout(ringTimer)
  ringTimer = setTimeout(() => {
    if (st().status !== 'connecting') return
    showToast('Не удалось соединиться — попробуй позвонить ещё раз', 'error')
    void finish('failed')
  }, CONNECT_TIMEOUT_MS)
}

function markAnswered() {
  stopRing()
  const cur = st()
  cur.set({ status: 'active', answeredAt: cur.answeredAt || Date.now() })
  if (ringTimer) clearTimeout(ringTimer)
  ringTimer = null
  if (!statsTimer) {
    statsTimer = setInterval(() => {
      if (!peer) return
      void peer.quality().then((q) => {
        if (st().status === 'active') st().set({ quality: q })
      })
    }, 3000)
  }
}

/**
 * Обрыв. Одна попытка пересобрать соединение — потому что чаще всего виноват
 * сменившийся адрес или уснувший Wi-Fi, и человеку незачем перезванивать.
 */
async function recover() {
  const cur = st()
  if (cur.status === 'idle') return
  if (retries >= RETRY_LIMIT) {
    showToast('Связь оборвалась', 'error')
    await finish('failed')
    return
  }
  retries++
  showToast('Связь пропала — восстанавливаем')
  const fresh = await buildPeer(cur.callId, cur.peerId, !amCaller)
  if (peer) peer.close()
  peer = fresh
  if (mic) await fresh.setMicTrack(mic.track)
  if (screen) await fresh.setScreenTrack(screen.video)
}

/**
 * Состояние собеседника идёт по каналу данных — он быстрее и не грузит сервер.
 * Пока канал не открылся, тот же флаг уходит сигналингом: иначе выключенный до
 * соединения микрофон отобразился бы у собеседника включённым.
 */
function shareFlags(flags: PeerFlags) {
  const cur = st()
  if (peer && peer.sendFlags(flags)) return
  if (cur.callId) void sendSignal(cur.callId, cur.peerId, 'state', flags as Record<string, unknown>).catch(() => {})
}

async function finish(reason: 'end' | 'decline' | 'cancel' | 'busy' | 'failed') {
  const cur = st()
  if (cur.status === 'idle') return
  const seconds = cur.answeredAt ? Math.round((Date.now() - cur.answeredAt) / 1000) : 0
  const kind = reason === 'failed' ? 'end' : reason
  const { callId, peerId } = cur
  reset()
  if (reason !== 'busy') startRing('ended')
  await sendSignal(callId, peerId, kind, {}, { seconds }).catch(() => {})
}

export function callSupported(): boolean {
  return supportsCalls()
}

export async function callFriend(peerId: string, nick: string) {
  const cur = st()
  if (cur.status !== 'idle') {
    showToast('Сначала заверши текущий звонок', 'error')
    return
  }
  if (!callSupported()) {
    showToast('Звонки недоступны в этой сборке', 'error')
    return
  }
  const callId = newCallId()
  amCaller = true
  cur.set({ ...IDLE, status: 'outgoing', callId, peerId, peerNick: nick })
  const chain = await openMicOrFail()
  if (!chain) {
    reset()
    return
  }
  mic = chain
  try {
    await sendSignal(callId, peerId, 'invite', {})
  } catch (e) {
    reset()
    showToast(String((e as Error).message || e), 'error')
    return
  }
  startRing('outgoing')
  ringTimer = setTimeout(() => {
    if (st().status !== 'outgoing') return
    showToast('Не ответил — звонок отменён')
    void finish('cancel')
  }, RING_TIMEOUT_MS)
}

export async function acceptCall() {
  const cur = st()
  if (cur.status !== 'incoming') return
  stopRing()
  const chain = await openMicOrFail()
  if (!chain) {
    void finish('decline')
    return
  }
  mic = chain
  cur.set({ status: 'connecting' })
  armConnectTimeout()
  // Соединение готово до ответа: предложение звонящего приходит следом, и
  // принять его должно уже собранное соединение.
  peer = await buildPeer(cur.callId, cur.peerId, true)
  await peer.setMicTrack(chain.track)
  await sendSignal(cur.callId, cur.peerId, 'accept', {}).catch(() => {})
}

export const declineCall = () => finish('decline')

export const hangUp = () => finish('end')

export function toggleMute() {
  const cur = st()
  const muted = !cur.muted
  cur.set({ muted, speaking: muted ? false : cur.speaking })
  if (mic) mic.setMuted(muted)
  shareFlags({ muted })
}

/**
 * Глушение выключает и микрофон: не слышать собеседника, но продолжать говорить
 * ему — это разговор в одну сторону, которого никто не ждёт.
 */
export function toggleDeafen() {
  const cur = st()
  const deafened = !cur.deafened
  const muted = deafened ? true : cur.muted
  cur.set({ deafened, muted })
  if (remote) remote.setDeafened(deafened)
  if (remoteScreenAudio) remoteScreenAudio.setDeafened(deafened)
  if (mic) mic.setMuted(muted)
  shareFlags({ muted, deafened })
}

export async function toggleScreen() {
  const cur = st()
  if (cur.status !== 'active' && cur.status !== 'connecting') return
  if (cur.sharing) {
    if (screen) screen.stop()
    screen = null
    if (peer) {
      await peer.setScreenTrack(null)
      await peer.setScreenAudioTrack(null)
    }
    shareFlags({ screen: false })
    cur.set({ sharing: false })
    return
  }
  if (!canShareScreen()) {
    showToast(screenErrorText(new Error('unsupported')), 'error')
    return
  }
  try {
    const share = await shareScreen(storedScreenQuality())
    screen = share
    if (peer) {
      await peer.setScreenTrack(share.video)
      if (share.audio) await peer.setScreenAudioTrack(share.audio)
    }
    shareFlags({ screen: true })
    st().set({ sharing: true })
    // Показ прекращают и системной кнопкой «остановить», не только нашей.
    share.video.onended = () => {
      if (st().sharing) void toggleScreen()
    }
  } catch (e) {
    const text = screenErrorText(e)
    if (text) showToast(text, 'error')
  }
}

export function setCallVolume(pct: number) {
  st().set({ volume: pct })
  if (remote) remote.setVolume(pct)
  if (remoteScreenAudio) remoteScreenAudio.setVolume(pct)
}

export function setCallNoise(mode: NoiseMode) {
  st().set({ noise: mode })
  if (mic) mic.setMode(mode)
}

export function setCallMicGain(pct: number) {
  st().set({ micGain: pct })
  if (mic) mic.setGain(pct)
}

function nickOf(uid: string): string {
  return useFriends.getState().friends.find((f) => f.userId === uid)?.nickname || 'Друг'
}

async function onInvite(e: CallEvent) {
  const cur = st()
  if (cur.status !== 'idle') {
    await sendSignal(e.callId, e.from, 'busy', {}).catch(() => {})
    return
  }
  const nick = nickOf(e.from)
  amCaller = false
  cur.set({ ...IDLE, status: 'incoming', callId: e.callId, peerId: e.from, peerNick: nick })
  startRing('incoming')
  ringTimer = setTimeout(() => {
    if (st().status === 'incoming') reset()
  }, RING_TIMEOUT_MS)
  // Пока идёт игра, окно лаунчера не трогаем: полноэкранная игра свернулась бы
  // ради вызова. Карточка уходит на оверлей поверх игры.
  if (useGame.getState().list.length) {
    void overlayNotify({ uid: e.from, nick, text: 'Звонит — ответить можно в лаунчере', ts: Date.now() }).catch(
      () => {},
    )
    return
  }
  restoreLauncher()
}

async function onAccept(e: CallEvent) {
  const cur = st()
  if (cur.status !== 'outgoing' || cur.callId !== e.callId) return
  cur.set({ status: 'connecting' })
  armConnectTimeout()
  peer = await buildPeer(cur.callId, cur.peerId, false)
  if (mic) await peer.setMicTrack(mic.track)
}

function endedText(kind: CallEvent['kind']): string {
  if (kind === 'decline') return 'Звонок отклонён'
  if (kind === 'busy') return 'Собеседник уже разговаривает'
  if (kind === 'cancel') return 'Звонок отменён'
  return 'Звонок завершён'
}

async function onEvent(e: CallEvent) {
  const cur = st()
  if (e.kind === 'invite') {
    await onInvite(e)
    return
  }
  // Всё остальное относится только к текущему звонку: конверт из отменённого
  // разговора не должен трогать новый.
  if (cur.status === 'idle' || cur.callId !== e.callId) return
  if (e.kind === 'accept') {
    await onAccept(e)
    return
  }
  if (e.kind === 'decline' || e.kind === 'cancel' || e.kind === 'end' || e.kind === 'busy') {
    const wasRinging = cur.status === 'incoming' || cur.status === 'outgoing'
    reset()
    if (wasRinging || e.kind !== 'end') showToast(endedText(e.kind))
    startRing('ended')
    return
  }
  if (e.kind === 'state') {
    const flags = e.data as PeerFlags
    const patch: Partial<CallState> = {}
    if (typeof flags.muted === 'boolean') patch.peerMuted = flags.muted
    if (typeof flags.screen === 'boolean') patch.peerSharing = flags.screen
    cur.set(patch)
    return
  }
  if (!peer) return
  await peer.accept(e.kind as 'offer' | 'answer' | 'ice', e.data)
}

let pump: { stop: () => void } | null = null

/** Приём звонков включается один раз на запуск лаунчера. */
export function initCalls() {
  if (pump || !callSupported()) return
  pump = startSignalPump((e) => {
    void onEvent(e).catch(() => {})
  })
  // Закрытие лаунчера посреди разговора должно доехать до собеседника, иначе он
  // будет сидеть с мёртвым соединением до таймаута.
  window.addEventListener('pagehide', () => {
    if (st().status !== 'idle') void finish('end')
  })
}

export function fmtCallTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  const h = Math.floor(m / 60)
  const mm = h ? String(m % 60).padStart(2, '0') : String(m)
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0')
}
