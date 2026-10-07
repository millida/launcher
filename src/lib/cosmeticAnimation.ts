/**
 * Анимации Bedrock, как их читает мод.
 *
 * Правила знаков взяты оттуда же (AnimationCodec.turned + MeshPose.animate):
 * формат считает углы вокруг x и y в обратную сторону, а высоту - вниз. Если
 * ошибиться в знаке, крылья загибаются вперёд, а у эмоции руки складываются
 * крест-накрест - это уже проверено на живых вещах в игре.
 */

import { compileMolang, type Molang, type MolangClock } from './molang'

export type Interpolation = 'linear' | 'catmullrom'

/** A number, or a Molang expression read at the moment of the clip. */
export type Component = number | Molang
export type Vector = [Component, Component, Component]

export interface Keyframe {
  time: number
  /** The value the curve leaves this keyframe with. */
  value: Vector
  /**
   * The value it arrives at, when the file switches here - `{"pre": 1, "post": 0}`
   * is an instant change. The cat of "Cat cuddle" blinks that way; read as one
   * value, its head shrank for two seconds and slid off its ears.
   */
  before?: Vector
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

const component = (value: unknown, fallback: number): Component => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return compileMolang(value) ?? fallback
  return fallback
}

const numbers = (value: unknown, fallback: number): Vector => {
  if (typeof value === 'number' || typeof value === 'string') {
    const one = component(value, fallback)
    return [one, one, one]
  }
  if (Array.isArray(value)) return [component(value[0], fallback), component(value[1], fallback), component(value[2], fallback)]
  return [fallback, fallback, fallback]
}

const negated = (value: Component): Component =>
  typeof value === 'number' ? -value : (clock: MolangClock) => -value(clock)

const resolved = (value: Vector, clock: MolangClock): [number, number, number] =>
  value.map((part) => (typeof part === 'number' ? part : part(clock))) as [number, number, number]

function frames(source: unknown, fallback: number): Keyframe[] {
  if (source === null || source === undefined) return []
  if (typeof source === 'number' || typeof source === 'string' || Array.isArray(source)) {
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
    value: [negated(frame.value[0]), frame.value[1], negated(frame.value[2])] as Vector,
    ...(frame.before ? { before: [negated(frame.before[0]), frame.before[1], negated(frame.before[2])] as Vector } : {}),
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

function at(list: Keyframe[], clock: MolangClock, fallback: number): [number, number, number] {
  if (!list.length) return [fallback, fallback, fallback]
  const time = clock.animTime
  const first = list[0] as Keyframe
  if (time < first.time) return resolved(first.before ?? first.value, clock)
  if (time === first.time || list.length === 1) return resolved(first.value, clock)
  const last = list[list.length - 1] as Keyframe
  if (time >= last.time) return resolved(last.value, clock)
  for (let i = 0; i < list.length - 1; i += 1) {
    const from = list[i] as Keyframe
    const to = list[i + 1] as Keyframe
    if (time < from.time || time > to.time) continue
    const span = to.time - from.time
    const k = span <= 0 ? 0 : (time - from.time) / span
    // The key the curve leaves sets its easing: the game eases a segment by its opening key.
    const t = from.interpolation === 'catmullrom' ? k * k * (3 - 2 * k) : k
    const start = resolved(from.value, clock)
    const target = resolved(to.before ?? to.value, clock)
    return [
      start[0] + (target[0] - start[0]) * t,
      start[1] + (target[1] - start[1]) * t,
      start[2] + (target[2] - start[2]) * t,
    ]
  }
  return resolved(last.value, clock)
}

/** Поза одной кости в этот момент клипа, уже в знаках игры. */
export function poseOf(clip: AnimationClip, bone: string, seconds: number): BonePose | null {
  const body = clip.bones[bone]
  if (!body) return null
  const time = clip.length > 0 ? (clip.loop ? seconds % clip.length : Math.min(seconds, clip.length)) : 0
  const clock: MolangClock = { animTime: time, lifeTime: seconds }
  const rotation = at(body.rotation, clock, 0)
  const position = at(body.position, clock, 0)
  const scale = at(body.scale, clock, 1)
  return {
    rotation: [-rotation[0], rotation[1], -rotation[2]],
    position: [position[0], -position[1], position[2]],
    scale,
  }
}
