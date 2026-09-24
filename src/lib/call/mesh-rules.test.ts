import { describe, expect, it } from 'bun:test'
import {
  camBitrateFor,
  camEncodingFor,
  canShareScreenTo,
  canShowCamTo,
  peerFlagsPatch,
  politeToward,
  screenBitrateFor,
  screenEncodingFor,
} from './mesh-rules'
import { CAM_MAX_BITRATE, CAM_MIN_BITRATE, SCREEN_MAX_BITRATE, SCREEN_MIN_BITRATE } from './peer'

describe('вежливость в группе', () => {
  // Вход → вердикт. Столкновение предложений разбирается только если ровно одна
  // сторона считает себя вежливой: иначе оба откатятся и звук не пойдёт вовсе.
  it('ровно один из пары вежлив, и решение не зависит от того, кто спрашивает', () => {
    expect(politeToward('a', 'b')).toBe(true)
    expect(politeToward('b', 'a')).toBe(false)
    expect(politeToward('zzz', 'aaa')).toBe(false)
    expect(politeToward('aaa', 'zzz')).toBe(true)
  })
})

describe('битрейт показа экрана', () => {
  it('одному зрителю уходит полная картинка', () => {
    expect(screenBitrateFor(1)).toBe(SCREEN_MAX_BITRATE)
  })

  it('на двоих делится ровно пополам — сумма остаётся прежней', () => {
    expect(screenBitrateFor(2)).toBe(SCREEN_MAX_BITRATE / 2)
    expect(screenBitrateFor(2) * 2).toBe(SCREEN_MAX_BITRATE)
  })

  it('ниже читаемого не опускается — нечитаемая картинка хуже её отсутствия', () => {
    expect(screenBitrateFor(5)).toBe(SCREEN_MIN_BITRATE)
    expect(screenBitrateFor(50)).toBe(SCREEN_MIN_BITRATE)
  })

  it('нулевое число зрителей не ломает расчёт', () => {
    expect(screenBitrateFor(0)).toBe(SCREEN_MAX_BITRATE)
  })
})

describe('кодирование показа экрана', () => {
  // Уменьшенная картинка растягивается у зрителя обратно и читаться перестаёт —
  // именно так показ и выглядел «очень маленьким».
  it('разрешение не уменьшается ни при каком числе зрителей', () => {
    expect(screenEncodingFor(1, 30).scaleResolutionDownBy).toBe(1)
    expect(screenEncodingFor(4, 30).scaleResolutionDownBy).toBe(1)
  })

  it('частота кадров берётся из выбранного качества, а не из общего потолка', () => {
    expect(screenEncodingFor(1, 60).maxFramerate).toBe(60)
    expect(screenEncodingFor(1, 15).maxFramerate).toBe(15)
  })

  it('нулевая частота не уходит в кодек: дорожка с нулём кадров не идёт вовсе', () => {
    expect(screenEncodingFor(1, 0).maxFramerate).toBe(1)
  })

  it('потолок битрейта остаётся общим правилом меша', () => {
    expect(screenEncodingFor(2, 30).maxBitrate).toBe(screenBitrateFor(2))
  })
})

describe('кому вообще можно показывать экран', () => {
  // Ниже читаемого битрейт не опускается, поэтому каждый лишний зритель — это
  // ещё 600 кбит/с исходящего поверх голоса, а не более сжатая картинка.
  it('личка и небольшая группа показ разрешают', () => {
    expect(canShareScreenTo(1)).toBe(true)
    expect(canShareScreenTo(4)).toBe(true)
  })

  it('на пятерых зрителей показ уже закрыт — голос важнее картинки', () => {
    expect(canShareScreenTo(5)).toBe(false)
    expect(canShareScreenTo(9)).toBe(false)
  })
})

describe('камера в разговоре', () => {
  // Вход → вердикт. Камера уходит каждому своим потоком, как и показ экрана:
  // пятеро собеседников — это пять картинок из одного аплоада, а не одна.
  it('одному собеседнику уходит полная картинка', () => {
    expect(camBitrateFor(1)).toBe(CAM_MAX_BITRATE)
  })

  it('на двоих делится ровно пополам', () => {
    expect(camBitrateFor(2)).toBe(CAM_MAX_BITRATE / 2)
  })

  it('ниже узнаваемого лица не опускается', () => {
    expect(camBitrateFor(20)).toBe(CAM_MIN_BITRATE)
  })

  it('камера дешевле показа экрана — иначе её нельзя было бы держать включённой', () => {
    expect(camBitrateFor(1)).toBeLessThan(screenBitrateFor(1))
  })

  it('частота кадров берётся из выбранного качества, нулевая в кодек не уходит', () => {
    expect(camEncodingFor(1, 30).maxFramerate).toBe(30)
    expect(camEncodingFor(1, 0).maxFramerate).toBe(1)
  })

  // Разрешение камере уступать можно: в плитке размером с ладонь потеря не
  // видна, а рывки видны сразу — это и отличает её от показа экрана.
  it('разрешение камеры не закреплено, в отличие от показа экрана', () => {
    expect(camEncodingFor(4, 24).scaleResolutionDownBy).toBeUndefined()
    expect(screenEncodingFor(4, 24).scaleResolutionDownBy).toBe(1)
  })

  it('порог зрителей у камеры выше экранного: картинка вдвое дешевле', () => {
    expect(canShowCamTo(6)).toBe(true)
    expect(canShowCamTo(7)).toBe(false)
    expect(canShareScreenTo(6)).toBe(false)
  })
})

describe('флаги собеседника', () => {
  it('выключенный микрофон гасит индикатор — иначе на полоске висел бы последний кадр речи', () => {
    expect(peerFlagsPatch({ muted: true })).toEqual({ muted: true, level: 0, speaking: false })
  })

  it('включённый микрофон уровень не трогает: его посчитает сам замер', () => {
    expect(peerFlagsPatch({ muted: false })).toEqual({ muted: false })
  })

  it('показ экрана приходит отдельным флагом и не задевает микрофон', () => {
    expect(peerFlagsPatch({ screen: true })).toEqual({ sharing: true })
  })

  it('включённая камера приходит отдельным флагом и картинку не трогает', () => {
    expect(peerFlagsPatch({ cam: true })).toEqual({ camOn: true })
  })

  // Дорожка замолкает не мгновенно, поэтому последний кадр висел бы в плитке
  // уже после того, как человек нажал «выключить камеру».
  it('выключенная камера гасит и картинку', () => {
    expect(peerFlagsPatch({ cam: false })).toEqual({ camOn: false, cam: null })
  })

  it('пустые флаги не меняют ничего', () => {
    expect(peerFlagsPatch({})).toEqual({})
  })
})
