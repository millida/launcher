import { create } from 'zustand'
import { openMic, storedCallVolume, type MicChain } from '../lib/call/audio'
import { iceConfig, supportsCalls } from '../lib/call/ice'
import { CallSession, politeToward, type PeerState } from '../lib/call/session'
import { SCREEN_MAX_VIEWERS, canShareScreenTo } from '../lib/call/mesh-rules'
import type { PeerFlags, PeerQuality } from '../lib/call/peer'
import { newCallId, sendSignal, startSignalPump, type CallEvent } from '../lib/call/signal'
import { startRing, stopRing } from '../lib/call/ringtone'
import { canShareScreen, screenErrorText, shareScreen, storedScreenQuality, type ScreenShare } from '../lib/call/screen'
import { micErrorText, storedMicProcessing, type MicProcessing } from '../lib/audioDevices'
import { storedMicGain, storedNoiseMode, type NoiseMode } from '../lib/call/mic-worklet'
import { openSettings, showToast } from './ui'
import { useGame } from './game'
import { overlayNotify } from '../ipc/commands'
import { restoreLauncher } from '../lib/window'
import { useFriends } from './friends'
import { api } from '../lib/api'
import { nickInRooms, useRooms, type VoiceMember } from './rooms'

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

/** Личный звонок и разговор в группе — одно и то же соединение, разный состав. */
export type CallMode = 'dm' | 'room'

export interface CallParticipant extends PeerState {
  userId: string
  nick: string
}

interface CallState {
  mode: CallMode
  status: CallStatus
  callId: string
  /** Группа, в голосе которой сидим; у личного звонка пусто. */
  roomId: string
  roomTitle: string
  peerId: string
  peerNick: string
  answeredAt: number
  muted: boolean
  deafened: boolean
  sharing: boolean
  /** Уровень своего микрофона и факт речи — для индикатора в панели. */
  level: number
  speaking: boolean
  parts: CallParticipant[]
  screenFull: boolean
  /** Чей экран развёрнут: в группе показывать могут несколько человек сразу. */
  screenOf: string
  volume: number
  noise: NoiseMode
  micGain: number
  set: (patch: Partial<CallState>) => void
}

