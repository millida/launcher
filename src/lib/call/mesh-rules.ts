import { SCREEN_MAX_BITRATE, SCREEN_MIN_BITRATE, type PeerFlags } from './peer'

export interface PeerState {
  muted: boolean
  deafened: boolean
  sharing: boolean
  level: number
  speaking: boolean
  connection: RTCPeerConnectionState | 'new'
  quality: import('./peer').PeerQuality | null
  screen: MediaStream | null
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
  return patch
}
