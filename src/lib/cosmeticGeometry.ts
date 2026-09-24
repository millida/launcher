/**
 * Модель косметики формата Bedrock — в числа, из которых строится меш.
 *
 * Правила те же, что в моде: там они выведены из байт-кода игры и закреплены
 * тестами, и расхождение между лаунчером и игрой означало бы, что человек
 * покупает не то, что видел. Главные из них:
 *
 * - Blockbench меряет от земли вверх, игра — от точки крепления вниз, поэтому
 *   `y` переворачивается относительно роста игрока;
 * - развёртка бывает двух видов: коробкой (`uv: [u, v]`) и по граням
 *   (`uv: { north: { uv, uv_size } }`), причём размер грани бывает
 *   отрицательным — это зеркало самой картинки;
 * - `mirror` меняет местами крайние x куба, как делает сама игра: грани
 *   съезжают на противоположные стороны вместе со своими кусками развёртки.
 */

export const BODY_HEIGHT = 24

export type CubeFace = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

export interface MeshQuad {
  /** Четыре вершины по три числа: x, y, z в пикселях модели. */
  positions: number[]
  /** Четыре пары u, v в долях картинки. */
  uvs: number[]
}

export interface MeshBone {
  name: string
  parent: string | null
  /** Точка вращения кости в пространстве игры. */
  pivot: [number, number, number]
  /** Углы в градусах, знак x и z перевёрнут вслед за переворотом y. */
  rotation: [number, number, number]
  quads: MeshQuad[]
}

interface RawCube {
  origin?: number[]
  size?: number[]
  inflate?: number
  mirror?: boolean
  pivot?: number[]
  rotation?: number[]
  uv?: number[] | Record<string, { uv?: number[]; uv_size?: number[] }>
}

interface RawBone {
  name?: string
  parent?: string
  pivot?: number[]
  rotation?: number[]
  mirror?: boolean
  cubes?: RawCube[]
}

export interface CosmeticMesh {
  textureWidth: number
  textureHeight: number
  bones: MeshBone[]
}

const flipY = (y: number) => BODY_HEIGHT - y

const radians = (degrees: number) => (degrees * Math.PI) / 180

/** Поворот точки вокруг точки в порядке x, y, z - тот же, что у игры. */
function turnInModel(
  point: [number, number, number],
  pivot: number[],
  angles: [number, number, number],
): [number, number, number] {
  let x = point[0] - (pivot[0] ?? 0)
  let y = point[1] - (pivot[1] ?? 0)
  let z = point[2] - (pivot[2] ?? 0)

  let cos = Math.cos(radians(angles[0]))
  let sin = Math.sin(radians(angles[0]))
  ;[y, z] = [y * cos - z * sin, y * sin + z * cos]
  cos = Math.cos(radians(angles[1]))
  sin = Math.sin(radians(angles[1]))
  ;[x, z] = [x * cos + z * sin, -x * sin + z * cos]
  cos = Math.cos(radians(angles[2]))
  sin = Math.sin(radians(angles[2]))
  ;[x, y] = [x * cos - y * sin, x * sin + y * cos]

  return [x + (pivot[0] ?? 0), y + (pivot[1] ?? 0), z + (pivot[2] ?? 0)]
}

/** Углы граней куба: индексы вершин в порядке, в каком их ждёт игра. */
const FACES: { face: CubeFace; corners: [number, number, number, number] }[] = [
  { face: 'north', corners: [6, 2, 0, 4] },
  { face: 'south', corners: [3, 7, 5, 1] },
  { face: 'east', corners: [7, 6, 4, 5] },
  { face: 'west', corners: [2, 3, 1, 0] },
  { face: 'up', corners: [7, 3, 2, 6] },
  { face: 'down', corners: [4, 0, 1, 5] },
]

