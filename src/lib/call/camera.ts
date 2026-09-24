export type CameraQuality = 'eco' | 'balanced' | 'sharp'

interface Preset {
  width: number
  height: number
  fps: number
}

export const CAMERA_PRESETS: Record<CameraQuality, Preset> = {
  eco: { width: 640, height: 360, fps: 20 },
  balanced: { width: 854, height: 480, fps: 24 },
  sharp: { width: 1280, height: 720, fps: 30 },
}

export const CAMERA_KEY = 'm-call-camera'
export const CAMERA_QUALITY_KEY = 'm-call-camera-quality'

export const storedCamera = (): string => localStorage.getItem(CAMERA_KEY) || ''

export const setStoredCamera = (id: string) => localStorage.setItem(CAMERA_KEY, id)

export function storedCameraQuality(): CameraQuality {
  const v = localStorage.getItem(CAMERA_QUALITY_KEY)
  return v === 'eco' || v === 'sharp' ? v : 'balanced'
}

export const setStoredCameraQuality = (q: CameraQuality) => localStorage.setItem(CAMERA_QUALITY_KEY, q)

export const canUseCamera = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export interface CameraDevice {
  id: string
  label: string
}

/**
 * Названия камер, как и микрофонов, движок прячет до первого выданного доступа:
 * список без них состоит из неразличимых строк, поэтому пустой честнее.
 */
export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const all = await navigator.mediaDevices.enumerateDevices()
  return all
    .filter((d) => d.kind === 'videoinput' && !!d.label && d.deviceId !== 'default')
    .map((d) => ({ id: d.deviceId, label: d.label }))
}

export interface CameraShare {
  video: MediaStreamTrack
  stream: MediaStream
  fps: number
  stop: () => void
}

export function cameraConstraint(deviceId: string, quality: CameraQuality): MediaTrackConstraints {
  const p = CAMERA_PRESETS[quality]
  const base: MediaTrackConstraints = {
    width: { ideal: p.width },
    height: { ideal: p.height },
    frameRate: { ideal: p.fps, max: p.fps },
  }
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base
}

/**
 * Захват камеры. Отключённое устройство из настроек не должно оставлять человека
 * без картинки вовсе: выбор сбрасывается, и камера берётся системная.
 */
export async function openCamera(deviceId: string, quality: CameraQuality): Promise<CameraShare> {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) throw new Error('unsupported')
  let stream: MediaStream
  try {
    stream = await media.getUserMedia({ video: cameraConstraint(deviceId, quality) })
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    if (!deviceId || (name !== 'NotFoundError' && name !== 'OverconstrainedError')) throw e
    setStoredCamera('')
    stream = await media.getUserMedia({ video: cameraConstraint('', quality) })
  }
  const video = stream.getVideoTracks()[0]
  if (!video) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('no-video')
  }
  const hinted = video as MediaStreamTrack & { contentHint?: string }
  // Лицо остаётся читаемым и в мелком окне, а рывки в разговоре заметнее
  // мягкости: при нехватке канала жертвуем детализацией, а не плавностью.
  hinted.contentHint = 'motion'
  return {
    video,
    stream,
    fps: CAMERA_PRESETS[quality].fps,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  }
}

/**
 * Отказ человека и отсутствие камеры выглядят одинаково — как ошибка вызова,
 * а делать при них надо разное, поэтому текст обязан их разделять.
 */
export function cameraErrorText(error: unknown): string {
  const name = (error as { name?: string; message?: string } | null)?.name
  const message = String((error as { message?: string } | null)?.message || '')
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Система не дала доступ к камере — разреши его лаунчеру в настройках приватности'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || message === 'no-video') {
    return 'Камера не найдена — подключи её и выбери в настройках звонков'
  }
  if (message === 'unsupported' || name === 'NotSupportedError' || name === 'TypeError') {
    return 'Камера недоступна в этой сборке системы'
  }
  return 'Камера занята другой программой — закрой её и попробуй ещё раз'
}
