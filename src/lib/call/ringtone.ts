import { applyOutput } from '../audioDevices'
import { soundEnabled, soundVolume } from '../sound'

type Ring = 'incoming' | 'outgoing' | 'ended'

interface Pattern {
  notes: number[]
  /** Пауза между повторами; для одиночного сигнала повтора нет. */
  repeatMs: number
  gain: number
}

const PATTERNS: Record<Ring, Pattern> = {
  incoming: { notes: [880, 1174, 880, 1174], repeatMs: 2600, gain: 0.5 },
  outgoing: { notes: [523, 659], repeatMs: 3000, gain: 0.22 },
  ended: { notes: [659, 440], repeatMs: 0, gain: 0.28 },
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
    pattern.notes.forEach((hz, i) => {
      const at = ac.currentTime + i * 0.22
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(level, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
      osc.connect(gain)
      gain.connect(out)
      osc.start(at)
      osc.stop(at + 0.24)
    })
  }
  play()
  if (pattern.repeatMs) timer = setInterval(play, pattern.repeatMs)
  // Одиночный сигнал сам за собой убирает: держать контекст открытым незачем.
  else setTimeout(stopRing, 1200)
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
