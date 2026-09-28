import { api, hasMillidaAccount } from '../api'
import { isRealtimeLive, onRealtimeData, onRealtimeLiveChange } from '../realtime'
import { createEnvelopeLog, pushedEnvelope } from './envelopes'

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
  /// Заводит сервер: состав голосовой комнаты и приглашение в неё.
  | 'roster'
  | 'ring'

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
  /** Разговор в группе: право на конверт даёт общий голос комнаты, а не дружба. */
  roomId?: string
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
    body: JSON.stringify({
      callId,
      peerId,
      kind,
      data: data || {},
      seconds: opts?.seconds,
      roomId: opts?.roomId,
    }),
  })
}

const CURSOR_KEY = 'm-call-cursor'

/// Сервер держит запрос до первого конверта, а при живом сокете лаунчер не
/// опрашивает вовсе, поэтому пауза нужна только после ошибки.
const RETRY_MS = 3000

interface Pump {
  stop: () => void
}

/**
 * Приём сигналинга. При живом сокете конверты приходят в нём самом, и лаунчер
 * ходит в ящик только догнать пропущенное: при старте и после переподключения.
 * Без сокета запрос висит на сервере до события, поэтому звонок всё равно звенит сразу.
 *
 * Курсор переживает перезапуск: иначе после обновления лаунчера в ящик снова
 * прилетели бы уже обработанные конверты завершённого звонка.
 */
export function startSignalPump(onEvent: (e: CallEvent) => void): Pump {
  let stopped = false
  let cursor = Number(localStorage.getItem(CURSOR_KEY)) || 0
  let catchUp = true
  let wake: (() => void) | null = null
  const log = createEnvelopeLog()

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const nudge = () => {
    const fn = wake
    wake = null
    fn?.()
  }

  const deliver = (e: CallEvent) => {
    if (!log.admit(e)) return
    if (e.seq > cursor) {
      cursor = e.seq
      localStorage.setItem(CURSOR_KEY, String(cursor))
    }
    try {
      onEvent(e)
    } catch {
      // Один сбойный конверт не должен обрывать приём остальных.
    }
  }

  const offPush = onRealtimeData('calls', (data) => {
    const pushed = pushedEnvelope(data)
    if (pushed) {
      deliver(pushed)
      return
    }
    catchUp = true
    nudge()
  })
  const offLive = onRealtimeLiveChange(() => {
    catchUp = true
    nudge()
  })

  // Цикл держится на ожидании ответа, а не на таймере: в свёрнутом окне таймеры
  // замедляются до минуты, и звонок во время игры пришёл бы с опозданием.
  const loop = async () => {
    while (!stopped) {
      if (!hasMillidaAccount()) {
        await pause(RETRY_MS)
        continue
      }
      const live = isRealtimeLive()
      if (live && !catchUp) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      catchUp = false
      try {
        const r = await api<{ cursor?: number; events?: CallEvent[] }>(
          '/friends/call/poll?after=' + cursor + (live ? '&wait=0' : ''),
        )
        if (stopped) return
        ;(r.events || []).forEach(deliver)
        if (typeof r.cursor === 'number') {
          cursor = r.cursor
          localStorage.setItem(CURSOR_KEY, String(cursor))
        }
      } catch {
        catchUp = true
        await pause(RETRY_MS)
      }
    }
  }

  void loop()
  return {
    stop: () => {
      stopped = true
      offPush()
      offLive()
      nudge()
    },
  }
}

export function newCallId(): string {
  const raw = new Uint8Array(12)
  crypto.getRandomValues(raw)
  return Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('')
}
