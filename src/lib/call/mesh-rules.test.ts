import { describe, expect, it } from 'bun:test'
import { canShareScreenTo, peerFlagsPatch, politeToward, screenBitrateFor, screenEncodingFor } from './mesh-rules'
import { SCREEN_MAX_BITRATE, SCREEN_MIN_BITRATE } from './peer'

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

  it('пустые флаги не меняют ничего', () => {
    expect(peerFlagsPatch({})).toEqual({})
  })
})
