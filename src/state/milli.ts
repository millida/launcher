import { create } from 'zustand'
import {
  MILLI_PLANS,
  milliEnhancedOn,
  milliError,
  milliCancel,
  milliGreeting,
  milliLimits,
  milliPackById,
  milliPc,
  milliProgress,
  milliSend,
  milliSession,
  milliSessions,
  milliStatus,
  refineMilliError,
  withPreset,
} from '../lib/milli'
import type { MilliError, MilliGreeting, MilliGreetingChip, MilliMessage, MilliPack, MilliPlans, MilliProgressEvent, MilliSessionHead, MilliStatus } from '../lib/milli'
import { benchBuildId, benchSettled, setBenchProgress, useBench } from './milliBench'
import type { BenchStage } from './milliBench'
import type { AiPreset } from '../lib/aiBuilder'
import type { MilliMode } from '../components/milli/milliMascot'
import { emotionFor, milliEmote, milliHear } from '../components/milli/milliEmotions'
import { hasMillidaAccount } from '../lib/api'
import { track } from '../lib/telemetry'

/*
 * Чат с Милли: одно состояние на весь лаунчер — кнопка в каталоге и панель
 * чата читают его. Запросы без входа в аккаунт
 * Millida не уходят: панель показывает «Войди в аккаунт».
 */

export type MilliView = 'chat' | 'history'

interface MilliState {
  open: boolean
  view: MilliView
  status: MilliStatus | null
  /** Тарифы из публичного `/catalog/milli/limits` — цифры в предложении PLUS. */
  plans: MilliPlans
  sessionId: string | null
  messages: MilliMessage[]
  pending: boolean
  error: MilliError | null
  /** Текст запроса, который упал: «Повторить» шлёт его снова. */
  failedText: string
  failedId: string
  history: MilliSessionHead[] | null
  historyFailed: boolean
  /** Версия и загрузчик из «Новой сборки» — дописываются к первому сообщению. */
  preset: AiPreset | null
  mood: MilliMode
  /** Растёт при каждом открытии извне: поле ввода берёт фокус. */
  focusSeq: number
  /** «Улучшенная сборка» (PLUS) — выбор игрока, помнится между запусками. */
  enhanced: boolean
  /** Отменённый запрос: поле ввода забирает текст обратно, когда растёт seq. */
  restore: { text: string; seq: number }
}

const ENHANCED_KEY = 'milli-enhanced'

function readEnhanced(): boolean {
  try {
    return localStorage.getItem(ENHANCED_KEY) === '1'
  } catch {
    return false
  }
}

export const useMilli = create<MilliState>(() => ({
  open: false,
  view: 'chat',
  status: null,
  plans: MILLI_PLANS,
  sessionId: null,
  messages: [],
  pending: false,
  error: null,
  failedText: '',
  failedId: '',
  history: null,
  historyFailed: false,
  preset: null,
  mood: 'idle',
  focusSeq: 0,
  enhanced: readEnhanced(),
  restore: { text: '', seq: 0 },
}))

const set = useMilli.setState
const get = useMilli.getState

let moodTimer: ReturnType<typeof setTimeout> | undefined

export function setMilliEnhanced(v: boolean) {
  try {
    if (v) localStorage.setItem(ENHANCED_KEY, '1')
    else localStorage.removeItem(ENHANCED_KEY)
  } catch {}
  set({ enhanced: v })
}

/** Ответ пришёл: Милли говорит ~2 с, со сборкой — потом радуется. */
function react(withPack: boolean) {
  clearTimeout(moodTimer)
  set({ mood: 'talk' })
  moodTimer = setTimeout(() => {
    if (!withPack) {
      set({ mood: 'idle' })
      return
    }
    set({ mood: 'happy' })
    moodTimer = setTimeout(() => set({ mood: 'idle' }), 2600)
  }, 2000)
}

let plansLoaded = false

/** Тарифы без входа: один раз за запуск, упал — спросим при следующем открытии. */
export async function refreshMilliPlans(force = false): Promise<void> {
  if (plansLoaded && !force) return
  plansLoaded = true
  try {
    set({ plans: await milliLimits() })
  } catch {
    plansLoaded = false
  }
}

