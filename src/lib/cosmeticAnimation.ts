/**
 * Анимации Bedrock, как их читает мод.
 *
 * Правила знаков взяты оттуда же (AnimationCodec.turned + MeshPose.animate):
 * формат считает углы вокруг x и y в обратную сторону, а высоту - вниз. Если
 * ошибиться в знаке, крылья загибаются вперёд, а у эмоции руки складываются
 * крест-накрест - это уже проверено на живых вещах в игре.
 */

export type Interpolation = 'linear' | 'catmullrom'

export interface Keyframe {
  time: number
  /** The value the curve leaves this keyframe with. */
  value: [number, number, number]
  /**
   * The value it arrives at, when the file switches here - `{"pre": 1, "post": 0}`
   * is an instant change. The cat of "Cat cuddle" blinks that way; read as one
   * value, its head shrank for two seconds and slid off its ears.
   */
  before?: [number, number, number]
  interpolation: Interpolation
}

export interface BoneClip {
  rotation: Keyframe[]
  position: Keyframe[]
  scale: Keyframe[]
}

export interface AnimationClip {
  name: string
  length: number
  loop: boolean
  /**
   * The file says `"loop": true` - the clip plays until stopped. `loop` above is
   * looser on purpose: a piece idles on a clip that simply omits the flag. An
   * emote has to tell its loop from its wind-up the way the mod does.
   */
  endless?: boolean
  bones: Record<string, BoneClip>
}

export interface BonePose {
  rotation: [number, number, number]
  position: [number, number, number]
  scale: [number, number, number]
}

const numbers = (value: unknown, fallback: number): [number, number, number] => {
  if (typeof value === 'number') return [value, value, value]
  if (Array.isArray(value)) {
    const at = (i: number) => (typeof value[i] === 'number' ? (value[i] as number) : fallback)
    return [at(0), at(1), at(2)]
  }
  return [fallback, fallback, fallback]
}

function frames(source: unknown, fallback: number): Keyframe[] {
  if (source === null || source === undefined) return []
  if (typeof source === 'number' || Array.isArray(source)) {
    return [{ time: 0, value: numbers(source, fallback), interpolation: 'linear' }]
  }
  if (typeof source !== 'object') return []
  const out: Keyframe[] = []
  for (const [key, body] of Object.entries(source as Record<string, unknown>)) {
    const time = Number(key)
    if (!Number.isFinite(time)) continue
    let value: unknown = body
    let arriving: unknown = undefined
    let interpolation: Interpolation = 'linear'
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const frame = body as Record<string, unknown>
      if (typeof frame['lerp_mode'] === 'string') {
        interpolation = String(frame['lerp_mode']).toLowerCase() === 'catmullrom' ? 'catmullrom' : 'linear'
      }
      value = frame['post'] ?? frame['pre'] ?? frame['vector']
      arriving = frame['pre']
    }
    if (value === null || value === undefined) continue
    const leaving = numbers(value, fallback)
    out.push({
      time,
      value: leaving,
      ...(arriving !== undefined && arriving !== null ? { before: numbers(arriving, fallback) } : {}),
      interpolation,
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

/**
 * Поворот формата читается так же, как у костей геометрии: в обратную сторону
 * вокруг x и вокруг z. Прежде тут разворачивались x и y, и один и тот же угол
 * в кости и в клипе давал разный разворот - фигуру на эмоции разносило.
 */
const turned = (list: Keyframe[]): Keyframe[] =>
  list.map((frame) => ({
    ...frame,
    value: [-frame.value[0], frame.value[1], -frame.value[2]] as [number, number, number],
    ...(frame.before
      ? { before: [-frame.before[0], frame.before[1], -frame.before[2]] as [number, number, number] }
      : {}),
  }))

const lastTime = (list: Keyframe[]) => (list.length ? (list[list.length - 1] as Keyframe).time : 0)

export function readAnimations(source: unknown): Record<string, AnimationClip> {
  const root = source as Record<string, unknown> | null
  const body = root && typeof root === 'object' ? (root['animations'] ?? root) : null
  if (!body || typeof body !== 'object') return {}
  const clips: Record<string, AnimationClip> = {}
  for (const [name, raw] of Object.entries(body as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const clip = raw as Record<string, unknown>
    const bones: Record<string, BoneClip> = {}
    const boneRoot = clip['bones']
    if (boneRoot && typeof boneRoot === 'object') {
      for (const [boneName, boneRaw] of Object.entries(boneRoot as Record<string, unknown>)) {
        if (!boneRaw || typeof boneRaw !== 'object') continue
        const bone = boneRaw as Record<string, unknown>
        bones[boneName] = {
          rotation: turned(frames(bone['rotation'], 0)),
          position: frames(bone['position'], 0),
          scale: frames(bone['scale'], 1),
        }
      }
    }
    let length = Number(clip['animation_length']) || 0
    if (length <= 0) {
      for (const bone of Object.values(bones)) {
        length = Math.max(length, lastTime(bone.rotation), lastTime(bone.position), lastTime(bone.scale))
      }
    }
    if (!Object.keys(bones).length) continue
    clips[name] = { name, length, loop: clip['loop'] !== false, endless: clip['loop'] === true, bones }
  }
  return clips
}

function at(list: Keyframe[], time: number, fallback: number): [number, number, number] {
  if (!list.length) return [fallback, fallback, fallback]
  const first = list[0] as Keyframe
  if (time < first.time) return first.before ?? first.value
  if (time === first.time || list.length === 1) return first.value
  const last = list[list.length - 1] as Keyframe
  if (time >= last.time) return last.value
  for (let i = 0; i < list.length - 1; i += 1) {
    const from = list[i] as Keyframe
    const to = list[i + 1] as Keyframe
    if (time < from.time || time > to.time) continue
    const span = to.time - from.time
    const k = span <= 0 ? 0 : (time - from.time) / span
    // The key the curve leaves sets its easing: the game eases a segment by its opening key.
    const t = from.interpolation === 'catmullrom' ? k * k * (3 - 2 * k) : k
    const target = to.before ?? to.value
    return [
      from.value[0] + (target[0] - from.value[0]) * t,
      from.value[1] + (target[1] - from.value[1]) * t,
      from.value[2] + (target[2] - from.value[2]) * t,
    ]
  }
  return last.value
}

/** Поза одной кости в этот момент клипа, уже в знаках игры. */
export function poseOf(clip: AnimationClip, bone: string, seconds: number): BonePose | null {
  const body = clip.bones[bone]
  if (!body) return null
  const time = clip.length > 0 ? (clip.loop ? seconds % clip.length : Math.min(seconds, clip.length)) : 0
  const rotation = at(body.rotation, time, 0)
  const position = at(body.position, time, 0)
  const scale = at(body.scale, time, 1)
  return {
    rotation: [-rotation[0], rotation[1], -rotation[2]],
    position: [position[0], -position[1], position[2]],
    scale,
  }
}
