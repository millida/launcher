import { describe, expect, it } from 'bun:test'
import { BODY_HEIGHT, faceRect, readCosmeticMesh } from './cosmeticGeometry'

const cube = (over: Record<string, unknown> = {}) => ({
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 },
      bones: [{ name: 'root', pivot: [0, 24, 0], cubes: [{ origin: [0, 24, 0], size: [2, 2, 2], uv: [0, 0], ...over }] }],
    },
  ],
})

describe('модель косметики', () => {
  it('рост переворачивается: точка на высоте роста игрока оказывается у крепления', () => {
    const mesh = readCosmeticMesh(cube())
    expect(mesh).not.toBeNull()
    const ys = (mesh as NonNullable<typeof mesh>).bones[0]!.quads.flatMap((q) =>
      [q.positions[1], q.positions[4], q.positions[7], q.positions[10]] as number[],
    )
    // Куб стоит от 24 до 26 в Blockbench, значит от 0 до -2 у крепления.
    expect(Math.max(...ys)).toBeCloseTo(0, 5)
    expect(Math.min(...ys)).toBeCloseTo(-2, 5)
    expect(BODY_HEIGHT).toBe(24)
  })

  it('развёртка коробкой раскладывает бока вокруг передней грани', () => {
    const box = { size: [2, 3, 4], uv: [10, 20] }
    expect(faceRect(box, 'west')).toEqual([10, 24, 14, 27])
    expect(faceRect(box, 'north')).toEqual([14, 24, 16, 27])
    expect(faceRect(box, 'east')).toEqual([16, 24, 20, 27])
    expect(faceRect(box, 'south')).toEqual([20, 24, 22, 27])
    expect(faceRect(box, 'up')).toEqual([14, 20, 16, 24])
  })

  it('грань без описания не рисуется, а отрицательный размер зеркалит сам кусок', () => {
    const perFace = {
      size: [4, 4, 4],
      uv: { north: { uv: [8, 8], uv_size: [-4, 4] } },
    }
    expect(faceRect(perFace, 'north')).toEqual([8, 8, 4, 12])
    expect(faceRect(perFace, 'south')).toBeNull()
  })

  it('прямоугольник «east» из файла ложится на грань минус x', () => {
    // Формат зовёт «east» грань, смотрящую в минус x, - противоположно тому,
    // что этим словом называет игра. Пока имена брались как есть, всё с
    // рисунком на каждую грань стояло боками наоборот, а плоская вещь
    // зеркалилась целиком: у хвоста кота кончик оказывался у тела.
    const perFace = {
      size: [4, 4, 4],
      uv: {
        east: { uv: [0, 0], uv_size: [4, 4] },
        west: { uv: [32, 0], uv_size: [4, 4] },
      },
    }
    expect(faceRect(perFace, 'west')).toEqual([0, 0, 4, 4])
    expect(faceRect(perFace, 'east')).toEqual([32, 0, 36, 4])
  })

  it('зеркальный куб меняет местами крайние x: рисунок уходит на другую сторону', () => {
    const plain = readCosmeticMesh(cube())!.bones[0]!.quads
    const mirrored = readCosmeticMesh(cube({ mirror: true }))!.bones[0]!.quads
    const xs = (quads: typeof plain) => quads.flatMap((q) => [q.positions[0], q.positions[3]] as number[])
    // Набор точек тот же, а вот куски развёртки на гранях встают наоборот.
    expect(Math.min(...xs(plain))).toBeCloseTo(Math.min(...xs(mirrored)), 5)
    expect(plain[0]!.uvs).not.toEqual(mirrored[0]!.uvs)
  })

  it('у зеркального куба угол и его точка на рисунке остаются парой', () => {
    const plain = readCosmeticMesh(cube())!.bones[0]!.quads[0]!
    const mirrored = readCosmeticMesh(cube({ mirror: true }))!.bones[0]!.quads[0]!
    const pairs = (quad: typeof plain) =>
      [0, 1, 2, 3]
        .map((v) => [quad.positions[v * 3 + 1], quad.positions[v * 3 + 2], quad.uvs[v * 2], quad.uvs[v * 2 + 1]].join(':'))
        .sort()
    // Зеркало переворачивает куб по x, и только по x: высота и глубина угла
    // обязаны и дальше держаться за свой кусок рисунка. Если переставить одну
    // развёртку, рисунок зеркалится второй раз - рукав встаёт вверх ногами.
    expect(pairs(mirrored), 'пары «угол - точка рисунка» разъехались после зеркала').toEqual(
      pairs(plain),
    )
  })

  it('кость поворачивается на те углы, что в файле: знак меняет только куб', () => {
    const mesh = readCosmeticMesh({
      'minecraft:geometry': [
        {
          description: { texture_width: 64, texture_height: 64 },
          bones: [{ name: 'tail', pivot: [0, 12, 0], rotation: [30, 40, 50], cubes: [] }],
        },
      ],
    })
    // Мод разворачивает знак у кости дважды (GeometryCodec.turn и MeshBuilder)
    // и тем возвращает исходные углы. С одним разворотом шляпа смотрит вниз, а
    // крыло растёт из груди - это и было видно в окне.
    expect(mesh!.bones[0]!.rotation).toEqual([30, 40, 50])
    expect(mesh!.bones[0]!.pivot[1]).toBe(12)
  })

  it('куб нулевого размера пропускается, пустая модель отдаёт null', () => {
    const empty = readCosmeticMesh({
      'minecraft:geometry': [
        {
          description: { texture_width: 64, texture_height: 64 },
          bones: [{ name: 'root', pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [0, 0, 0], uv: [0, 0] }] }],
        },
      ],
    })
    expect(empty!.bones[0]!.quads).toHaveLength(0)
    expect(readCosmeticMesh({})).toBeNull()
    expect(readCosmeticMesh(null)).toBeNull()
  })
})
