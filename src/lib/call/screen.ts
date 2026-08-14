export type ScreenQuality = 'smooth' | 'balanced' | 'sharp'

interface Preset {
  width: number
  height: number
  fps: number
  /** Подсказка кодеку: текст важнее плавности, игра — наоборот. */
  hint: 'detail' | 'motion'
}

export const SCREEN_PRESETS: Record<ScreenQuality, Preset> = {
  smooth: { width: 1280, height: 720, fps: 60, hint: 'motion' },
  balanced: { width: 1600, height: 900, fps: 30, hint: 'motion' },
  sharp: { width: 1920, height: 1080, fps: 15, hint: 'detail' },
}

export const SCREEN_QUALITY_KEY = 'm-call-screen-quality'

export function storedScreenQuality(): ScreenQuality {
  const v = localStorage.getItem(SCREEN_QUALITY_KEY)
  return v === 'smooth' || v === 'sharp' ? v : 'balanced'
}

export const setStoredScreenQuality = (q: ScreenQuality) => localStorage.setItem(SCREEN_QUALITY_KEY, q)

type DisplayMedia = MediaDevices & {
  getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
}

export const canShareScreen = (): boolean =>
  typeof navigator !== 'undefined' && !!(navigator.mediaDevices as DisplayMedia | undefined)?.getDisplayMedia

export interface ScreenShare {
  video: MediaStreamTrack
  /** Звук показываемого окна или экрана — есть не везде, на macOS его не будет. */
  audio: MediaStreamTrack | null
  stop: () => void
}

/**
 * Выбор источника показа. Окно выбора рисует сам движок — своё нарисовать
 * нельзя: захват экрана даётся только через этот вызов, а из него источник уже
 * выбран. Так же ведут себя браузерные версии мессенджеров.
 */
export async function shareScreen(quality: ScreenQuality): Promise<ScreenShare> {
  const media = navigator.mediaDevices as DisplayMedia
  if (!media.getDisplayMedia) throw new Error('unsupported')
  const p = SCREEN_PRESETS[quality]
  const stream = await media.getDisplayMedia({
    video: {
      width: { max: p.width },
      height: { max: p.height },
      frameRate: { max: p.fps },
    },
    audio: true,
  })
  const video = stream.getVideoTracks()[0]
  if (!video) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('no-video')
  }
  const hinted = video as MediaStreamTrack & { contentHint?: string }
  hinted.contentHint = p.hint
  return {
    video,
    audio: stream.getAudioTracks()[0] || null,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  }
}

/**
 * Отказ человека и отсутствие поддержки выглядят одинаково — как ошибка вызова,
 * а действия у них разные, поэтому текст обязан их разделять.
 */
export function screenErrorText(error: unknown): string {
  const name = (error as { name?: string; message?: string } | null)?.name
  const message = String((error as { message?: string } | null)?.message || '')
  if (name === 'NotAllowedError') return ''
  if (message === 'unsupported' || name === 'NotSupportedError' || name === 'TypeError') {
    return 'Показ экрана недоступен в этой сборке системы — на macOS его не даёт встроенный движок'
  }
  if (name === 'NotFoundError') return 'Нечего показывать — система не отдала ни одного экрана'
  return 'Не получилось начать показ экрана — попробуй ещё раз'
}
