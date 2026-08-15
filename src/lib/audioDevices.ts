import { storedNoiseMode, type NoiseMode } from './call/mic-worklet'

export const MIC_KEY = 'm-audio-in'
export const OUT_KEY = 'm-audio-out'
export const AGC_KEY = 'm-audio-agc'
export const AEC_KEY = 'm-audio-aec'

export interface AudioDevice {
  id: string
  label: string
}

/// An element that can be pinned to an output device. Chromium has had
/// setSinkId for years; WebKit has not, and there it stays undefined.
type Sinkable = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }

export const canPickOutput = (): boolean =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

export const storedMic = () => localStorage.getItem(MIC_KEY) || ''
export const storedOutput = () => localStorage.getItem(OUT_KEY) || ''

export const setStoredMic = (id: string) => localStorage.setItem(MIC_KEY, id)
export const setStoredOutput = (id: string) => localStorage.setItem(OUT_KEY, id)

/**
 * Labels stay empty until the page has been granted the microphone once — the
 * browser hides them from a page that never asked. A silent probe is the price
 * of a usable list, so callers ask for it explicitly.
 */
export async function listAudioDevices(probe = false): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] }
  if (probe) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
    } catch {
      // Denied: the list still comes back, just without names.
    }
  }
  const all = await navigator.mediaDevices.enumerateDevices()
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    all
      .filter((d) => d.kind === kind)
      .map((d, i) => ({ id: d.deviceId, label: d.label || fallback + ' ' + (i + 1) }))
  return {
    inputs: pick('audioinput', 'Микрофон'),
    outputs: pick('audiooutput', 'Устройство'),
  }
}

/// A saved device that has since been unplugged must not silence playback: the
/// system default is better than an error.
export async function applyOutput(el: HTMLMediaElement): Promise<void> {
  const id = storedOutput()
  const sinkable = el as Sinkable
  if (!id || !sinkable.setSinkId) return
  try {
    await sinkable.setSinkId(id)
  } catch {
    setStoredOutput('')
  }
}

/**
 * A refusal by the OS and a mic held by another app look identical in the UI but
 * need opposite actions, and on macOS the first one arrives without any prompt
 * ever being shown — so the text has to name the permission itself.
 */
export function micErrorText(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Система не дала доступ к микрофону — разреши его лаунчеру в настройках приватности и перезапусти лаунчер'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Микрофон не найден — подключи устройство и выбери его в списке'
  }
  return 'Микрофон недоступен — проверь, не занят ли он другой программой'
}

export interface MicProcessing {
  /** Системный автоуровень: ведёт громкость микрофона сам, без спроса. */
  agc: boolean
  /** Подавление эха из колонок в микрофон. */
  echo: boolean
}

const storedFlag = (key: string, fallback: boolean): boolean => {
  const v = localStorage.getItem(key)
  return v === '1' ? true : v === '0' ? false : fallback
}

/**
 * Автоуровень выключен по умолчанию: во время долгой речи он заметно убавляет
 * микрофон, а усиление в лаунчере задаётся ползунком — вместе они тянут уровень
 * в разные стороны, и человек слышит, что его «прикручивают». Эхоподавление
 * остаётся включённым: без него звук из колонок уходит обратно собеседнику.
 */
export function storedMicProcessing(): MicProcessing {
  return { agc: storedFlag(AGC_KEY, false), echo: storedFlag(AEC_KEY, true) }
}

export function setStoredMicProcessing(p: MicProcessing): void {
  localStorage.setItem(AGC_KEY, p.agc ? '1' : '0')
  localStorage.setItem(AEC_KEY, p.echo ? '1' : '0')
}

/// Только обработка, без выбора устройства: смена устройства требует нового
/// захвата, а эти три поля движок меняет на живой дорожке.
///
/// Шумоподавление движка подчиняется тому же выбору, что и наше: оно тоже
/// приглушает микрофон на речи, и пока оно стояло жёстко, «Выключен» в
/// настройках ничего не выключал — человек слышал, что его всё равно ведут.
export const micProcessingConstraint = (p: MicProcessing, noise: NoiseMode): MediaTrackConstraints => ({
  echoCancellation: p.echo,
  autoGainControl: p.agc,
  noiseSuppression: noise !== 'off',
})

export function micConstraintFor(
  deviceId: string,
  p: MicProcessing,
  noise: NoiseMode,
): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    channelCount: 1,
    ...micProcessingConstraint(p, noise),
  }
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base
}

export const micConstraint = (): MediaTrackConstraints =>
  micConstraintFor(storedMic(), storedMicProcessing(), storedNoiseMode())

/// Two seconds of a quiet sine through the chosen output: if this is silent,
/// the problem is the device, not the voice message.
export async function playTestTone(): Promise<void> {
  const el = document.createElement('audio')
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 440
  gain.gain.value = 0.12
  osc.connect(gain)
  gain.connect(dest)
  el.srcObject = dest.stream
  await applyOutput(el)
  osc.start()
  await el.play()
  await new Promise((r) => setTimeout(r, 900))
  osc.stop()
  el.pause()
  el.srcObject = null
  await ctx.close()
}
