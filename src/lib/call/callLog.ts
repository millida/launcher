export const CALL_LOG_PREFIX = '⟪call⟫'

export type CallOutcome = 'done' | 'missed' | 'declined' | 'canceled' | 'failed'

export interface CallLog {
  outcome: CallOutcome
  seconds: number
}

const OUTCOMES: CallOutcome[] = ['done', 'missed', 'declined', 'canceled', 'failed']

/**
 * Итог звонка приходит обычным сообщением переписки с меткой в тексте — так же,
 * как приглашение на сервер (`invite.ts`). Пишет её сервер
 * (`friends/calls/call-log.ts` в trade-api), лаунчер только читает.
 */
export function parseCallLog(text: string): CallLog | null {
  if (!text || !text.startsWith(CALL_LOG_PREFIX)) return null
  try {
    const o: unknown = JSON.parse(text.slice(CALL_LOG_PREFIX.length))
    const raw = o as { outcome?: unknown; seconds?: unknown }
    const outcome = OUTCOMES.find((x) => x === raw.outcome)
    if (!outcome) return null
    const seconds = Number(raw.seconds)
    return { outcome, seconds: Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0 }
  } catch {
    return null
  }
}

export function callLogTitle(log: CallLog, mine: boolean): string {
  if (log.outcome === 'done') return mine ? 'Исходящий звонок' : 'Входящий звонок'
  if (log.outcome === 'declined') return mine ? 'Звонок отклонён' : 'Ты отклонил звонок'
  if (log.outcome === 'failed') return 'Звонок сорвался'
  return mine ? 'Не дозвонился' : 'Пропущенный звонок'
}
