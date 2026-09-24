import { playSample, soundEnabled, soundVolume } from '../../lib/sound'

/**
 * Звук ударов по сундуку: нота нотного блока, каждая следующая выше по
 * пентатонике — как нарастание в Brawl Stars перед открытием. Синтез на
 * месте (WebAudio), без файлов: нот столько, сколько ударов, и они обязаны
 * идти ступенями. Громкость и «выключено» — общие настройки звука.
 */

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (!soundEnabled()) return null
  try {
    ctx = ctx || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Пентатоника от до второй октавы: 0 — первый удар. */
// Ноты — для тизера редкой вещи.
export const STEPS = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66]

function pling(freq: number, at: number, len: number, gain: number, type: OscillatorType = 'triangle') {
  const a = ac()
  if (!a) return
  const t = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  o.connect(g).connect(a.destination)
  o.start(t)
  o.stop(t + len + 0.02)
}

const level = () => (soundVolume() / 100) * 0.22

/** Удар номер `i` (с нуля): стук по дереву из Minecraft, каждый выше; с
 *  третьего — ещё и треск (владелец 24.09.2026: «звуки как в Minecraft»). */
export function hitSound(i: number) {
  playSample('chest_hit', 0.85 + i * 0.12)
  if (i >= 2) playSample('chest_crack', 1.1 + i * 0.05)
}

/** Сундук раскрылся: скрип крышки сундука Minecraft и искорка опыта. */
export function burstSound() {
  playSample('chest_open', 1)
  setTimeout(() => playSample('chest_card', 1.3), 180)
}

/** Вылет карточки: опыт; редкая — аметист; эпик — достижение; легенда — золото. */
export function cardSound(rank: number) {
  if (rank >= 4) {
    playSample('chest_gold', 1)
    setTimeout(() => playSample('chest_epic', 1), 120)
  } else if (rank >= 3) playSample('chest_epic', 1)
  else if (rank >= 2) playSample('chest_rare', 1.1)
  else playSample('chest_card', 1 + rank * 0.15)
}

/** Тизер эпической/легендарной: дрожащая нота перед показом. */
export function teaseSound() {
  const v = level()
  if (!v) return
  for (let k = 0; k < 6; k++) pling(k % 2 ? 880 : 932.33, k * 0.09, 0.12, v * 0.5, 'square')
}