export async function refreshMilliStatus(): Promise<MilliStatus | null> {
  if (!hasMillidaAccount()) return null
  try {
    const status = await milliStatus()
    set({ status })
    // Тарифная сетка могла смениться (новый сервер, смена тарифа) — перечитываем вместе со статусом.
    void refreshMilliPlans(true)
    return status
  } catch {
    return null
  }
}

/** `src` — откуда открыли; клики и так считает data-track, здесь только для чтения кода. */
export function openMilli(opts: { text?: string; preset?: AiPreset | null; src?: string } = {}) {
  set((s) => ({
    open: true,
    view: 'chat',
    focusSeq: s.focusSeq + 1,
    ...(opts.preset !== undefined ? { preset: opts.preset && (opts.preset.mcVersion || opts.preset.loader) ? opts.preset : null } : {}),
  }))
  void refreshMilliStatus()
  void refreshMilliPlans()
  const text = opts.text?.trim()
  if (text) void sendMilli(text)
}

export function closeMilli() {
  set({ open: false })
}

export function newMilliChat() {
  turnSeq++
  pendingLocal = null
  stopProgress()
  useBench.getState().setHead(null)
  clearTimeout(moodTimer)
  set((s) => ({ view: 'chat', sessionId: null, messages: [], error: null, failedText: '', pending: false, mood: 'idle', focusSeq: s.focusSeq + 1 }))
}

export async function showMilliHistory() {
  set({ view: 'history', historyFailed: false })
  try {
    const r = await milliSessions()
    set({ history: Array.isArray(r?.items) ? r.items : [] })
  } catch {
    set({ historyFailed: true })
  }
}

/** Голова сессии: полный пакет из сообщений или отдельным запросом (у старых сообщений — stub). */
export function sessionHead(messages: MilliMessage[], head?: string): MilliPack | null {
  const full = messages.filter((m) => m.pack && !m.pack.stub).map((m) => m.pack!)
  if (head) return full.find((p) => p.buildId === head) ?? null
  return full[full.length - 1] ?? null
}

export async function openMilliSession(id: string) {
  set({ view: 'chat', pending: true, error: null, messages: [], sessionId: id, mood: 'think' })
  useBench.getState().setHead(null)
  try {
    const s = await milliSession(id)
    if (get().sessionId !== id) return
    const messages = s.messages ?? []
    set({ messages, pending: false, mood: 'idle' })
    const head = sessionHead(messages, s.head)
    if (head) useBench.getState().setHead(head)
    else if (s.head) {
      const want = s.head
      void milliPackById(want)
        .then((p) => {
          if (get().sessionId === id && !useBench.getState().head) useBench.getState().setHead(p)
        })
        .catch(() => {})
    }
  } catch (e) {
    if (get().sessionId !== id) return
    set({ pending: false, mood: 'idle', error: milliError(e), sessionId: null })
  }
}

/** Приветствие пустого чата (без модели); null — сервер не умеет или сбой, тогда запасной текст. */
export function loadMilliGreeting(): Promise<MilliGreeting | null> {
  return milliGreeting().catch(() => null)
}

/** Кнопка приветствия: «Улучшить «…»» сначала открывает тот разговор, потом пишет Милли. */
export async function pickMilliGreeting(chip: MilliGreetingChip) {
  const text = chip.text || chip.label
  if (chip.sessionId) {
    await openMilliSession(chip.sessionId)
    const st = get()
    if (st.sessionId !== chip.sessionId || st.error) return
  }
  await sendMilli(text)
}

let localSeq = 0
/** Номер текущего хода: отмена его сдвигает, и опоздавший ответ отбрасывается. */
let turnSeq = 0
let pendingLocal: { id: string; text: string } | null = null
/** Ход, чей запрос реально ушёл на сервер: только его «Стоп» отменяет и там. */
let sentTurn = 0

/** Запомненный размер сборки (ставит MilliSizePick, ключ общий с FE-tabs). */
export const MILLI_SIZE_KEY = 'm-milli-size'