/** Классическая развёртка коробкой: бока разложены вокруг передней грани. */
function boxUv(face: CubeFace, u: number, v: number, size: number[]): number[] {
  const [sx, sy, sz] = [Math.abs(size[0] ?? 0), Math.abs(size[1] ?? 0), Math.abs(size[2] ?? 0)]
  switch (face) {
    case 'up':
      return [u + sz, v, u + sz + sx, v + sz]
    case 'down':
      return [u + sz + sx, v + sz, u + sz + sx + sx, v]
    case 'west':
      return [u, v + sz, u + sz, v + sz + sy]
    case 'north':
      return [u + sz, v + sz, u + sz + sx, v + sz + sy]
    case 'east':
      return [u + sz + sx, v + sz, u + sz + sx + sz, v + sz + sy]
    default:
      return [u + sz + sx + sz, v + sz, u + sz + sx + sz + sx, v + sz + sy]
  }
}

/**
 * Имя грани в файле модели. Формат зовёт «east» грань, смотрящую в МИНУС x, а
 * «west» - ту, что в плюс: имена противоположны тем, что носят эти направления
 * в самой игре. Видно по самому формату - запасная развёртка «east» это первый
 * столбец рисунка, а он в раскладке скина принадлежит правому боку игрока. Так
 * же читает файл мод (CubeFace.fileKey) и Essential (Cube.kt).
 */
function fileFace(face: CubeFace): CubeFace {
  if (face === 'east') return 'west'
  if (face === 'west') return 'east'
  return face
}

/** Прямоугольник грани в пикселях картинки или null, если грань не описана. */
export function faceRect(cube: RawCube, face: CubeFace): number[] | null {
  const uv = cube.uv
  if (uv && !Array.isArray(uv)) {
    const body = uv[fileFace(face)]
    if (!body || !body.uv) return null
    const [u, v] = body.uv
    const size = body.uv_size ?? defaultExtent(face, cube.size ?? [0, 0, 0])
    return [u ?? 0, v ?? 0, (u ?? 0) + (size[0] ?? 0), (v ?? 0) + (size[1] ?? 0)]
  }
  const [u, v] = Array.isArray(uv) ? uv : [0, 0]
  return boxUv(face, u ?? 0, v ?? 0, cube.size ?? [0, 0, 0])
}

function defaultExtent(face: CubeFace, size: number[]): number[] {
  if (face === 'up' || face === 'down') return [size[0] ?? 0, size[2] ?? 0]
  if (face === 'east' || face === 'west') return [size[2] ?? 0, size[1] ?? 0]
  return [size[0] ?? 0, size[1] ?? 0]
}

function cubeQuads(
  cube: RawCube,
  bone: RawBone,
  pivot: number[],
  texW: number,
  texH: number,
  extraInflate: number,
): MeshQuad[] {
  const origin = cube.origin ?? [0, 0, 0]
  const size = cube.size ?? [0, 0, 0]
  const inflate = (cube.inflate ?? 0) + extraInflate
  const perFace = Boolean(cube.uv && !Array.isArray(cube.uv))
  const mirror = Boolean(cube.mirror || bone.mirror) && !perFace

  let x0 = (origin[0] ?? 0) - inflate
  let x1 = (origin[0] ?? 0) + (size[0] ?? 0) + inflate
  const y0 = (origin[1] ?? 0) - inflate
  const y1 = (origin[1] ?? 0) + (size[1] ?? 0) + inflate
  const z0 = (origin[2] ?? 0) - inflate
  const z1 = (origin[2] ?? 0) + (size[2] ?? 0) + inflate
  if (mirror) {
    const swap = x0
    x0 = x1
    x1 = swap
  }

  const corners: number[][] = []
  for (let xi = 0; xi < 2; xi += 1) {
    for (let yi = 0; yi < 2; yi += 1) {
      for (let zi = 0; zi < 2; zi += 1) {
        corners.push([xi === 0 ? x0 : x1, yi === 0 ? y0 : y1, zi === 0 ? z0 : z1])
      }
    }
  }
  // Свой поворот куба - до переворота роста и вокруг своей точки, как в игре.
  // Без него уши сводятся внутрь, а топоры за спиной складываются в крест.
  const spin = cube.rotation
  if (spin && spin.some((angle) => angle)) {
    const pivotOfCube = cube.pivot ?? [0, 0, 0]
    for (const corner of corners) {
      const turned = turnInModel(corner as [number, number, number], pivotOfCube, [
        -(spin[0] ?? 0),
        spin[1] ?? 0,
        -(spin[2] ?? 0),
      ])
      corner[0] = turned[0]
      corner[1] = turned[1]
      corner[2] = turned[2]
    }
  }
  for (const corner of corners) {
    corner[0] = (corner[0] as number) - (pivot[0] ?? 0)
    corner[1] = flipY(corner[1] as number) - (pivot[1] ?? 0)
    corner[2] = (corner[2] as number) - (pivot[2] ?? 0)
  }

  const quads: MeshQuad[] = []
  for (const { face, corners: order } of FACES) {
    const rect = faceRect(cube, face)
    if (!rect) continue
    const [u1, v1, u2, v2] = rect as [number, number, number, number]
    const uv = [
      [u2 / texW, v1 / texH],
      [u1 / texW, v1 / texH],
      [u1 / texW, v2 / texH],
      [u2 / texW, v2 / texH],
    ]
    const positions: number[] = []
    const uvs: number[] = []
    for (let at = 0; at < 4; at += 1) {
      // Обмен крайних x у зеркального куба разворачивает обход грани, поэтому
      // обход возвращается обратно - вместе с углами развёртки. Пара «угол куба
      // - угол рисунка» обязана остаться прежней: если переставить только
      // развёртку, рисунок зеркалится второй раз, и рукав выходит вверх ногами.
      const from = mirror ? 3 - at : at
      const corner = corners[order[from] as number] as number[]
      positions.push(corner[0] as number, corner[1] as number, corner[2] as number)
      const pair = uv[from] as number[]
      uvs.push(pair[0] as number, pair[1] as number)
    }
    quads.push({ positions, uvs })
  }
  return quads
}

