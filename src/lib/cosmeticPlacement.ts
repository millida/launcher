import type { CosmeticMesh, MeshBone, MeshQuad } from './cosmeticGeometry'

/**
 * Куда вещь садится на фигуре и где именно.
 *
 * Модель нарисована вокруг игрока: кость с именем `head` едет на голове, `cape`
 * висит за спиной. Точки крепления взяты те же, что в моде, — иначе шляпа в
 * окне и шляпа в игре сидят по-разному, и человек покупает не то, что видел.
 */
export type CosmeticAnchor =
  | 'root'
  | 'head'
  | 'body'
  | 'cape'
  | 'rightArm'
  | 'leftArm'
  | 'rightLeg'
  | 'leftLeg'

/** Имя кости -> часть игрока. Обе записи стороны принимаются: файлы разных лет. */
const ANCHOR_BY_BONE: Record<string, CosmeticAnchor> = {
  root: 'root',
  cape: 'cape',
  head: 'head',
  body: 'body',
  arm_left: 'leftArm',
  left_arm: 'leftArm',
  arm_right: 'rightArm',
  right_arm: 'rightArm',
  leg_left: 'leftLeg',
  left_leg: 'leftLeg',
  leg_right: 'rightLeg',
  right_leg: 'rightLeg',
}

/** Где стоит точка крепления части в пространстве игры: x, y вниз, z. */
const REST: Record<CosmeticAnchor, [number, number, number]> = {
  root: [0, 0, 0],
  head: [0, 0, 0],
  body: [0, 0, 0],
  cape: [0, 0, 0],
  rightArm: [-5, 2, 0],
  leftArm: [5, 2, 0],
  rightLeg: [-1.9, 12, 0],
  leftLeg: [1.9, 12, 0],
}

/**
 * Насколько середина части в просмотрщике ниже её точки крепления в игре.
 * У тела они не совпадают: группа стоит по центру торса, а игра считает от шеи.
 */
const GROUP_SHIFT: Record<CosmeticAnchor, number> = {
  root: 0,
  head: 0,
  body: 6,
  // Плащ-вещь стоит там, где её нарисовали: своя часть плаща в просмотрщике
  // откинута назад и поднята, и посадка на неё уводила ткань к поясу.
  cape: 0,
  rightArm: 0,
  leftArm: 0,
  rightLeg: 0,
  leftLeg: 0,
}

export interface RigBone {
  name: string
  /** Индекс родителя в этом же списке или -1: кость висит на части игрока. */
  parent: number
  anchor: CosmeticAnchor | null
  /** Смещение от родителя, а для кости на части игрока - от её крепления. */
  offset: [number, number, number]
  /** Покой кости в градусах, уже в знаках игры. */
  rotation: [number, number, number]
  quads: MeshQuad[]
}

export interface Rig {
  bones: RigBone[]
}

/** Цепочка кости снизу вверх: повороты наследуются от родителей. */
function chainOf(bone: MeshBone, byName: Map<string, MeshBone>): MeshBone[] {
  const chain: MeshBone[] = []
  const seen = new Set<string>()
  let at: MeshBone | undefined = bone
  while (at && !seen.has(at.name)) {
    seen.add(at.name)
    chain.push(at)
    at = at.parent ? byName.get(at.parent) : undefined
  }
  return chain
}

/**
 * Часть игрока для одной кости - по тому же правилу, что в моде: место на теле
 * получает только кость, висящая прямо на корне модели. Кость с тем же именем
 * глубже в дереве принадлежит художнику, и трогать её нельзя.
 *
 * Плащ - исключение: между ним и корнем часто стоят пустые группы, и они
 * ничего не ставят от себя.
 */
function anchorOfBone(bone: MeshBone, byName: Map<string, MeshBone>): CosmeticAnchor | null {
  const own = ANCHOR_BY_BONE[bone.name.toLowerCase()]
  if (!own) return null
  const parent = bone.parent ? bone.parent.toLowerCase() : null
  if (!parent || parent === 'root') return own
  return own === 'cape' && throughEmptyGroups(bone, byName) ? own : null
}

/** Между костью и корнем стоят только группы без кубов. */
function throughEmptyGroups(bone: MeshBone, byName: Map<string, MeshBone>): boolean {
  let name = bone.parent
  for (let depth = 0; depth < 16 && name && name.toLowerCase() !== 'root'; depth += 1) {
    const parent = byName.get(name)
    if (!parent || parent.quads.length) return false
    name = parent.parent
  }
  return true
}

/** Часть игрока, на которой сидит кость: ищется по её цепочке до корня. */
export function anchorOf(bone: MeshBone, byName: Map<string, MeshBone>): CosmeticAnchor | null {
  for (const link of chainOf(bone, byName)) {
    const anchor = anchorOfBone(link, byName)
    if (anchor) return anchor
  }
  return null
}

/** Куда садится часть игрока и на сколько её середина ниже крепления. */
export const anchorRest = (anchor: CosmeticAnchor) => REST[anchor]
export const anchorShift = (anchor: CosmeticAnchor) => GROUP_SHIFT[anchor]

/**
 * Разбирает модель в скелет: кость знает своего родителя, своё место и свой
 * покой. Ровно так же устроен мод - иначе анимацию пришлось бы пересчитывать
 * по-своему, и вещь в окне задвигалась бы не так, как в игре.
 *
 * Кость, сидящая на части игрока, меряется от этой части, а не от корня файла:
 * цепочка над ней в файле пропускается, как в MeshBuilder мода.
 */
export function buildRig(mesh: CosmeticMesh): Rig {
  const byName = new Map(mesh.bones.map((bone) => [bone.name, bone]))
  const indexByName = new Map<string, number>()
  const bones: RigBone[] = []

  for (const bone of mesh.bones) {
    const own = anchorOfBone(bone, byName)
    const parentBone = bone.parent ? byName.get(bone.parent) : undefined
    const parentIndex = own || !parentBone ? -1 : (indexByName.get(parentBone.name) ?? -1)
    const anchor = own ?? (parentIndex < 0 ? (anchorOf(bone, byName) ?? 'root') : null)
    const base: [number, number, number] =
      parentIndex >= 0 && parentBone
        ? [
            bone.pivot[0] - parentBone.pivot[0],
            bone.pivot[1] - parentBone.pivot[1],
            bone.pivot[2] - parentBone.pivot[2],
          ]
        : [bone.pivot[0], bone.pivot[1], bone.pivot[2]]
    const rest = anchor ? REST[anchor] : [0, 0, 0]
    const offset: [number, number, number] =
      parentIndex >= 0
        ? base
        : [base[0] - (rest[0] ?? 0), base[1] - (rest[1] ?? 0), base[2] - (rest[2] ?? 0)]
    indexByName.set(bone.name, bones.length)
    bones.push({
      name: bone.name,
      parent: parentIndex,
      anchor: parentIndex >= 0 ? null : (anchor as CosmeticAnchor),
      offset,
      rotation: [bone.rotation[0], bone.rotation[1], bone.rotation[2]],
      quads: bone.quads,
    })
  }

  return { bones }
}