function savedSize(): number | null {
  try {
    const n = Number(localStorage.getItem(MILLI_SIZE_KEY))
    return Number.isFinite(n) && n >= 10 && n <= 400 ? Math.round(n) : null
  } catch {
    return null
  }
}

export interface SendMilliOpts {
  /** Размер из чипа «Сколько модов взять?» — главнее запомненного. */
  size?: number
}

export async function sendMilli(raw: string, opts: SendMilliOpts = {}) {
  const text = raw.trim()
  const st = get()
  if (!text || st.pending) return
  if (!hasMillidaAccount()) {
    set({ error: milliError('http 401'), failedText: text })
    return
  }
  const first = !st.sessionId && !st.messages.length
  const sent = first ? withPreset(text, st.preset) : text
  const local: MilliMessage = {
    id: 'local-' + ++localSeq,
    role: 'user',
    text: sent,
    createdAt: new Date().toISOString(),
    pack: null,
    suggestions: [],
  }
  clearTimeout(moodTimer)
  set((s) => ({ messages: [...s.messages, local], pending: true, error: null, failedText: '', mood: 'think' }))
  // Милли откликается на тон игрока (спасибо → сердечки, «вылетает» → сочувствие), потом думает.
  milliHear(text)
  // Только длина — сам текст не уходит.
  track('catalog_search', { section: 'milli', len: text.length, first: first ? 1 : 0 })
  const sid = st.sessionId
  const turn = ++turnSeq
  pendingLocal = { id: local.id, text }
  startProgress(sid, turn)
  try {
    // Клики верстака сначала доезжают до сервера: Милли правит то, что видит игрок.
    await benchSettled()
    if (turn !== turnSeq || get().sessionId !== sid) return
    const buildId = sid ? benchBuildId() : null
    // Размер — только для новой сборки: правку существующей Милли делает по её составу.
    const size = opts.size ?? (buildId ? null : savedSize())
    // Запомненный размер — лишь привычка: «на оптимизацию» или «для слабого ПК» в тексте сервер ставит выше.
    const sizeSaved = opts.size == null && size != null
    const pc = await milliPc()
    // Факты о выбранной сборке (графика, бэкапы, дневник, доктор); сбой — без них.
    const facts = await import('../lib/milliLocal')
      .then(async (m) => m.gatherFacts((await import('./profiles')).selectedProfile()))
      .catch(() => null)
    if (turn !== turnSeq || get().sessionId !== sid) return
    sentTurn = turn
    // Сбой связи или модели — тихо повторяем (игрок видит только «печатает»); ошибка — после 3 попыток.
    let r: Awaited<ReturnType<typeof milliSend>> | null = null
    for (let attempt = 0; ; attempt++) {
      try {
        r = await milliSend(sent, sid, milliEnhancedOn(get().status, get().enhanced), { buildId, size, sizeSaved, pc, local: facts })
        break
      } catch (e) {
        const kind = milliError(e).kind
        if (attempt >= 2 || (kind !== 'failed' && kind !== 'offline' && kind !== 'busy')) throw e
        await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)))
        if (turn !== turnSeq || get().sessionId !== sid) return
      }
    }
    if (turn !== turnSeq || get().sessionId !== sid) return
    pendingLocal = null
    stopProgress()
    if (r.reply.pack && !r.reply.pack.stub) useBench.getState().setHead(r.reply.pack)
    set((s) => ({
      sessionId: r.sessionId,
      messages: [...s.messages.filter((m) => m.id !== local.id), r.user, r.reply],
      status: r.status ?? s.status,
      pending: false,
      preset: null,
    }))
    react(!!r.reply.pack)
    // Сборка готова или поправлена — Милли радуется по-своему (танец / гордость), после «говорит».
    if (r.reply.pack && !r.reply.pack.stub) {
      const emo = emotionFor({ intent: buildId ? 'edit' : 'build', outcome: 'ok' })
      window.setTimeout(() => milliEmote(emo), 2200)
    }
  } catch (e) {
    if (turn !== turnSeq || get().sessionId !== sid) return
    pendingLocal = null
    stopProgress()
    let error = milliError(e)
    const status = error.kind === 'auth' ? null : await refreshMilliStatus()
    error = refineMilliError(error, status)
    // Вопрос остаётся на экране; «Повторить» уберёт его и спросит заново.
    set({
      pending: false,
      error,
      failedText: text,
      failedId: local.id,
      mood: 'idle',
    })
    track('catalog_search', { section: 'milli', err: error.kind }, { ok: false })
  }
}

