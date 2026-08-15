import { applyOutput, micConstraint, micProcessingConstraint, type MicProcessing } from '../audioDevices'
import {
  MIC_PROCESSOR,
  MIC_TUNING,
  micWorkletUrl,
  storedMicGain,
  storedNoiseMode,
  type NoiseMode,
} from './mic-worklet'

export interface MicLevel {
  level: number
  open: boolean
}

export interface MicChain {
  track: MediaStreamTrack
  setMuted: (v: boolean) => void
  setMode: (mode: NoiseMode) => void
  setGain: (pct: number) => void
  /** Ложь — движок не принял обработку на живой дорожке, она встанет со следующего звонка. */
  setProcessing: (p: MicProcessing, noise: NoiseMode) => Promise<boolean>

  /** Уровень и факт речи для индикатора; шумоподавление может быть выключено, тогда `open` всегда истинно. */
  onLevel: (cb: (l: MicLevel) => void) => void
  close: () => void
}

interface Nodes {
  ctx: AudioContext
  stream: MediaStream
  worklet: AudioWorkletNode | null
}

const audioCtor = (): typeof AudioContext =>
  window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

/**
 * Микрофон для звонка: захват, шумоподавление, усиление и мут одним объектом.
 *
 * Мут глушит звук внутри обработки, а не выключает дорожку: соединение не
 * пересобирается, индикатор продолжает показывать, что человек говорит в
 * выключенный микрофон, — а наружу при этом уходит тишина.
 */
export async function openMic(): Promise<MicChain> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraint(), video: false })
  const ctx = new (audioCtor())()
  if (ctx.state === 'suspended') await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const dest = ctx.createMediaStreamDestination()
  let worklet: AudioWorkletNode | null = null
  let listener: ((l: MicLevel) => void) | null = null

  try {
    await ctx.audioWorklet.addModule(micWorkletUrl())
    worklet = new AudioWorkletNode(ctx, MIC_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        tune: MIC_TUNING[storedNoiseMode()],
        gain: storedMicGain() / 100,
        muted: false,
      },
    })
    worklet.port.onmessage = (e: MessageEvent<MicLevel>) => {
      if (listener) listener(e.data)
    }
    source.connect(worklet)
    worklet.connect(dest)
  } catch {
    // Движок без AudioWorklet: звонок важнее шумоподавления, поэтому микрофон идёт
    // напрямую, а мут переключает саму дорожку.
    worklet = null
    source.connect(dest)
  }

  const nodes: Nodes = { ctx, stream, worklet }
  const track = dest.stream.getAudioTracks()[0]
  const post = (msg: Record<string, unknown>) => {
    if (nodes.worklet) nodes.worklet.port.postMessage(msg)
  }

  return {
    track,
    setMuted: (v) => {
      if (nodes.worklet) post({ muted: v })
      else track.enabled = !v
    },
    setMode: (mode) => post({ tune: MIC_TUNING[mode] }),
    setGain: (pct) => post({ gain: Math.max(0, Math.min(300, pct)) / 100 }),
    setProcessing: async (p, noise) => {
      const source = nodes.stream.getAudioTracks()[0]
      if (!source) return false
      try {
        await source.applyConstraints(micProcessingConstraint(p, noise))
        return true
      } catch {
        return false
      }
    },
    onLevel: (cb) => {
      listener = cb
    },
    close: () => {
      listener = null
      try {
        source.disconnect()
        if (nodes.worklet) nodes.worklet.disconnect()
        dest.disconnect()
      } catch {
        // Контекст мог закрыться раньше — освобождать уже нечего.
      }
      stream.getTracks().forEach((t) => t.stop())
      track.stop()
      void ctx.close().catch(() => {})
    },
  }
}

export interface RemoteAudio {
  setVolume: (pct: number) => void
  setDeafened: (v: boolean) => void
  close: () => void
}

/** Порог речи и удержание индикатора: без гистерезиса полоска мигала бы на паузах между словами. */
const SPEAK_ON = 0.045
const SPEAK_OFF = 0.02
const SPEAK_HOLD_MS = 260

/**
 * Замер громкости чужой дорожки для индикатора. Работает в обход громкости и
 * глушения: показывать надо, что собеседник говорит, а не как громко его слышно.
 */
/// Контекст замеров один на все чужие дорожки: в групповом разговоре их до
/// пяти, а движок держит всего несколько аудиоконтекстов на страницу — по
/// контексту на собеседника упёрлось бы в этот потолок.
let meterCtx: AudioContext | null = null

function sharedMeterContext(): AudioContext | null {
  if (meterCtx && meterCtx.state !== 'closed') return meterCtx
  try {
    meterCtx = new (audioCtor())()
  } catch {
    meterCtx = null
  }
  return meterCtx
}

function meterStream(stream: MediaStream, cb: (l: MicLevel) => void): () => void {
  const ctx = sharedMeterContext()
  if (!ctx) return () => {}
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.5
  source.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  let raf = 0
  let alive = true
  let open = false
  let openUntil = 0
  let sent = -1
  let sentOpen = false
  const tick = () => {
    if (!alive) return
    raf = requestAnimationFrame(tick)
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const level = Math.sqrt(sum / buf.length)
    const now = performance.now()
    if (level > SPEAK_ON) {
      open = true
      openUntil = now + SPEAK_HOLD_MS
    } else if (open && level < SPEAK_OFF && now > openUntil) {
      open = false
    }
    const step = Math.round(Math.min(1, level * 6) * 20)
    if (step === sent && open === sentOpen) return
    sent = step
    sentOpen = open
    cb({ level, open })
  }
  raf = requestAnimationFrame(tick)
  return () => {
    alive = false
    cancelAnimationFrame(raf)
    try {
      source.disconnect()
      analyser.disconnect()
    } catch {
      // Контекст мог закрыться раньше — освобождать уже нечего.
    }
  }
}

/**
 * Голос собеседника. Элемент живёт вне разметки: React перерисовывает панель
 * звонка, а пересозданный элемент оборвал бы звук на середине фразы.
 */
export function playRemote(stream: MediaStream, volumePct: number, onLevel?: (l: MicLevel) => void): RemoteAudio {
  const el = document.createElement('audio')
  el.autoplay = true
  el.srcObject = stream
  el.volume = Math.max(0, Math.min(100, volumePct)) / 100
  void applyOutput(el)
  void el.play().catch(() => {
    // Политика автозапуска: звук пойдёт после первого же действия человека,
    // а он его и совершил, приняв звонок.
  })
  const stopMeter = onLevel ? meterStream(stream, onLevel) : null
  return {
    setVolume: (pct) => {
      el.volume = Math.max(0, Math.min(100, pct)) / 100
    },
    setDeafened: (v) => {
      el.muted = v
    },
    close: () => {
      if (stopMeter) stopMeter()
      el.pause()
      el.srcObject = null
    },
  }
}

export const CALL_VOLUME_KEY = 'm-call-volume'

export function storedCallVolume(): number {
  const v = parseInt(localStorage.getItem(CALL_VOLUME_KEY) || '100', 10)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100
}

export const setStoredCallVolume = (pct: number) =>
  localStorage.setItem(CALL_VOLUME_KEY, String(Math.max(0, Math.min(100, Math.round(pct)))))
