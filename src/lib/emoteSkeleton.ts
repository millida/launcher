import { readCosmeticMesh, type MeshBone } from './cosmeticGeometry'
import { poseOf, type AnimationClip } from './cosmeticAnimation'

/** Three rows of four numbers: the turn and the place of a bone in model pixels. */
type Matrix = number[]

/** Parts of the player an emote moves, by the bone name the artist uses for them. */
export const EMOTE_PARTS: Record<string, string> = {
  head: 'head',
  body: 'body',
  arm_left: 'leftArm',
  arm_right: 'rightArm',
  leg_left: 'leftLeg',
  leg_right: 'rightLeg',
}

const ALIASES: Record<string, string> = {
  left_arm: 'arm_left',
  right_arm: 'arm_right',
  left_leg: 'leg_left',
  right_leg: 'leg_right',
}

/**
 * Where one part of the player ends up: the shift from its rest pivot in model
 * pixels and the absolute turn in radians, in the order the game turns it -
 * z, then y, then x.
 */
export interface PartPose {
  shift: [number, number, number]
  turn: [number, number, number]
  /** The same turn as three rows of three, scale removed. */
  matrix: number[]
  /**
   * The point `shift` is measured at - where the game turns this part, in game
   * coordinates: y down from the neck, z to the back. It was the bone's own rest
   * pivot once, which is twelve pixels lower for the torso of most emotes, and the
   * fitting room turned the torso about one point while moving it by another.
   */
  pivot: [number, number, number]
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

function rotation(rx: number, ry: number, rz: number): Matrix {
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, 0,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, 0,
    -sy, cy * sx, cy * cx, 0,
  ]
}

function multiply(parent: Matrix, child: Matrix): Matrix {
  const out = new Array<number>(12).fill(0)
  for (let row = 0; row < 3; row++) {
    const p = row * 4
    for (let column = 0; column < 3; column++) {
      out[p + column] =
        parent[p]! * child[column]! + parent[p + 1]! * child[4 + column]! + parent[p + 2]! * child[8 + column]!
    }
    out[p + 3] = parent[p]! * child[3]! + parent[p + 1]! * child[7]! + parent[p + 2]! * child[11]! + parent[p + 3]!
  }
  return out
}

/**
 * The turn of a finished matrix. A clip may scale a bone, and scale multiplies
 * the columns, so the rotation comes back by straightening the columns - the
 * same as in the mod. Straightening the rows instead left a matrix that was
 * neither the rotation nor anything else, and the arm it came from sat at the
 * wrong angle.
 */
function rowsOf(matrix: Matrix): number[] {
  const m = [
    matrix[0]!, matrix[1]!, matrix[2]!,
    matrix[4]!, matrix[5]!, matrix[6]!,
    matrix[8]!, matrix[9]!, matrix[10]!,
  ]
  for (let column = 0; column < 3; column++) {
    for (let earlier = 0; earlier < column; earlier++) {
      const dot = m[column]! * m[earlier]! + m[3 + column]! * m[3 + earlier]! + m[6 + column]! * m[6 + earlier]!
      m[column] = m[column]! - dot * m[earlier]!
      m[3 + column] = m[3 + column]! - dot * m[3 + earlier]!
      m[6 + column] = m[6 + column]! - dot * m[6 + earlier]!
    }
    const length = Math.sqrt(m[column]! ** 2 + m[3 + column]! ** 2 + m[6 + column]! ** 2)
    if (length <= 0.00001) {
      m[column] = column === 0 ? 1 : 0
      m[3 + column] = column === 1 ? 1 : 0
      m[6 + column] = column === 2 ? 1 : 0
    } else {
      m[column] = m[column]! / length
      m[3 + column] = m[3 + column]! / length
      m[6 + column] = m[6 + column]! / length
    }
  }
  return m
}

/**
 * Углы поворота части тела в том же виде, в каком их отдаёт мод
 * (EmoteSkeleton.poseOf). Разбор обязан быть обратимым: собранный обратно
 * поворот совпадает с матрицей кости. Лишний знак у z гасил ошибку чтения
 * клипа ровно для одной вращающейся кости и не гасил её на цепочке - тогда
 * тело уезжало от ног.
 */
/**
 * Where the game itself keeps the pivot of each part, in its own frame - the
 * height already counts downwards.
 */
const GAME_PIVOTS: Record<string, [number, number, number]> = {
  head: [0, 0, 0],
  body: [0, 0, 0],
  arm_left: [5, 2, 0],
  arm_right: [-5, 2, 0],
  leg_left: [1.9, 12, 0],
  leg_right: [-1.9, 12, 0],
}

/**
 * How far the clip moved the point the game treats as this part's pivot.
 *
 * An artist hangs the body bone of an emote twelve pixels below that point -
 * 98 of the hundred emotes do - so the travel of the bone's own origin sends
 * the part around a different centre, and the torso leaves the arms and legs
 * behind the moment the clip turns the body.
 */
function shiftOf(now: Matrix, was: Matrix, pivot: [number, number, number]): [number, number, number] {
  const dx = pivot[0] - was[3]!
  const dy = pivot[1] - was[7]!
  const dz = pivot[2] - was[11]!
  const back = rowsOf(was)
  const lx = back[0]! * dx + back[3]! * dy + back[6]! * dz
  const ly = back[1]! * dx + back[4]! * dy + back[7]! * dz
  const lz = back[2]! * dx + back[5]! * dy + back[8]! * dz
  return [
    now[3]! + now[0]! * lx + now[1]! * ly + now[2]! * lz - pivot[0],
    now[7]! + now[4]! * lx + now[5]! * ly + now[6]! * lz - pivot[1],
    now[11]! + now[8]! * lx + now[9]! * ly + now[10]! * lz - pivot[2],
  ]
}

