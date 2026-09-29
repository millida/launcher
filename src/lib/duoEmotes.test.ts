import { describe, expect, it } from 'bun:test'
import { DUO_EMOTE_CODES, DUO_INVITE_OPTIONS, DUO_SCENES, duoClipName, duoScene, isDuoEmote, isDuoInvites } from './duoEmotes'

describe('эмоции вдвоём', () => {
  it.each([
    ['DUO_HIGH_FIVE', true, 'бесплатная парная эмоция получает метку «Вдвоём»'],
    ['DUO_SWORD_DUEL', true, 'последняя из десяти тоже парная'],
    ['YES', false, 'обычная эмоция не должна выглядеть парной'],
    ['duo_hug', false, 'коды каталога в верхнем регистре, чужой регистр — не наша вещь'],
    ['', false, 'пустой код — не вещь'],
    [undefined, false, 'вещь без кода — не парная'],
  ])('%p → %p (%s)', (code, expected) => {
    expect(isDuoEmote(code as string | undefined)).toBe(expected as boolean)
  })

  it('десять эмоций, как в каталоге сервера и в моде', () => {
    expect(DUO_EMOTE_CODES.length).toBe(10)
  })

  it('настройка приглашений принимает только три значения сервера', () => {
    expect(DUO_INVITE_OPTIONS.map(([v]) => v)).toEqual(['all', 'friends', 'none'])
    expect(isDuoInvites('everyone')).toBe(false)
    expect(isDuoInvites(null)).toBe(false)
  })

  const FROM_MOD = 'значения скопированы из millida_scenes в emotes/duo.json мода: разойдутся — примерочная расставит пару не так, как игра'

  it.each([
    ['DUO_HIGH_FIVE', 'high_five', 1.0, 0, 0, 0, 0, 0],
    ['DUO_HUG', 'hug', 0.65, 0, 0, 0, 0, 0],
    ['DUO_FIST_BUMP', 'fist_bump', 0.95, 0, 0, 0, 0, 0],
    ['DUO_HANDSHAKE', 'handshake', 0.85, 0, 0, 0, 0, 0],
    ['DUO_BOW', 'bow', 1.5, 0, 0, 0, 0, 0],
    ['DUO_SELFIE', 'selfie', 0.7, -90, 90, 0, 0, 0],
    ['DUO_DANCE', 'dance', 1.1, 0, 0, 0, 0, 0],
    ['DUO_WALTZ', 'waltz', 0.6, 0, 0, 0, 0, 0],
    ['DUO_TWIRL', 'twirl', 0.7, 0, 0, 720, 0.5, 2.5],
    ['DUO_SWORD_DUEL', 'sword_duel', 2.0, 0, 0, 0, 0, 0],
  ])('сцена %s → клип %s, %p блока (' + FROM_MOD + ')', (code, clip, distance, turnA, turnB, spinB, spinFrom, spinTo) => {
    expect(DUO_SCENES[code as keyof typeof DUO_SCENES]).toEqual({ clip, distance, turnA, turnB, spinB, spinFrom, spinTo })
  })

  it('у каждой из десяти эмоций есть сцена, иначе примерочная не поставит вторую фигуру', () => {
    expect(Object.keys(DUO_SCENES).sort()).toEqual([...DUO_EMOTE_CODES].sort())
  })

  it.each([
    ['DUO_HUG', 'a', 'animation.duo.hug.a', 'роль A — клип вещи из каталога'],
    ['DUO_HUG', 'b', 'animation.duo.hug.b', 'роль B — тот же клип с суффиксом .b, как DuoEmote.clipB в моде'],
    ['DUO_SWORD_DUEL', 'b', 'animation.duo.sword_duel.b', 'подчёркивание в имени клипа не теряется'],
  ])('%s, роль %s → %s (%s)', (code, role, expected) => {
    expect(duoClipName(duoScene(code)!, role as 'a' | 'b')).toBe(expected)
  })

  it('обычная эмоция сцены не имеет — вторая фигура не появляется', () => {
    expect(duoScene('YES')).toBeNull()
    expect(duoScene(undefined)).toBeNull()
  })
})
