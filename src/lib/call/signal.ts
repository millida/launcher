import { api, hasMillidaAccount } from '../api'

export type CallSignalKind =
  | 'invite'
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'end'
  | 'busy'
  | 'offer'
  | 'answer'
  | 'ice'
  | 'state'

export interface CallEvent {
  seq: number
  callId: string
  from: string
  kind: CallSignalKind
  data: Record<string, unknown>
  ts: number
}

export interface CallSignalOptions {
  seconds?: number
}

export async function sendSignal(
  callId: string,
  peerId: string,
  kind: CallSignalKind,
  data?: Record<string, unknown>,
  opts?: CallSignalOptions,
): Promise<void> {
  await api('/friends/call/signal', {
    method: 'POST',
    body: JSON.stringify({ callId, peerId, kind, data: data || {}, seconds: opts?.seconds }),
  })
}

const CURSOR_KEY = 'm-call-cursor'

/// Сервер держит запрос до первого конверта, поэтому пауза между попытками
/// нужна только когда он отвечает ошибкой — иначе это была бы петля запросов.
const RETRY_MS = 3000

interface Pump {
  stop: () => void
}

/**
 * Приём сигналинга. Запрос висит на сервере до события, поэтому звонок звенит
 * сразу, а простаивающий лаунчер не опрашивает API вхолостую.
 *
 * Курсор переживает перезапуск: иначе после обновления лаунчера в ящик снова
 * прилетели бы уже обработанные конверты завершённого звонка.
 */
export function startSignalPump(onEvent: (e: CallEvent) => void): Pump {
  let stopped = false
  let cursor = Number(localStorage.getItem(CURSOR_KEY)) || 0

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // Цикл держится на ожидании ответа, а не на таймере: в свёрнутом окне таймеры
  // замедляются до минуты, и звонок во время игры пришёл бы с опозданием.
  const loop = async () => {
    while (!stopped) {
      if (!hasMillidaAccount()) {
        await pause(RETRY_MS)
        continue
      }
      try {
        const r = await api<{ cursor?: number; events?: CallEvent[] }>('/friends/call/poll?after=' + cursor)
        if (stopped) return
        if (typeof r.cursor === 'number') {
          cursor = r.cursor
          localStorage.setItem(CURSOR_KEY, String(cursor))
        }
        ;(r.events || []).forEach((e) => {
          try {
            onEvent(e)
          } catch {
            // Один сбойный конверт не должен обрывать приём остальных.
          }
        })
      } catch {
        await pause(RETRY_MS)
      }
    }
  }

  void loop()
  return {
    stop: () => {
      stopped = true
    },
  }
}

export function newCallId(): string {
  const raw = new Uint8Array(12)
  crypto.getRandomValues(raw)
  return Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('')
}
