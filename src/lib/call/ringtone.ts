import { applyOutput } from '../audioDevices'
import { soundEnabled, soundVolume } from '../sound'

type Ring = 'incoming' | 'outgoing' | 'ended'

/** Нота мелодии: частота, когда вступает (с) и сколько звучит (с). */
type Note = [hz: number, at: number, len: number]

interface Pattern {
  notes: Note[]
  /** Пауза между повторами; для одиночного сигнала повтора нет. */
  repeatMs: number
  gain: number
}

/*
 * Мелодии звонка (владелец 12.10.2026: «звонки отстойные, сделай красиво»). Тембр —
 * «маримба»: треугольник с быстрым затуханием и тихой октавой сверху, вместо писка синуса.
 *  - входящий: восходящая фраза в до-мажорной пентатонике и ответ на неё, повтор раз в 3 с;
 *  - исходящий: два мягких гудка квинтой, тихо — их слышит только звонящий;
 *  - конец разговора: три ноты вниз.
 */
const E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, C5 = 523.25, G4 = 392, D5 = 587.33
const PATTERNS: Record<Ring, Pattern> = {
  incoming: {
    notes: [
      [E5, 0, 0.32], [G5, 0.16, 0.32], [C6, 0.32, 0.36], [E6, 0.48, 0.6],
      [D6, 0.96, 0.32], [C6, 1.12, 0.32], [A5, 1.28, 0.36], [C6, 1.44, 0.8],
    ],
    repeatMs: 3000,
    gain: 0.5,
  },
  outgoing: { notes: [[G4, 0, 0.7], [D5, 0, 0.7], [G4, 0.9, 0.7], [D5, 0.9, 0.7]], repeatMs: 3400, gain: 0.2 },
  ended: { notes: [[C6, 0, 0.3], [G5, 0.16, 0.3], [C5, 0.32, 0.6]], repeatMs: 0, gain: 0.3 },
}

const audioCtor = (): typeof AudioContext =>
  window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

let ctx: AudioContext | null = null
let el: HTMLAudioElement | null = null
let dest: MediaStreamAudioDestinationNode | null = null
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Звонок и гудки. Идут через выбранное устройство вывода, а не мимо него:
 * человек, слушающий игру в наушниках, иначе не услышал бы вызов.
 */
export function startRing(kind: Ring) {
  stopRing()
  if (!soundEnabled()) return
  const pattern = PATTERNS[kind]
  const level = Math.max(0, Math.min(1, (soundVolume() / 100) * pattern.gain))
  if (level <= 0) return
  try {
    ctx = new (audioCtor())()
    dest = ctx.createMediaStreamDestination()
    el = document.createElement('audio')
    el.autoplay = true
    el.srcObject = dest.stream
    void applyOutput(el).then(() => el?.play().catch(() => {}))
  } catch {
    return
  }
  const play = () => {
    const ac = ctx
    const out = dest
    if (!ac || !out) return
    for (const [hz, start, len] of pattern.notes) {
      const at = ac.currentTime + 0.02 + start
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(level, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + len)
      gain.connect(out)
      // Основной тон и тихая октава сверху — «деревянный» удар вместо чистого писка.
      for (const [mult, type, vol] of [[1, 'triangle', 1], [2, 'sine', 0.28]] as const) {
        const osc = ac.createOscillator()
        const part = ac.createGain()
        osc.type = type
        osc.frequency.value = hz * mult
        part.gain.value = vol
        osc.connect(part)
        part.connect(gain)
        osc.start(at)
        osc.stop(at + len + 0.05)
      }
    }
  }
  play()
  if (pattern.repeatMs) timer = setInterval(play, pattern.repeatMs)
  // Одиночный сигнал сам за собой убирает: держать контекст открытым незачем.
  else setTimeout(stopRing, 1500)
}

export function stopRing() {
  if (timer) clearInterval(timer)
  timer = null
  if (el) {
    el.pause()
    el.srcObject = null
    el = null
  }
  const ac = ctx
  ctx = null
  dest = null
  if (ac) void ac.close().catch(() => {})
}
