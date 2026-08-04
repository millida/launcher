export const MIC_KEY = 'm-audio-in'
export const OUT_KEY = 'm-audio-out'

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

export function micConstraint(): MediaTrackConstraints {
  const id = storedMic()
  const base: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
  return id ? { ...base, deviceId: { exact: id } } : base
}

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
