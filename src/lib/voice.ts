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

/// lamejs accepts only a fixed set of rates, so halving 48k/44.1k keeps us on a
/// legal one while cutting the file in two. Speech has nothing above 12 kHz.
function targetRate(ctxRate: number): { rate: number; decimate: number } {
  if (ctxRate >= 32000) return { rate: Math.round(ctxRate / 2), decimate: 2 }
  return { rate: Math.round(ctxRate), decimate: 1 }
}

function toInt16(input: Float32Array, decimate: number): Int16Array {
  const out = new Int16Array(Math.floor(input.length / decimate))
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (let k = 0; k < decimate; k++) sum += input[i * decimate + k] || 0
    const v = Math.max(-1, Math.min(1, sum / decimate))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
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
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const AudioCtor: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtor()
  const { rate, decimate } = targetRate(ctx.sampleRate)
  const encoder = new Mp3Encoder(1, rate, KBPS)
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
    const pcm = toInt16(input, decimate)
    const buf = encoder.encodeBuffer(pcm)
    if (buf.length) chunks.push(new Uint8Array(buf))
    frames += pcm.length
    const ms = (frames / rate) * 1000
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
    return { mp3, durationMs: Math.round((frames / rate) * 1000), peaks: envelope(levels) }
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