/**
 * Разбирает файл модели. Принимает и содержимое `minecraft:geometry`, и объект
 * целиком: сервис отдаёт модель завёрнутой, а файл из пачки лежит как есть.
 */
/**
 * Разбирает модель вещи. `extraInflate` - та же прибавка, что даёт мод по месту
 * на теле: без неё одежда спорит за глубину со скином игрока и вместо ткани
 * видно рябь из кожи и костюма вперемешку.
 */
export function readCosmeticMesh(source: unknown, extraInflate = 0): CosmeticMesh | null {
  const root = source as Record<string, unknown>
  if (!root || typeof root !== 'object') return null
  const wrapped = (root['minecraft:geometry'] ?? root['geometry']) as unknown
  const geometry = Array.isArray(wrapped)
    ? (wrapped[0] as Record<string, unknown>)
    : wrapped && typeof wrapped === 'object' && 'minecraft:geometry' in (wrapped as object)
      ? ((wrapped as Record<string, unknown>)['minecraft:geometry'] as unknown[])[0] as Record<string, unknown>
      : (root as Record<string, unknown>)
  if (!geometry) return null

  const description = (geometry['description'] ?? {}) as Record<string, number>
  const texW = Number(description['texture_width']) || 64
  const texH = Number(description['texture_height']) || 64
  const rawBones = (geometry['bones'] ?? []) as RawBone[]
  if (!Array.isArray(rawBones) || rawBones.length === 0) return null

  const bones: MeshBone[] = rawBones.map((bone) => {
    const rawPivot = bone.pivot ?? [0, 0, 0]
    const pivot: [number, number, number] = [
      rawPivot[0] ?? 0,
      flipY(rawPivot[1] ?? 0),
      rawPivot[2] ?? 0,
    ]
    const rotation = bone.rotation ?? [0, 0, 0]
    return {
      name: String(bone.name ?? ''),
      parent: bone.parent ? String(bone.parent) : null,
      pivot,
      // Кость поворачивается ровно на те углы, что стоят в файле: знак меняется
      // только у куба (см. cubeQuads). В моде так же - MeshBuilder разворачивает
      // знак дважды и тем возвращает исходные углы, и шляпа с крылом смотрят
      // вверх, а не вниз.
      rotation: [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0],
      quads: (bone.cubes ?? [])
        .filter((cube) => (cube.size ?? []).some((side) => side !== 0))
        .flatMap((cube) => cubeQuads(cube, bone, pivot, texW, texH, extraInflate)),
    }
  })

  return { textureWidth: texW, textureHeight: texH, bones }
}
