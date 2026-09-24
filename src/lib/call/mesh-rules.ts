import { CAM_MAX_BITRATE, CAM_MIN_BITRATE, SCREEN_MAX_BITRATE, SCREEN_MIN_BITRATE, type PeerFlags } from './peer'

export interface PeerState {
  muted: boolean
  deafened: boolean
  sharing: boolean
  /** Камера собеседника включена: флаг приходит раньше самой картинки. */
  camOn: boolean
  level: number
  speaking: boolean
  connection: RTCPeerConnectionState | 'new'
  quality: import('./peer').PeerQuality | null
  screen: MediaStream | null
  cam: MediaStream | null
}

/** Кто из двоих откатывает своё предложение при столкновении — решает порядок id. */
export const politeToward = (me: string, peer: string): boolean => me < peer

/**
 * Потолок показа экрана на одного зрителя. В меше картинка уходит каждому своим
 * потоком, поэтому полный битрейт на пятерых означал бы 12 Мбит/с исходящего —
 * столько нет почти ни у кого, и вместе с картинкой умер бы голос.
 */
export function screenBitrateFor(viewers: number): number {
  return Math.max(SCREEN_MIN_BITRATE, Math.round(SCREEN_MAX_BITRATE / Math.max(1, viewers)))
}

/**
 * Скольким зрителям вообще можно показывать экран. Ниже читаемого битрейт не
 * опускается, поэтому картинка на большее число людей не «сжимается», а просто
 * требует всё больше исходящего канала: на четверых это уже 2,4 Мбит/с поверх
 * голоса. Голос в разговоре важнее показа, поэтому режем показ, а не его.
 */
export const SCREEN_MAX_VIEWERS = 4

/**
 * Как отдавать картинку показа. Разрешение не уменьшается ни при каком канале:
 * зритель смотрит на текст и интерфейс, а уменьшенная вдвое картинка у него
 * растягивается обратно и читаться перестаёт. Частота кадров берётся из выбранного
 * качества — жёсткие 30 обрезали бы «плавный» режим ровно вдвое.
 */
export function screenEncodingFor(viewers: number, fps: number): RTCRtpEncodingParameters {
  return {
    maxBitrate: screenBitrateFor(viewers),
    maxFramerate: Math.max(1, Math.round(fps)),
    scaleResolutionDownBy: 1,
  }
}

export const canShareScreenTo = (viewers: number): boolean => viewers <= SCREEN_MAX_VIEWERS

/**
 * Потолок камеры на одного зрителя. Считается так же, как у показа экрана, и по
 * той же причине: в меше картинка уходит каждому своим потоком, поэтому цена
 * включённой камеры растёт с числом собеседников, а не делится между ними.
 */
export function camBitrateFor(viewers: number): number {
  return Math.max(CAM_MIN_BITRATE, Math.round(CAM_MAX_BITRATE / Math.max(1, viewers)))
}

/**
 * Скольким зрителям отдаём камеру. Порог выше экранного: картинка с лица вдвое
 * дешевле показа и терпит уменьшение, поэтому ради неё режется меньше.
 */
export const CAM_MAX_VIEWERS = 6

export const canShowCamTo = (viewers: number): boolean => viewers <= CAM_MAX_VIEWERS

/**
 * Как отдавать камеру. Разрешение уменьшать разрешено — в плитке размером с
 * ладонь потеря не видна, а сохранённая плавность видна сразу.
 */
export function camEncodingFor(viewers: number, fps: number): RTCRtpEncodingParameters {
  return {
    maxBitrate: camBitrateFor(viewers),
    maxFramerate: Math.max(1, Math.round(fps)),
  }
}

/**
 * Выключенный микрофон собеседника гасит и его индикатор: остаточный уровень
 * последнего кадра иначе висел бы на полоске всё время немоты.
 */
export function peerFlagsPatch(flags: PeerFlags): Partial<PeerState> {
  const patch: Partial<PeerState> = {}
  if (typeof flags.muted === 'boolean') {
    patch.muted = flags.muted
    if (flags.muted) {
      patch.level = 0
      patch.speaking = false
    }
  }
  if (typeof flags.screen === 'boolean') patch.sharing = flags.screen
  // Выключенная камера гасит и картинку: дорожка замолкает не мгновенно, и
  // кадр, на котором человек уже нажал «выключить», висел бы в плитке до неё.
  if (typeof flags.cam === 'boolean') {
    patch.camOn = flags.cam
    if (!flags.cam) patch.cam = null
  }
  return patch
}