function turnOf(r: number[]): [number, number, number] {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return [Math.atan2(r[7]!, r[8]!), Math.asin(-clamp(r[6]!)), Math.atan2(r[3]!, r[0]!)]
}

/**
 * The player's body as the artist animated it, built the way the mod builds it.
 *
 * An emote file carries its own copy of the player skeleton, often a long chain
 * of wrappers - root, orbit, angle, body, shoulder, arm. Turning each part of
 * the figure by its own clip angle alone ignores everything above it: when a
 * breakdance lays the body on its side, the arms and legs stayed where a
 * standing player keeps them and the figure fell apart. Here the whole chain is
 * multiplied down, and each part gets the place and turn it really ends up in.
 */
export class EmoteSkeleton {
  private readonly bones: MeshBone[]
  private readonly index = new Map<string, number>()
  private readonly offsets: [number, number, number][]
  private readonly rest: Matrix[]

  private constructor(bones: MeshBone[]) {
    this.bones = bones
    bones.forEach((bone, i) => this.index.set(bone.name.toLowerCase(), i))
    this.offsets = bones.map((bone) => {
      const parentIndex = bone.parent ? this.index.get(bone.parent.toLowerCase()) : undefined
      const parent = parentIndex === undefined ? undefined : bones[parentIndex]
      return parent
        ? [bone.pivot[0] - parent.pivot[0], bone.pivot[1] - parent.pivot[1], bone.pivot[2] - parent.pivot[2]]
        : [bone.pivot[0], bone.pivot[1], bone.pivot[2]]
    })
    this.rest = this.bake(null, 0)
  }

  static of(geometry: unknown): EmoteSkeleton | null {
    const mesh = readCosmeticMesh(geometry)
    if (!mesh) return null
    const skeleton = new EmoteSkeleton(mesh.bones)
    return skeleton.usable() ? skeleton : null
  }

  /** An emote that carries no player bones moves nothing here. */
  usable(): boolean {
    return Object.keys(EMOTE_PARTS).some((name) => this.boneIndex(name) >= 0)
  }

  private boneIndex(name: string): number {
    const direct = this.index.get(name)
    if (direct !== undefined) return direct
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      if (canonical !== name) continue
      const found = this.index.get(alias)
      if (found !== undefined) return found
    }
    return -1
  }

  private bake(clip: AnimationClip | null, seconds: number): Matrix[] {
    const out: (Matrix | undefined)[] = new Array(this.bones.length)
    const visit = (i: number, trail: Set<number>): Matrix => {
      const done = out[i]
      if (done) return done
      const bone = this.bones[i]!
      const pose = clip ? poseOf(clip, bone.name, seconds) : null
      let local = rotation(radians(-bone.rotation[0]), radians(bone.rotation[1]), radians(-bone.rotation[2]))
      if (pose) {
        // poseOf already flips x and z of the turn and y of the shift the way the
        // mod's MeshPose does, so its numbers go into the matrix as they are.
        // Flipping them again here swung every limb the opposite way.
        const [px, py, pz] = pose.rotation
        if (px || py || pz) local = multiply(local, rotation(radians(px), radians(py), radians(pz)))
        const [sx, sy, sz] = pose.scale
        for (let row = 0; row < 3; row++) {
          local[row * 4] = local[row * 4]! * sx
          local[row * 4 + 1] = local[row * 4 + 1]! * sy
          local[row * 4 + 2] = local[row * 4 + 2]! * sz
        }
      }
      const offset = this.offsets[i]!
      local[3] = offset[0] + (pose ? pose.position[0] : 0)
      local[7] = offset[1] + (pose ? pose.position[1] : 0)
      local[11] = offset[2] + (pose ? pose.position[2] : 0)
      const parentIndex = bone.parent ? (this.index.get(bone.parent.toLowerCase()) ?? -1) : -1
      // A file that names its own descendant as a parent would loop forever.
      const matrix =
        parentIndex >= 0 && !trail.has(parentIndex)
          ? multiply(visit(parentIndex, new Set(trail).add(parentIndex)), local)
          : local
      out[i] = matrix
      return matrix
    }
    for (let i = 0; i < this.bones.length; i++) visit(i, new Set([i]))
    return out as Matrix[]
  }

  /** Poses of the six player parts at a moment of the clip; parts the file lacks are left out. */
  poseAt(clip: AnimationClip, seconds: number): Record<string, PartPose> {
    const now = this.bake(clip, seconds)
    const out: Record<string, PartPose> = {}
    for (const name of Object.keys(EMOTE_PARTS)) {
      const i = this.boneIndex(name)
      if (i < 0) continue
      const m = now[i]!
      const was = this.rest[i]!
      const rows = rowsOf(m)
      out[name] = {
        shift: shiftOf(m, was, GAME_PIVOTS[name]!),
        turn: turnOf(rows),
        matrix: rows,
        pivot: GAME_PIVOTS[name]!,
      }
    }
    return out
  }
}
