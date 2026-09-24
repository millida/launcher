import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Object3D } from 'three'
import { poseOf, type AnimationClip } from './cosmeticAnimation'
import { EMOTE_PARTS, EmoteSkeleton } from './emoteSkeleton'
import type { EmoteSequence } from './emoteSequence'

/** Кость клипа -> часть фигуры в просмотрщике. */
const PART_BY_BONE: Record<string, string> = {
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

const radians = (degrees: number) => (degrees * Math.PI) / 180

interface Placed {
  rotation: { x: number; y: number; z: number; order: string }
  position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }
  userData: Record<string, unknown>
}

interface Figure {
  skin: Record<string, Placed>
  position: { y: number }
  cape?: Object3D
}

/**
 * Плащ висит отдельно от тела: эмоция двигает тело, а плащ оставался на месте
 * (владелец 23.09.2026: «плащ Twitch не двигался, пока персонаж танцевал»).
 * Плащу даём то же смещение и поворот, что тело получило от позы покоя.
 */
const CAPE_REST = new Euler((10.8 * Math.PI) / 180, Math.PI, 0, 'XYZ')
function followBody(figure: Figure): void {
  const cape = figure.cape
  const body = figure.skin.body as unknown as Object3D | undefined
  if (!cape || !body) return
  const br = restOf(body as unknown as Placed)
  const cr = restOf(cape as unknown as Placed)
  const restM = new Matrix4().compose(new Vector3(cr[0], cr[1], cr[2]), new Quaternion().setFromEuler(CAPE_REST), new Vector3(1, 1, 1))
  const delta = new Matrix4()
    .makeTranslation(body.position.x, body.position.y, body.position.z)
    .multiply(new Matrix4().makeRotationFromEuler(body.rotation))
    .multiply(new Matrix4().makeTranslation(-br[0], -br[1], -br[2]))
  delta.multiply(restM).decompose(cape.position, cape.quaternion, new Vector3())
}

/**
 * Where a part of the figure stands when nothing moves it. Kept on the part
 * itself: the engine resets only turns between animations, and a shifted arm
 * would otherwise stay shifted after the emote ends.
 */
export const REST_KEY = 'millidaRest'

function restOf(part: Placed): [number, number, number] {
  const known = part.userData[REST_KEY] as [number, number, number] | undefined
  if (known) return known
  const rest: [number, number, number] = [part.position.x, part.position.y, part.position.z]
  part.userData[REST_KEY] = rest
  return rest
}

/**
 * Эмоция: клип двигает не вещь, а самого игрока, поэтому она подменяет собой
 * обычную анимацию фигуры.
 *
 * Поза считается по всему скелету из файла эмоции, как в моде: иначе, когда
 * танец кладёт корпус набок, руки и ноги оставались на месте стоящего игрока и
 * фигура разваливалась. У игры высота и спина смотрят в другую сторону, чем у
 * просмотрщика, поэтому у поворотов по y и z и у сдвигов по y и z знак обратный.
 *
 * Ноги ведёт клип: иначе движок держит их в своей позе, и присед эмоции
 * заканчивается стоячими ногами.
 */
export class CosmeticEmote {
  speed = 1
  paused = false
  progress = 0
  readonly controlsLegs = true
  private readonly skeleton: EmoteSkeleton | null

  constructor(
    private readonly sequence: EmoteSequence,
    geometry?: unknown,
  ) {
    this.skeleton = geometry ? EmoteSkeleton.of(geometry) : null
  }

  update(player: unknown, deltaTime: number): void {
    if (!this.paused) this.progress += deltaTime * this.speed
    const figure = player as Figure
    const clip = this.sequence.clipAt(this.progress)
    const seconds = this.sequence.timeAt(this.progress)
    if (this.skeleton) {
      this.skeletal(figure, clip, seconds)
      followBody(figure)
      return
    }
    for (const [bone, part] of Object.entries(PART_BY_BONE)) {
      const pose = poseOf(clip, bone, seconds)
      const target = figure.skin[part]
      if (!pose || !target) continue
      target.rotation.order = 'ZYX'
      target.rotation.x = radians(pose.rotation[0])
      target.rotation.y = radians(-pose.rotation[1])
      target.rotation.z = radians(-pose.rotation[2])
    }
    // Подъём и присед клип задаёт корню: без этого прыжок эмоции стоит на месте.
    const root = poseOf(clip, 'root', seconds) ?? poseOf(clip, 'body', seconds)
    if (root) figure.position.y = root.position[1]
    followBody(figure)
  }

  private skeletal(figure: Figure, clip: AnimationClip, seconds: number): void {
    const poses = this.skeleton!.poseAt(clip, seconds)
    for (const [bone, partName] of Object.entries(EMOTE_PARTS)) {
      const pose = poses[bone]
      const part = figure.skin[partName]
      if (!pose || !part) continue
      const rest = restOf(part)
      part.rotation.order = 'ZYX'
      part.rotation.x = pose.turn[0]
      part.rotation.y = -pose.turn[1]
      part.rotation.z = -pose.turn[2]
      // The viewer turns a part about the origin of its group, the game about the
      // bone's pivot. They agree for the head and the limbs, but the body group
      // sits at the middle of the torso while the game turns it at the neck:
      // turned about the wrong point, the torso drifted off the arms and legs.
      // The gap between the two points, turned with the part, is added back.
      const gap = [rest[0] - pose.pivot[0], -rest[1] - pose.pivot[1], -rest[2] - pose.pivot[2]]
      const m = pose.matrix
      const turned = [
        m[0]! * gap[0]! + m[1]! * gap[1]! + m[2]! * gap[2]! - gap[0]!,
        m[3]! * gap[0]! + m[4]! * gap[1]! + m[5]! * gap[2]! - gap[1]!,
        m[6]! * gap[0]! + m[7]! * gap[1]! + m[8]! * gap[2]! - gap[2]!,
      ]
      part.position.set(
        rest[0] + pose.shift[0] + turned[0]!,
        rest[1] - pose.shift[1] - turned[1]!,
        rest[2] - pose.shift[2] - turned[2]!,
      )
    }
  }
}

/**
 * Клип эмоции. Имя приходит из каталога: у эмоции бывает и начало, и петля, и
 * без имени играла бы та, что просто стоит первой в файле.
 */
export function emoteClip(
  clips: Record<string, AnimationClip>,
  name?: string,
): AnimationClip | null {
  if (name && clips[name]) return clips[name] as AnimationClip
  const list = Object.values(clips)
  if (!list.length) return null
  return list.find((clip) => clip.loop) ?? (list[0] as AnimationClip)
}