/**
 * «Стоп» во время сборки: вопрос уходит из ленты обратно в поле ввода, ответ,
 * если всё же придёт, отбрасывается, сервер отменяет ход и возвращает попытку
 * (`/messages/cancel`; старый API — 404, это не ошибка).
 */
export function cancelMilli() {
  if (!get().pending) return
  // Запрос ещё не ушёл (ждали клики верстака) — отмена только здесь: серверный
  // cancel без идущего хода удалил бы прошлый сохранённый ответ.
  const sent = sentTurn === turnSeq
  turnSeq++
  const back = pendingLocal
  pendingLocal = null
  stopProgress()
  if (sent) {
    void milliCancel(get().sessionId)
      .then(() => refreshMilliStatus())
      .catch(() => {})
  }
  clearTimeout(moodTimer)
  set((s) => ({
    pending: false,
    mood: 'idle',
    messages: back ? s.messages.filter((m) => m.id !== back.id) : s.messages,
    restore: back ? { text: back.text, seq: s.restore.seq + 1 } : s.restore,
    focusSeq: s.focusSeq + 1,
  }))
  track('catalog_search', { section: 'milli', cancel: 1 })
}

export function retryMilli() {
  const { failedText, failedId } = get()
  if (!failedText) return
  set((s) => ({ messages: s.messages.filter((m) => m.id !== failedId), failedId: '' }))
  void sendMilli(failedText)
}

// ─── Прогресс хода: long-poll /progress ──────────────────────────────────────

/** Ход, для которого идёт опрос (0 — нет). */
let progressTurn = 0

/** События → этапы: последнее состояние каждого ключа, в порядке появления. */
export function mergeStages(stages: BenchStage[], events: MilliProgressEvent[]): BenchStage[] {
  const out = [...stages]
  for (const e of events) {
    if (e.key === 'done') continue
    const st: BenchStage = { key: e.key, labelRu: e.labelRu, done: e.done, total: e.total, at: e.seq,
      ...(e.sample?.length ? { sample: e.sample.slice(0, 12) } : {}),
      ...(typeof e.found === 'number' ? { found: e.found } : {}),
      ...(typeof e.checked === 'number' ? { checked: e.checked } : {}),
    }
    const i = out.findIndex((x) => x.key === e.key)
    if (i >= 0) out[i] = st
    else out.push(st)
  }
  return out
}

function startProgress(sid: string | null, turn: number) {
  progressTurn = turn
  setBenchProgress([])
  void (async () => {
    let after = 0
    let fails = 0
    let stages: BenchStage[] = []
    // Первый вопрос — не сразу: короткий ход обходится без опроса.
    await new Promise((r) => setTimeout(r, 250))
    while (progressTurn === turn && fails < 3) {
      const started = Date.now()
      try {
        const r = await milliProgress(get().sessionId ?? sid ?? '', after)
        if (progressTurn !== turn) return
        fails = 0
        const evs = Array.isArray(r?.events) ? r.events : []
        if (evs.length) {
          after = Math.max(after, ...evs.map((e) => e.seq))
          stages = mergeStages(stages, evs)
          setBenchProgress(stages)
        }
      } catch {
        fails++
      }
      // Long-poll отвечает сам; на мгновенный ответ (старый API, демо) — пауза.
      const spent = Date.now() - started
      if (spent < 400) await new Promise((r) => setTimeout(r, 400 - spent))
    }
  })()
}

function stopProgress() {
  progressTurn = 0
  setBenchProgress([])
}

/** «Дополнить»/«Изменить» у плана: поле ввода берёт текст и фокус (тот же канал, что «Стоп»). */
export function prefillMilli(text: string) {
  set((s) => ({ restore: { text, seq: s.restore.seq + 1 } }))
}
