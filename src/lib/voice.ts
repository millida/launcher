import { micConstraint } from './audioDevices'

export const VOICE_MAX_MS = 120_000
export const VOICE_PEAKS = 48

const KBPS = 32
const BUFFER_FRAMES = 4096

export interface VoiceTake {
  mp3: Uint8Array
  durationMs: number
  peaks: number[]
}

export interface VoiceRecorder {
  stop: () => Promise<VoiceTake>
  cancel: () => void
}

export const canRecordVoice = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia

/**
 * The encoder always runs at 22050 Hz no matter what the constructor is told
 * (verified against its output headers), so material at any other rate decodes
 * to near-silence: a 48 kHz take measured -44 dB against -12 dB for a correct
 * one. Everything is resampled to that rate before it reaches the encoder.
 */
export const ENCODER_RATE = 22050

export interface Resampler {
  push: (input: Float32Array) => Int16Array
}

/// Linear interpolation with the read position and the boundary sample carried
/// between blocks: resetting either would put a click at every block edge.
export function createResampler(fromRate: number, toRate = ENCODER_RATE): Resampler {
  const step = fromRate / toRate
  let pos = 0
  let prev = 0
  return {
    push(input: Float32Array): Int16Array {
      if (!input.length) return new Int16Array(0)
      const merged = new Float32Array(input.length + 1)
      merged[0] = prev
      merged.set(input, 1)
      const out: number[] = []
      let p = pos
      for (; p + 1 < merged.length; p += step) {
        const i = Math.floor(p)
        const f = p - i
        const v = Math.max(-1, Math.min(1, merged[i] * (1 - f) + merged[i + 1] * f))
        out.push(v < 0 ? v * 0x8000 : v * 0x7fff)
      }
      pos = p - input.length
      prev = input[input.length - 1]
      return Int16Array.from(out)
    },
  }
}

function envelope(levels: number[]): number[] {
  if (!levels.length) return []
  const peak = Math.max(...levels) || 1
  const out: number[] = []
  const per = levels.length / VOICE_PEAKS
  for (let i = 0; i < VOICE_PEAKS; i++) {
    const from = Math.floor(i * per)
    const to = Math.max(from + 1, Math.floor((i + 1) * per))
    let max = 0
    for (let k = from; k < to && k < levels.length; k++) max = Math.max(max, levels[k])
    out.push(Math.round((max / peak) * 100))
  }
  return out
}

/**
 * Encoding happens block by block while recording: a single pass over a minute
 * of audio at the end would freeze the window for seconds, and the webview has
 * no worker budget to spare under `script-src 'self'`.
 */
export async function recordVoice(
  onLevel?: (level: number, ms: number) => void,
  onLimit?: () => void,
): Promise<VoiceRecorder> {
  if (!canRecordVoice()) throw new Error('Микрофон недоступен в этой сборке')
  // The encoder is 170 KB of the bundle and matters only to someone who
  // actually presses record, so it loads on demand.
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraint() })
  const AudioCtor: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtor()
  const encoder = new Mp3Encoder(1, ENCODER_RATE, KBPS)
  const resampler = createResampler(ctx.sampleRate)
  const chunks: Uint8Array[] = []
  const levels: number[] = []
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(BUFFER_FRAMES, 1, 1)
  let frames = 0
  let closed = false
  let limitHit = false

  node.onaudioprocess = (e) => {
    if (closed) return
    const input = e.inputBuffer.getChannelData(0)
    let peak = 0
    for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]))
    levels.push(peak)
    const pcm = resampler.push(input)
    const buf = encoder.encodeBuffer(pcm)
    if (buf.length) chunks.push(new Uint8Array(buf))
    frames += pcm.length
    const ms = (frames / ENCODER_RATE) * 1000
    if (onLevel) onLevel(peak, ms)
    if (ms >= VOICE_MAX_MS && !limitHit) {
      limitHit = true
      if (onLimit) onLimit()
    }
  }
  source.connect(node)
  // Silent sink: WebKit stops pulling from a ScriptProcessor that reaches nothing.
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute)
  mute.connect(ctx.destination)
  if (ctx.state === 'suspended') await ctx.resume()

  const teardown = () => {
    closed = true
    node.onaudioprocess = null
    try {
      source.disconnect()
      node.disconnect()
      mute.disconnect()
    } catch {
      // a context already closed by the browser throws here and there is
      // nothing left to release
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  const finish = (): VoiceTake => {
    teardown()
    const tail = encoder.flush()
    if (tail.length) chunks.push(new Uint8Array(tail))
    let size = 0
    chunks.forEach((c) => (size += c.length))
    const mp3 = new Uint8Array(size)
    let at = 0
    chunks.forEach((c) => {
      mp3.set(c, at)
      at += c.length
    })
    return { mp3, durationMs: Math.round((frames / ENCODER_RATE) * 1000), peaks: envelope(levels) }
  }

  return { stop: () => Promise.resolve(finish()), cancel: teardown }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(out)
}

export function fmtVoiceTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
}
