import { describe, expect, it } from 'bun:test'
import { atlasFrames, pickClip } from './cosmeticModel'
import { cosmeticInflate } from './cosmeticSlots'
import { readCosmeticMesh } from './cosmeticGeometry'

const suit = () => ({
  'minecraft:geometry': [
    {
      description: { texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [0, 0] }] },
      ],
    },
  ],
})

describe('вещь на фигуре', () => {
  /**
   * Место -> прибавка. Та же лестница, что CosmeticSlot.extraInflate в моде
   * (CosmeticInflateTest): разойдутся - одна и та же вещь будет в примерочной
   * одной ширины, в игре другой.
   */
  const LADDER: [string, number, string][] = [
    ['PANTS', 0.01, 'нижняя ступень Essential: штаны ближе всего к телу'],
    ['TOP', 0.02, 'верх ложится поверх штанов'],
    ['HEAD', 0.02, 'голова - ступень верха'],
    ['WAIST', 0.03, 'пояс поверх верха'],
    ['FULL_BODY', 0.04, 'костюм целиком поверх пояса'],
    ['HAT', 0.04, 'шляпа - ступень костюма'],
    ['SHOES', 0.05, 'верхняя ступень: дальше видна кайма вокруг вещи'],
    ['WINGS', 0.01, 'крылья не лежат на теле - раздув им не нужен'],
    ['НЕИЗВЕСТНО', 0.01, 'незнакомое место получает пол, а не потолок'],
  ]

  for (const [slot, wanted, why] of LADDER) {
    it(`раздув ${slot} = ${wanted}: ${why}`, () => {
      expect(cosmeticInflate(slot), `${slot} ушёл со ступени мода`).toBe(wanted)
    })
  }

  it('раздув доходит до вершин: костюм шире тела на прибавку своего места', () => {
    const plain = readCosmeticMesh(suit())!
    const puffed = readCosmeticMesh(suit(), cosmeticInflate('FULL_BODY'))!
    const widest = (mesh: typeof plain) =>
      Math.max(...mesh.bones[0]!.quads.flatMap((q) => [q.positions[0], q.positions[3], q.positions[6]] as number[]))
    expect(widest(puffed) - widest(plain)).toBeCloseTo(cosmeticInflate('FULL_BODY'), 5)
  })

  it('лента кадров считается по пропорции, а не по высоте картинки', () => {
    // Крупный рисунок той же вещи: 64 на 128 при модели 64 на 64 - один кадр.
    expect(atlasFrames(128, 128, 64, 64)).toBe(1)
    // Движущийся костюм: 96 на 3072 при модели 96 на 96 - тридцать два кадра.
    expect(atlasFrames(96, 3072, 96, 96)).toBe(32)
    // Модель с невысокой развёрткой: лента считается от её же пропорции.
    expect(atlasFrames(64, 256, 64, 32)).toBe(8)
    expect(atlasFrames(0, 0, 64, 64)).toBe(1)
  })
})

describe('какой клип показывать', () => {
  const clips = {
    'animation.tail.walk': { name: 'animation.tail.walk', length: 1, loop: true, bones: {} },
    'animation.tail.idle': { name: 'animation.tail.idle', length: 1, loop: true, bones: {} },
  }

  it('берём тот, что назвал каталог, а не первый в файле', () => {
    expect(pickClip(clips, 'animation.tail.idle')?.name).toBe('animation.tail.idle')
    expect(pickClip(clips, 'animation.tail.walk')?.name).toBe('animation.tail.walk')
  })

  it('без имени показываем покой, а не первое попавшееся движение', () => {
    expect(pickClip(clips)?.name).toBe('animation.tail.idle')
  })

  it('имя из каталога может не найтись: тогда всё равно показываем покой', () => {
    expect(pickClip(clips, 'animation.tail.gone')?.name).toBe('animation.tail.idle')
    expect(pickClip({})).toBeNull()
  })
})
