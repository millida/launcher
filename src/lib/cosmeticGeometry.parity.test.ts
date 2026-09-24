import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { readCosmeticMesh } from './cosmeticGeometry'

/**
 * Сверка с модом: там те же правила выведены из байт-кода игры и закреплены
 * своими тестами. Числа взяты из разбора модели mech armor в моде - если
 * лаунчер соберёт другое количество полигонов, значит правила разошлись, и
 * человек увидит в окне не то, что наденет в игре.
 */
const MODEL =
  'C:/Users/Fritaim/WebstormProjects/millida/millida-mod/bridges/assets-common/src/main/resources/assets/millida/cosmetics/bundled_mech_armor.json'

const EXPECTED: Record<string, number> = {
  body: 26,
  reactor_left: 3,
  reactor_right: 3,
  back_jet_left: 3,
  back_jet_right: 3,
  arm_right: 36,
  arm_armor_right: 1,
  arm_left: 36,
  arm_armor_left: 1,
  leg_right: 30,
  foot_right: 6,
  leg_right_outer: 6,
  wing_right: 1,
  leg_armor_right: 6,
  leg_left: 30,
  foot_left: 6,
  leg_left_outer: 6,
  leg_armor_left: 6,
  wing_left: 1,
}

describe('разбор совпадает с модом', () => {
  it.skipIf(!existsSync(MODEL))('mech armor даёт те же полигоны по костям', () => {
    const mesh = readCosmeticMesh(JSON.parse(readFileSync(MODEL, 'utf8')))
    expect(mesh).not.toBeNull()
    const got: Record<string, number> = {}
    for (const bone of mesh!.bones) {
      if (bone.quads.length) got[bone.name] = bone.quads.length
    }
    expect(got).toEqual(EXPECTED)
  })
})