const IDLE = {
  mode: 'dm' as CallMode,
  status: 'idle' as CallStatus,
  callId: '',
  roomId: '',
  roomTitle: '',
  peerId: '',
  peerNick: '',
  answeredAt: 0,
  muted: false,
  deafened: false,
  sharing: false,
  level: 0,
  speaking: false,
  parts: [] as CallParticipant[],
  screenFull: false,
  screenOf: '',
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

/// Отметка «я ещё в разговоре». Сервер забывает молчащего через 45 секунд,
/// поэтому бьёмся втрое чаще: два потерянных удара не должны выкидывать из
/// комнаты того, кто просто попал в неудачную минуту сети.
const VOICE_BEAT_MS = 15_000

let session: CallSession | null = null
let mic: MicChain | null = null
let screen: ScreenShare | null = null
let ringTimer: ReturnType<typeof setTimeout> | null = null
let statsTimer: ReturnType<typeof setInterval> | null = null
let beatTimer: ReturnType<typeof setInterval> | null = null
const retries = new Map<string, number>()
/// Роль в личном звонке: от неё зависит вежливость при пересогласовании, и
/// меняться она не должна — даже когда соединение пересобирается после обрыва.
let amCaller = false
/// Свой id в соц-графе: локальная учётка лаунчера — это запись о входе, а не
/// идентификатор, поэтому его сообщает сервер при входе в голос.
let myId = ''

const st = () => useCall.getState()

const partsOf = (): CallParticipant[] => st().parts

function patchPart(userId: string, patch: Partial<CallParticipant>) {
  const cur = st()
  if (cur.status === 'idle') return
  if (!cur.parts.some((p) => p.userId === userId)) return
  cur.set({ parts: cur.parts.map((p) => (p.userId === userId ? { ...p, ...patch } : p)) })
}

function blankPart(userId: string, nick: string): CallParticipant {
  return {
    userId,
    nick,
    muted: false,
    deafened: false,
    sharing: false,
    level: 0,
    speaking: false,
    connection: 'new',
    quality: null,
    screen: null,
  }
}

function nickOf(uid: string): string {
  const friend = useFriends.getState().friends.find((f) => f.userId === uid)?.nickname
  return friend || nickInRooms(uid) || 'Друг'
}

function clearTimers() {
  if (ringTimer) clearTimeout(ringTimer)
  ringTimer = null
  if (statsTimer) clearInterval(statsTimer)
  statsTimer = null
  if (beatTimer) clearInterval(beatTimer)
  beatTimer = null
}

/** Разбор всего разговора: соединения, дорожки, звук и таймеры. */
function teardown() {
  clearTimers()
  stopRing()
  if (screen) screen.stop()
  screen = null
  if (session) session.close()
  session = null
  if (mic) mic.close()
  mic = null
  retries.clear()
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
 * Сессия разговора. Одна на оба вида: личный звонок — это её частный случай с
 * единственным собеседником.
 */
function openSession(): CallSession {
  const created = new CallSession({
    onSignal: (peerId, kind, data) => {
      const cur = st()
      void sendSignal(cur.callId, peerId, kind, data, { roomId: cur.roomId || undefined }).catch(() => {})
    },
    onPeer: (peerId, patch) => patchPart(peerId, patch as Partial<CallParticipant>),
    onLost: (peerId) => void recover(peerId),
  })
  session = created
  return created
}

function startStats() {
  if (statsTimer) return
  statsTimer = setInterval(() => {
    if (session) void session.pollQuality()
  }, 3000)
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
  startStats()
}

/**
 * Обрыв с одним собеседником. Одна попытка пересобрать соединение — чаще всего
 * виноват сменившийся адрес или уснувший Wi-Fi, и человеку незачем перезванивать.
 * В группе связь рвётся с одним, а не со всеми: остальные продолжают разговор.
 */
async function recover(peerId: string) {
  const cur = st()
  if (cur.status === 'idle' || !session) return
  const used = retries.get(peerId) || 0
  if (used >= RETRY_LIMIT) {
    if (cur.mode === 'dm') {
      showToast('Связь оборвалась', 'error')
      await finish('failed')
      return
    }
    showToast('Связь с ' + nickOf(peerId) + ' оборвалась', 'error')
    session.drop(peerId)
    patchPart(peerId, { connection: 'failed', speaking: false, level: 0 })
    return
  }
  retries.set(peerId, used + 1)
  if (cur.mode === 'dm') showToast('Связь пропала — восстанавливаем')
  await session.reconnect(peerId, politeFor(peerId))
  if (mic) await session.setMic(mic.track)
}

function politeFor(peerId: string): boolean {
  const cur = st()
  // В личке роль известна из самого звонка, в группе её задаёт порядок id —
  // обе стороны приходят к одному ответу без лишнего обмена.
  return cur.mode === 'dm' ? !amCaller : politeToward(myId, peerId)
}

/**
 * Состояние уходит каналом данных — он быстрее и не грузит сервер. Пока канал
 * не открылся, тот же флаг идёт сигналингом: иначе выключенный до соединения
 * микрофон отобразился бы у собеседника включённым.
 */
function shareFlags(flags: PeerFlags) {
  const cur = st()
  const missed = session ? session.sendFlags(flags) : cur.parts.map((p) => p.userId)
  for (const peerId of missed) {
    if (!cur.callId) continue
    void sendSignal(cur.callId, peerId, 'state', flags as Record<string, unknown>, {
      roomId: cur.roomId || undefined,
    }).catch(() => {})
  }
}

async function finish(reason: 'end' | 'decline' | 'cancel' | 'busy' | 'failed') {
  const cur = st()
  if (cur.status === 'idle') return
  if (cur.mode === 'room') {
    await leaveRoomVoice()
    return
  }
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
  cur.set({ ...IDLE, mode: 'dm', status: 'outgoing', callId, peerId, peerNick: nick })
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
  cur.set({ status: 'connecting', parts: [blankPart(cur.peerId, cur.peerNick)] })
  armConnectTimeout()
  // Соединение готово до ответа: предложение звонящего приходит следом, и
  // принять его должно уже собранное соединение.
  const s = openSession()
  await s.connect(cur.peerId, true)
  await s.setMic(chain.track)
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
  if (session) session.setDeafened(deafened)
  if (mic) mic.setMuted(muted)
  shareFlags({ muted, deafened })
}

export async function toggleScreen() {
  const cur = st()
  if (cur.status !== 'active' && cur.status !== 'connecting') return
  if (!session) return
  if (cur.sharing) {
    if (screen) screen.stop()
    screen = null
    await session.setScreen(null, null)
    shareFlags({ screen: false })
    cur.set({ sharing: false })
    return
  }
  if (!canShareScreen()) {
    showToast(screenErrorText(new Error('unsupported')), 'error')
    return
  }
  if (cur.mode === 'room' && !canShareScreenTo(cur.parts.length)) {
    showToast(
      'Показать экран можно, пока в разговоре не больше ' +
        (SCREEN_MAX_VIEWERS + 1) +
        ' человек — дальше картинка съест канал вместе с голосом',
      'error',
    )
    return
  }
  // Через ретранслятор картинка уходит каждому зрителю отдельным потоком и
  // оплачивается трафиком: в группе такой показ выключен намеренно.
  if (cur.mode === 'room' && cur.parts.length > 1 && (await iceConfig()).relayOnly) {
    showToast('Показ экрана в группе недоступен на этом соединении', 'error')
    return
  }
  try {
    const share = await shareScreen(storedScreenQuality())
    screen = share
    await session.setScreen(share.video, share.audio ?? null, share.fps)
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
  if (session) session.setVolume(pct)
}

/// Режим шумоподавления правит оба слоя сразу: наши ворота в обработке и
/// шумоподавление движка на самом захвате. Иначе «Выключен» глушил бы только
/// наш слой, а микрофон продолжал бы приседать на речи.
export function setCallNoise(mode: NoiseMode) {
  st().set({ noise: mode })
  if (!mic) return
  mic.setMode(mode)
  void mic.setProcessing(storedMicProcessing(), mode)
}

export function setCallMicGain(pct: number) {
  st().set({ micGain: pct })
  if (mic) mic.setGain(pct)
}

/// Обработку меняют посреди разговора — если движок не принял её на живой
/// дорожке, человек должен узнать об этом, а не гадать, почему ничего не изменилось.
export async function setCallProcessing(p: MicProcessing) {
  if (!mic) return
  const applied = await mic.setProcessing(p, st().noise)
  if (!applied) showToast('Настройка микрофона встанет со следующего звонка — эта уже идёт', 'ok')
}

interface VoiceReply {
  me?: string
  members?: VoiceMember[]
}

/**
 * Вход в голос группы. Это не дозвон: комната всегда открыта, человек заходит
 * в неё сам и видит, кто уже внутри. Позвать остальных можно отдельно —
 * звонить впятером «в трубку» значит держать четверых в ожидании ради одного.
 */
export async function joinRoomVoice(roomId: string, title: string) {
  const cur = st()
  if (cur.status !== 'idle') {
    if (cur.mode === 'room' && cur.roomId === roomId) return
    showToast('Сначала заверши текущий разговор', 'error')
    return
  }
  if (!callSupported()) {
    showToast('Звонки недоступны в этой сборке', 'error')
    return
  }
  cur.set({ ...IDLE, mode: 'room', status: 'connecting', callId: roomId, roomId, roomTitle: title })
  const chain = await openMicOrFail()
  if (!chain) {
    reset()
    return
  }
  mic = chain
  let reply: VoiceReply
  try {
    reply = await api<VoiceReply>('/friends/rooms/' + encodeURIComponent(roomId) + '/voice/join', {
      method: 'POST',
    })
  } catch (e) {
    reset()
    showToast(String((e as Error).message || e) || 'Не удалось войти в разговор', 'error')
    return
  }
  if (st().roomId !== roomId) return
  myId = reply.me || myId
  openSession()
  await session?.setMic(chain.track)
  st().set({ status: 'active', answeredAt: Date.now() })
  startStats()
  beatTimer = setInterval(() => void beatVoice(), VOICE_BEAT_MS)
  await applyRoster(roomId, reply.members || [])
}

async function beatVoice() {
  const cur = st()
  if (cur.mode !== 'room' || !cur.roomId) return
  try {
    const r = await api<VoiceReply>('/friends/rooms/' + encodeURIComponent(cur.roomId) + '/voice/beat', {
      method: 'POST',
      body: JSON.stringify({ muted: cur.muted, deafened: cur.deafened, screen: cur.sharing }),
    })
    await applyRoster(cur.roomId, r.members || [])
  } catch {
    // Один пропущенный удар ничего не решает: сервер ждёт три.
  }
}

export async function leaveRoomVoice() {
  const cur = st()
  const roomId = cur.roomId
  if (cur.mode !== 'room' || !roomId) return
  reset()
  startRing('ended')
  await api('/friends/rooms/' + encodeURIComponent(roomId) + '/voice/leave', { method: 'POST' }).catch(
    () => {},
  )
}

/** Позвать остальных участников группы в уже идущий разговор. */
export async function ringRoom(roomId: string) {
  try {
    const r = await api<{ called?: number }>(
      '/friends/rooms/' + encodeURIComponent(roomId) + '/voice/ring',
      { method: 'POST' },
    )
    showToast(r.called ? 'Позвали ' + r.called + ' чел.' : 'Все уже в разговоре')
  } catch {
    showToast('Не удалось позвать', 'error')
  }
}

/**
 * Состав разговора: с новыми — соединяемся, с ушедшими — рвём. Состав считает
 * сервер, поэтому решение «с кем я говорю» одно на всех участников.
 */
async function applyRoster(roomId: string, members: VoiceMember[]) {
  const cur = st()
  if (cur.mode !== 'room' || cur.roomId !== roomId || !session) return
  const others = members.filter((m) => m.userId !== myId)
  const before = cur.parts
  const known = new Map(before.map((p) => [p.userId, p]))
  cur.set({
    parts: others.map((m) => {
      const prev = known.get(m.userId)
      return prev
        ? { ...prev, muted: m.muted, sharing: prev.sharing || m.screen }
        : { ...blankPart(m.userId, nickOf(m.userId)), muted: m.muted }
    }),
  })
  for (const p of before) {
    if (!others.some((m) => m.userId === p.userId)) session.drop(p.userId)
  }
  for (const m of others) {
    if (session.has(m.userId)) continue
    retries.delete(m.userId)
    await session.connect(m.userId, politeToward(myId, m.userId))
  }
  if (mic) await session.setMic(mic.track)
}

async function onInvite(e: CallEvent) {
  const cur = st()
  if (cur.status !== 'idle') {
    await sendSignal(e.callId, e.from, 'busy', {}).catch(() => {})
    return
  }
  const nick = nickOf(e.from)
  amCaller = false
  cur.set({ ...IDLE, mode: 'dm', status: 'incoming', callId: e.callId, peerId: e.from, peerNick: nick })
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
  cur.set({ status: 'connecting', parts: [blankPart(cur.peerId, cur.peerNick)] })
  armConnectTimeout()
  const s = openSession()
  await s.connect(cur.peerId, false)
  if (mic) await s.setMic(mic.track)
}

function endedText(kind: CallEvent['kind']): string {
  if (kind === 'decline') return 'Звонок отклонён'
  if (kind === 'busy') return 'Собеседник уже разговаривает'
  if (kind === 'cancel') return 'Звонок отменён'
  return 'Звонок завершён'
}

/** Зовут в голос группы: показываем карточку, зайти можно одним нажатием. */
function onRing(e: CallEvent) {
  const cur = st()
  if (cur.status !== 'idle') return
  const roomId = String((e.data as { roomId?: string }).roomId || e.callId)
  const title = String((e.data as { title?: string }).title || 'группе')
  const nick = nickOf(e.from)
  startRing('incoming')
  setTimeout(stopRing, 4000)
  if (useGame.getState().list.length) {
    void overlayNotify({
      uid: e.from,
      nick,
      text: nick + ' зовёт в «' + title + '» — зайти можно в лаунчере',
      ts: Date.now(),
    }).catch(() => {})
    return
  }
  showToast(nick + ' зовёт в разговор «' + title + '»', 'ok', undefined, {
    label: 'Зайти',
    run: () => void joinRoomVoice(roomId, title),
  })
}

async function onRoomEvent(e: CallEvent, roomId: string) {
  const cur = st()
  if (e.kind === 'roster') {
    const members = ((e.data as { members?: VoiceMember[] }).members || []) as VoiceMember[]
    useRooms.getState().setVoice(roomId, members)
    if (cur.mode === 'room' && cur.roomId === roomId) await applyRoster(roomId, members)
    return
  }
  if (cur.mode !== 'room' || cur.roomId !== roomId || !session) return
  if (e.kind === 'state') {
    patchPart(e.from, peerStatePatch(e.data as PeerFlags))
    return
  }
  if (e.kind === 'offer' || e.kind === 'answer' || e.kind === 'ice') {
    // Предложение может прийти раньше состава: сервер рассылает его всем, но
    // порядок конвертов не гарантирован. Соединяемся под собеседника сразу.
    if (!session.has(e.from)) {
      st().set({ parts: partsOf().concat([blankPart(e.from, nickOf(e.from))]) })
      await session.connect(e.from, politeToward(myId, e.from))
      if (mic) await session.setMic(mic.track)
    }
    await session.accept(e.from, e.kind, e.data)
  }
}

function peerStatePatch(flags: PeerFlags): Partial<CallParticipant> {
  const patch: Partial<CallParticipant> = {}
  if (typeof flags.muted === 'boolean') {
    patch.muted = flags.muted
    if (flags.muted) {
      patch.level = 0
      patch.speaking = false
    }
  }
  if (typeof flags.screen === 'boolean') patch.sharing = flags.screen
  return patch
}

async function onEvent(e: CallEvent) {
  const cur = st()
  if (e.kind === 'ring') {
    onRing(e)
    return
  }
  const roomId = String((e.data as { roomId?: string }).roomId || '')
  if (roomId) {
    await onRoomEvent(e, roomId)
    return
  }
  if (e.kind === 'invite') {
    await onInvite(e)
    return
  }
  // Всё остальное относится только к текущему звонку: конверт из отменённого
  // разговора не должен трогать новый.
  if (cur.status === 'idle' || cur.mode !== 'dm' || cur.callId !== e.callId) return
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
    patchPart(cur.peerId, peerStatePatch(e.data as PeerFlags))
    return
  }
  if (!session) return
  if (e.kind === 'offer' || e.kind === 'answer' || e.kind === 'ice') {
    await session.accept(cur.peerId, e.kind, e.data)
  }
}

/// Соединение собралось — значит разговор идёт: в личке это и есть момент,
/// когда «соединяем» превращается в таймер.
useCall.subscribe((s) => {
  if (s.mode !== 'dm' || s.status !== 'connecting') return
  if (s.parts.some((p) => p.connection === 'connected')) markAnswered()
})

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
    const cur = st()
    if (cur.status === 'idle') return
    if (cur.mode === 'room') void leaveRoomVoice()
    else void finish('end')
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

/** Экран, который сейчас показывают: в группе он может быть не один. */
export function sharedScreens(parts: CallParticipant[]): CallParticipant[] {
  return parts.filter((p) => p.screen)
}

export const callQuality = (parts: CallParticipant[]): PeerQuality | null => {
  const known = parts.map((p) => p.quality).filter((q): q is PeerQuality => !!q)
  if (!known.length) return null
  // Показываем худшего: разговор ощущается по самой плохой связи в нём.
  return known.reduce((worst, q) => ((q.rttMs ?? 0) > (worst.rttMs ?? 0) ? q : worst))
}
