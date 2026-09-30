import { create } from 'zustand'
import {
  MILLI_PLANS,
  milliEnhancedOn,
  milliError,
  milliLimits,
  milliSend,
  milliSession,
  milliSessions,
  milliStatus,
  refineMilliError,
  withPreset,
} from '../lib/milli'
import type { MilliError, MilliMessage, MilliPlans, MilliSessionHead, MilliStatus } from '../lib/milli'
import type { AiPreset } from '../lib/aiBuilder'
import type { MilliMode } from '../components/milli/milliMascot'
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
export async function refreshMilliPlans(): Promise<void> {
  if (plansLoaded) return
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

export async function openMilliSession(id: string) {
  set({ view: 'chat', pending: true, error: null, messages: [], sessionId: id, mood: 'think' })
  try {
    const s = await milliSession(id)
    if (get().sessionId !== id) return
    set({ messages: s.messages ?? [], pending: false, mood: 'idle' })
  } catch (e) {
    if (get().sessionId !== id) return
    set({ pending: false, mood: 'idle', error: milliError(e), sessionId: null })
  }
}

let localSeq = 0

export async function sendMilli(raw: string) {
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
  // Только длина — сам текст не уходит.
  track('catalog_search', { section: 'milli', len: text.length, first: first ? 1 : 0 })
  const sid = st.sessionId
  try {
    const r = await milliSend(sent, sid, milliEnhancedOn(get().status, get().enhanced))
    if (get().sessionId !== sid) return
    set((s) => ({
      sessionId: r.sessionId,
      messages: [...s.messages.filter((m) => m.id !== local.id), r.user, r.reply],
      status: r.status ?? s.status,
      pending: false,
      preset: null,
    }))
    react(!!r.reply.pack)
  } catch (e) {
    if (get().sessionId !== sid) return
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

export function retryMilli() {
  const { failedText, failedId } = get()
  if (!failedText) return
  set((s) => ({ messages: s.messages.filter((m) => m.id !== failedId), failedId: '' }))
  void sendMilli(failedText)
}
