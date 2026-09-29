import { describe, expect, it } from 'bun:test'
import { atlasFrames, atlasWidthShare, pickClip } from './cosmeticModel'
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

  /**
   * Лента -> кадры. Та же таблица, что TextureFramesTest в моде: разойдутся -
   * вещь в примерочной режется на другие кадры, чем в игре.
   */
  const FRAMES: [number, number, number, number, number, string][] = [
    [128, 128, 64, 64, 1, 'та же вещь вдвое крупнее - разрешение, а не кадры'],
    [352, 352, 320, 320, 1, 'крылья молнии: чуть крупнее развёртки, но не лента'],
    [96, 3072, 96, 96, 32, 'движущийся костюм: тридцать два кадра'],
    [64, 256, 64, 32, 8, 'развёртка ниже ширины: кадр ростом с развёртку'],
    [64, 512, 64, 32, 16, 'плащ: по квадрату вышло бы вдвое меньше кадров'],
    [144, 2560, 80, 80, 32, 'дракон глубинной тьмы: по пропорции было 18, куски висели в воздухе'],
    [123, 624, 78, 78, 8, 'мех-броня: лента шире развёртки, по пропорции было 5'],
    [95, 640, 80, 80, 8, 'мех-пушка: по пропорции было 7'],
    [96, 768, 64, 64, 12, 'клинок молнии: по пропорции было 8'],
    [192, 1152, 128, 128, 9, 'шлем огненной брони: по пропорции было 6'],
    [48, 75, 48, 48, 1, 'хлопушка: 75 не делится на 48 - не лента, по пропорции было 2'],
    [48, 75, 48, 75, 1, 'хлопушка после правки развёртки'],
    [34, 1088, 34, 1088, 1, 'высокая развёртка - не лента'],
    [64, 100, 64, 64, 1, 'сто не делится на шестьдесят четыре'],
    [64, 64, 64, 64, 1, 'обычная картинка'],
    [0, 0, 64, 64, 1, 'картинка ещё не пришла'],
  ]

  for (const [width, height, texWidth, texHeight, wanted, why] of FRAMES) {
    it(`лента ${width}x${height} при развёртке ${texWidth}x${texHeight} = ${wanted}: ${why}`, () => {
      expect(atlasFrames(width, height, texWidth, texHeight), `${why}; мод режет ленту на ${wanted}`).toBe(wanted)
    })
  }

  const SHARES: [number, number, number, string][] = [
    [144, 80, 80 / 144, 'дракон: развёртка у левого края, справа спрайты частиц'],
    [123, 78, 78 / 123, 'мех-броня: пустое поле справа'],
    [128, 64, 1, 'целое увеличение - рисунок крупнее, поправка не нужна'],
    [64, 64, 1, 'лист ровно по развёртке'],
    [16, 20, 1, 'лист уже развёртки - мод поправку не применяет'],
    [0, 64, 1, 'картинка ещё не пришла'],
  ]

  for (const [width, texWidth, wanted, why] of SHARES) {
    it(`доля ширины ${width} при развёртке ${texWidth} = ${wanted.toFixed(3)}: ${why}`, () => {
      expect(atlasWidthShare(width, texWidth), `${why}; иначе рисунок растянут по ширине`).toBeCloseTo(wanted, 6)
    })
  }
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
