import { describe, expect, it } from 'bun:test'
import { DUO_SCENES } from './duoEmotes'
import type { AnimationClip } from './cosmeticAnimation'
import { duoSpin, duoStage, soloSequence, VIEWER_UNITS_PER_BLOCK } from './duoStage'

const rounded = (value: number) => Math.round(value * 1000) / 1000 + 0
const deg = (radians: number) => rounded((radians * 180) / Math.PI)
const facing = (yaw: number) => [rounded(Math.sin(yaw)), rounded(Math.cos(yaw))]

describe('расстановка пары в примерочной', () => {
  it.each([
    ['DUO_HIGH_FIVE', 0, 8, -8, -90, 90, 'блок между фигурами = 16 пикселей просмотрщика, пара по центру кадра'],
    ['DUO_SWORD_DUEL', 0, 16, -16, -90, 90, 'дальняя сцена разводит фигуры на два блока'],
    ['DUO_SELFIE', 0, 5.6, -5.6, 0, 0, 'повороты селфи (-90/+90 в игре) разворачивают обоих к камере'],
    ['DUO_TWIRL', 0.5, 5.6, -5.6, -90, 90, 'до начала докрутки B стоит лицом к A'],
    ['DUO_TWIRL', 1.5, 5.6, -5.6, -90, -270, 'на середине докрутки B повернулся на 360 из 720'],
    ['DUO_TWIRL', 9, 5.6, -5.6, -90, -630, 'после конца докрутки B остаётся на полных 720 — снова лицом к A'],
  ])('%s на %p с → A x=%p, B x=%p, A %p°, B %p° (%s)', (code, seconds, ax, bx, yawA, yawB) => {
    const stage = duoStage(DUO_SCENES[code as keyof typeof DUO_SCENES], seconds as number)
    expect(stage.a.x).toBeCloseTo(ax as number, 6)
    expect(stage.b.x).toBeCloseTo(bx as number, 6)
    expect(stage.a.z).toBe(0)
    expect(stage.b.z).toBe(0)
    expect(deg(stage.a.yaw)).toBe(yawA as number)
    expect(deg(stage.b.yaw)).toBe(yawB as number)
  })

  it.each(Object.keys(DUO_SCENES).filter((code) => code !== 'DUO_SELFIE'))(
    '%s: A смотрит на B, B на A — иначе пара жмёт руку в пустоту',
    (code) => {
      const stage = duoStage(DUO_SCENES[code as keyof typeof DUO_SCENES], 0)
      const towardB = Math.sign(stage.b.x - stage.a.x)
      expect(facing(stage.a.yaw)).toEqual([towardB, 0])
      expect(facing(stage.b.yaw)).toEqual([-towardB, 0])
    },
  )

  it.each([
    [0.4, 0, 'до spin_from докрутки нет'],
    [0.5, 0, 'ровно на spin_from — ещё ноль, как в моде (seconds <= spinFrom)'],
    [2.5, 720, 'на spin_to — вся докрутка'],
    [3, 720, 'после spin_to угол держится, а не растёт'],
  ])('докрутка «Покружить» на %p с → %p° (%s)', (seconds, expected) => {
    expect(duoSpin(DUO_SCENES.DUO_TWIRL, seconds as number)).toBeCloseTo(expected as number, 6)
  })

  it('сцены без докрутки не крутят B ни в какой момент', () => {
    expect(duoSpin(DUO_SCENES.DUO_HUG, 100)).toBe(0)
  })

  it('масштаб блока закреплён: фигура в просмотрщике 32 пикселя ростом, как два блока', () => {
    expect(VIEWER_UNITS_PER_BLOCK).toBe(16)
  })

  it('половина пары играет только свой клип: вступление и петлю из чужих сцен файла не берёт', () => {
    const clip: AnimationClip = { name: 'animation.duo.hug.b', length: 2.6, loop: false, endless: false, bones: {} }
    const sequence = soloSequence(clip)!
    expect(sequence.intro).toBeNull()
    expect(sequence.main).toBe(clip)
    expect(sequence.timeAt(1.2)).toBe(1.2)
    expect(soloSequence(null)).toBeNull()
  })
})
