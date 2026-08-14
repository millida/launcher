/**
 * Обработка микрофона до отправки собеседнику: шумоподавление, усиление и мут.
 *
 * Код процессора живёт строкой и подключается через blob — свой файл потребовал
 * бы `script-src` пошире, а он в лаунчере закреплён тестом (`csp_still_blocks_
 * injected_and_remote_scripts` в src-tauri/src/lib.rs). Шумоподавления на
 * WebAssembly по той же причине здесь нет: ему нужен 'wasm-unsafe-eval'.
 *
 * Что делает: движущаяся оценка уровня шума и расширитель с гистерезисом —
 * между фразами тишина, речь проходит целиком. Постоянный гул (вентилятор,
 * кулер) снимает собственное шумоподавление движка (`noiseSuppression` в ограничениях
 * микрофона), эти два уровня складываются.
 */
export const MIC_PROCESSOR = 'millida-mic'

export type NoiseMode = 'off' | 'standard' | 'strong'

export interface MicTuning {
  /** Во сколько раз сигнал должен превысить оценку шума, чтобы открыть ворота. */
  open: number
  /** Нижняя граница порога: в полной тишине оценка шума стремится к нулю. */
  floor: number
  /** Что остаётся от сигнала при закрытых воротах: полный ноль звучит как обрыв. */
  residual: number
}

export const MIC_TUNING: Record<NoiseMode, MicTuning> = {
  off: { open: 0, floor: 0, residual: 1 },
  standard: { open: 2.2, floor: 0.0055, residual: 0.06 },
  strong: { open: 3.6, floor: 0.011, residual: 0 },
}

export const NOISE_MODE_KEY = 'm-call-noise'

export function storedNoiseMode(): NoiseMode {
  const v = localStorage.getItem(NOISE_MODE_KEY)
  return v === 'off' || v === 'strong' || v === 'standard' ? v : 'standard'
}

export const setStoredNoiseMode = (mode: NoiseMode) => localStorage.setItem(NOISE_MODE_KEY, mode)

export const MIC_GAIN_KEY = 'm-call-mic-gain'

/** Усиление микрофона в процентах: 100 — как есть. */
export function storedMicGain(): number {
  const v = parseInt(localStorage.getItem(MIC_GAIN_KEY) || '100', 10)
  return Number.isFinite(v) ? Math.max(0, Math.min(300, v)) : 100
}

export const setStoredMicGain = (pct: number) =>
  localStorage.setItem(MIC_GAIN_KEY, String(Math.max(0, Math.min(300, Math.round(pct)))))

export interface GateState {
  /** Текущая оценка уровня шума. */
  noise: number
  /** Насколько ворота открыты: 0 — тишина, 1 — сигнал проходит целиком. */
  gate: number
  /** Сколько блоков ворота ещё держатся открытыми после конца фразы. */
  hold: number
}

/**
 * Один шаг расширителя. Функция замкнута на себя намеренно: её текст
 * подставляется в исходник процессора, поэтому обращений к чему-либо снаружи в
 * ней быть не может. Так шумоподавление остаётся в одном экземпляре и при этом
 * проверяется обычным тестом — внутри AudioWorklet тестов не бывает.
 */
export function micGateStep(
  s: GateState,
  rms: number,
  open: number,
  floor: number,
  residual: number,
): GateState {
  // Оценка шума растёт только пока ворота закрыты. Иначе долгий ровный звук —
  // затянутая нота, шум игры, музыка — сам поднимет оценку до своего уровня и
  // будет срезан на середине.
  const adapt = rms < s.noise ? 0.08 : s.gate > 0.5 ? 0 : 0.0006
  const noise = s.noise + (rms - s.noise) * adapt
  if (open <= 0) return { noise, gate: 1, hold: 0 }
  const openAt = Math.max(noise * open, floor)
  const closeAt = openAt * 0.6
  let hold = s.hold
  let target = residual
  if (rms > openAt) {
    // 90 блоков по 128 сэмплов — около четверти секунды: пауза внутри фразы не
    // должна захлопывать ворота.
    hold = 90
    target = 1
  } else if (rms > closeAt && s.gate > 0.5) {
    target = 1
  } else if (hold > 0) {
    hold = hold - 1
    target = 1
  }
  // Ворота едут плавно: мгновенное переключение слышно щелчком.
  const speed = target > s.gate ? 0.35 : 0.06
  return { noise, gate: s.gate + (target - s.gate) * speed, hold }
}

const SOURCE = `
const micGateStep = ${micGateStep.toString()}
class MillidaMic extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.tune = o.tune || { open: 0, floor: 0, residual: 1 }
    this.gain = typeof o.gain === 'number' ? o.gain : 1
    this.muted = !!o.muted
    this.state = { noise: 0.01, gate: 0, hold: 0 }
    this.peak = 0
    this.blocks = 0
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.tune) this.tune = d.tune
      if (typeof d.gain === 'number') this.gain = d.gain
      if (typeof d.muted === 'boolean') this.muted = d.muted
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!output) return true
    if (!input) {
      output.fill(0)
      return true
    }
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / input.length)

    const t = this.tune
    this.state = micGateStep(this.state, rms, t.open, t.floor, t.residual)
    const amp = (this.muted ? 0 : this.gain) * this.state.gate
    for (let i = 0; i < input.length; i++) output[i] = input[i] * amp

    if (rms > this.peak) this.peak = rms
    // Уровень уходит наверх примерно раз в сотую долю секунды: чаще индикатору
    // не нужно, а каждое сообщение — это работа основного потока.
    if (++this.blocks >= 40) {
      this.port.postMessage({ level: this.peak, open: this.state.gate > 0.5 })
      this.peak = 0
      this.blocks = 0
    }
    return true
  }
}
registerProcessor('${MIC_PROCESSOR}', MillidaMic)
`

let moduleUrl = ''

export function micWorkletUrl(): string {
  if (!moduleUrl) moduleUrl = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }))
  return moduleUrl
}
