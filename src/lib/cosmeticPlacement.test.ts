import { describe, expect, it } from 'bun:test'
import { readCosmeticMesh } from './cosmeticGeometry'
import { anchorShift, buildRig } from './cosmeticPlacement'

const model = (bones: unknown[]) => ({
  'minecraft:geometry': [{ description: { texture_width: 64, texture_height: 64 }, bones }],
})

const rig = (bones: unknown[]) => buildRig(readCosmeticMesh(model(bones))!)

const boneOf = (bones: unknown[], name: string) => {
  const found = rig(bones).bones.find((b) => b.name === name)
  expect(found, name + ': кость потерялась').toBeDefined()
  return found!
}

describe('скелет вещи', () => {
  it('шляпа садится на голову и стоит над точкой крепления', () => {
    const hat = boneOf(
      [
        { name: 'root', pivot: [0, 0, 0] },
        {
          name: 'head',
          parent: 'root',
          pivot: [0, 24, 0],
          cubes: [{ origin: [-4, 24, -4], size: [8, 2, 8], uv: [0, 0] }],
        },
      ],
      'head',
    )
    expect(hat.anchor).toBe('head')
    expect(hat.offset).toEqual([0, 0, 0])
    const ys = hat.quads.flatMap((q) => [q.positions[1], q.positions[4], q.positions[7]] as number[])
    // Шляпа занимает 24..26 в модели: от шеи это 0..-2, и разворот поднимет её вверх.
    expect(Math.max(...ys)).toBeCloseTo(0, 5)
    expect(Math.min(...ys)).toBeCloseTo(-2, 5)
  })

  it('вещь на теле опускается на полшага: группа торса стоит по центру, а игра считает от шеи', () => {
    const body = boneOf(
      [
        { name: 'root', pivot: [0, 0, 0] },
        {
          name: 'body',
          parent: 'root',
          pivot: [0, 12, 0],
          cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [0, 0] }],
        },
      ],
      'body',
    )
    expect(body.anchor).toBe('body')
    expect(anchorShift('body')).toBe(6)
  })

  it('рука и нога считаются от своих креплений, а не от шеи', () => {
    const bones = [
      { name: 'root', pivot: [0, 0, 0] },
      {
        name: 'arm_left',
        parent: 'root',
        pivot: [5, 22, 0],
        cubes: [{ origin: [4, 21, -1], size: [2, 2, 2], uv: [0, 0] }],
      },
      {
        name: 'leg_right',
        parent: 'root',
        pivot: [-1.9, 12, 0],
        cubes: [{ origin: [-3, 10, -1], size: [2, 2, 2], uv: [0, 0] }],
      },
    ]
    // Крепления совпадают с теми, что держит игра: кость садится ровно на них.
    expect(boneOf(bones, 'arm_left').offset).toEqual([0, 0, 0])
    expect(boneOf(bones, 'leg_right').offset).toEqual([0, 0, 0])
    expect(boneOf(bones, 'arm_left').anchor).toBe('leftArm')
    expect(boneOf(bones, 'leg_right').anchor).toBe('rightLeg')
  })

  it('кость без своей части едет на корне фигуры вслед за костью root', () => {
    const bones = [
      { name: 'root', pivot: [0, 0, 0] },
      {
        name: 'trinket',
        parent: 'root',
        pivot: [0, 14, 0],
        cubes: [{ origin: [0, 14, 0], size: [1, 1, 1], uv: [0, 0] }],
      },
    ]
    // Корень модели - это ступни, и он сам садится на фигуру.
    expect(boneOf(bones, 'root').anchor).toBe('root')
    const trinket = boneOf(bones, 'trinket')
    expect(trinket.anchor).toBeNull()
    expect(trinket.parent).toBe(0)
    // Кость на 14 от земли, корень модели - ступни: 14 вверх, а высота считается вниз.
    expect(trinket.offset[1]).toBeCloseTo(-14, 5)
    // Сам корень стоит на 24 ниже шеи - там, где у фигуры земля.
    expect(boneOf(bones, 'root').offset[1]).toBeCloseTo(24, 5)
  })

  it('вещь без кости root считается от корня фигуры', () => {
    const loose = boneOf(
      [
        {
          name: 'trinket',
          pivot: [0, 14, 0],
          cubes: [{ origin: [0, 14, 0], size: [1, 1, 1], uv: [0, 0] }],
        },
      ],
      'trinket',
    )
    expect(loose.anchor).toBe('root')
    expect(loose.parent).toBe(-1)
  })

  it('плащ узнаётся через пустые группы и меряется от шеи', () => {
    const cape = boneOf(
      [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'body', parent: 'root', pivot: [0, 12, 0] },
        {
          name: 'cape',
          parent: 'body',
          pivot: [0, 24, 2],
          cubes: [{ origin: [-5, 8, 2], size: [10, 16, 1], uv: [0, 0] }],
        },
      ],
      'cape',
    )
    expect(cape.anchor).toBe('cape')
    expect(cape.offset).toEqual([0, 0, 2])
    expect(anchorShift('cape')).toBe(0)
  })

  it('кость с именем части тела глубже в дереве остаётся художнику', () => {
    const inner = boneOf(
      [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'wing', parent: 'root', pivot: [0, 20, 0], cubes: [{ origin: [0, 20, 0], size: [1, 1, 1], uv: [0, 0] }] },
        {
          name: 'head',
          parent: 'wing',
          pivot: [0, 22, 0],
          cubes: [{ origin: [0, 22, 0], size: [1, 1, 1], uv: [0, 0] }],
        },
      ],
      'head',
    )
    // Своя кость художника: она висит на крыле, а не едет на голове игрока.
    expect(inner.anchor).toBeNull()
    expect(inner.parent).toBeGreaterThanOrEqual(0)
    // Смещение считается от родителя: 22 - 20 = 2, а после переворота это -2.
    expect(inner.offset[1]).toBeCloseTo(-2, 5)
  })

  it('поворот кости берётся из файла как есть', () => {
    const tail = boneOf(
      [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'body', parent: 'root', pivot: [0, 12, 0] },
        {
          name: 'tail',
          parent: 'body',
          pivot: [0, 12, 2],
          rotation: [-20, 0, 15],
          cubes: [{ origin: [-2, 12, 2], size: [4, 15, 8], uv: [0, 0] }],
        },
      ],
      'tail',
    )
    // У кости углы те же, что в файле: разворот знака - дело куба.
    expect(tail.rotation[0]).toBeCloseTo(-20, 5)
    expect(tail.rotation[2]).toBeCloseTo(15, 5)
  })
})
