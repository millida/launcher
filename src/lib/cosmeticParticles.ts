import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NormalBlending,
  Object3D,
  PointLight,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Camera,
  type Texture,
} from 'three'
import { compileMolang, type MolangClock } from './molang'
import { poseOf, readAnimations, type AnimationClip } from './cosmeticAnimation'
import { readCosmeticMesh, readLocators } from './cosmeticGeometry'
import { anchorShift, buildRig, type CosmeticAnchor } from './cosmeticPlacement'
import { poseJoint } from './cosmeticModel'
import { PARTICLE_WARM_SECONDS } from './cosmeticParticleData'
import { LightMap, haloTexture, lightMaterial, type Rgb } from './cosmeticGlow'

export interface ParticlePack {
  effects: Record<string, unknown>
  animations: Record<string, unknown>
  triggers: unknown[]
}

export interface ParticlePiece {
  anchor: CosmeticAnchor
  object: Object3D
}

type Ctx = MolangClock & { vars: Record<string, number> }
type Num = (ctx: Ctx) => number
type Vec = [Num, Num, Num]
type Rgba = [number, number, number, number]
type Step = (ctx: Ctx) => void

const PIXELS_PER_BLOCK = 16
const FEET_BELOW_NECK = 24
const MAX_PARTICLES = 4000
const MAX_EMITTERS = 96
const TRANSIENT_SECONDS = 5
const MAX_STEP = 0.1
const WARM_STEP = 1 / 30

/** Soft light around a bright particle: how far it reaches past the sprite, and how strong it is. */
const HALO_REACH = 1.7
const HALO_PAD = 0.06
const HALO_POWER = 0.34
/** Sprites this big (blocks) are light by themselves: a halo around them would only wash the figure out. */
const HALO_FULL = 0.16
const HALO_NONE = 0.9
/** Effects drawn with plain transparency that are fire all the same. */
const HOT = /magma|blaze|ember|demonic/
const COLD = /smoke|dust|ash/
/** The light an effect throws on the figure and on the floor in a showcase. */
const LAMP_POWER = 2.6
const LAMP_REACH = 64
const LAMP_EASE = 5
const FLOOR_RADIUS = 1.35
const FLOOR_POWER = 0.5

const roll = () => Math.random()
const DEG = Math.PI / 180

function num(value: unknown, fallback = 0): Num {
  if (typeof value === 'number') return () => value
  if (typeof value === 'boolean') return () => (value ? 1 : 0)
  if (typeof value === 'string') {
    const compiled = compileMolang(value)
    if (compiled) return compiled as Num
    const plain = Number(value)
    return Number.isFinite(plain) ? () => plain : () => fallback
  }
  return () => fallback
}

function vec(value: unknown, fallback = 0): Vec | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return [num(value[0], fallback), num(value[1], fallback), num(value[2], fallback)]
  const one = num(value, fallback)
  return [one, one, one]
}

function pair(value: unknown, fallback = 0): [Num, Num] {
  if (Array.isArray(value)) return [num(value[0], fallback), num(value[1], fallback)]
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return [num(v['first'], fallback), num(v['second'], fallback)]
  }
  const one = num(value, fallback)
  return [one, one]
}

const evalVec = (v: Vec, ctx: Ctx, out: Vector3) => out.set(v[0](ctx), v[1](ctx), v[2](ctx))

function balanced(text: string): boolean {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') depth -= 1
    if (depth === 0 && i < text.length - 1) return false
  }
  return depth === 0
}

function peel(raw: string): string {
  let text = raw.trim()
  let open = (text.match(/\(/g) ?? []).length
  let close = (text.match(/\)/g) ?? []).length
  while (close > open && text.endsWith(')')) {
    text = text.slice(0, -1).trim()
    close -= 1
  }
  while (open > close && text.startsWith('(')) {
    text = text.slice(1).trim()
    open -= 1
  }
  while (text.startsWith('(') && text.endsWith(')') && balanced(text)) text = text.slice(1, -1).trim()
  return text
}

function program(source: unknown): Step | null {
  if (typeof source !== 'string') return null
  const steps: Step[] = []
  for (const raw of source.replace(/[{}]/g, '').split(';')) {
    const text = peel(raw)
    const hit = /^((?:variable|v|temp|t)\.[a-z0-9_.]+)\s*=(?!=)([\s\S]+)$/i.exec(text)
    if (!hit) continue
    const name = (hit[1] as string).toLowerCase().replace(/^v\./, 'variable.').replace(/^t\./, 'temp.')
    const value = compileMolang(peel(hit[2] as string))
    if (value) steps.push((ctx) => (ctx.vars[name] = value(ctx)))
  }
  return steps.length ? (ctx) => steps.forEach((step) => step(ctx)) : null
}

interface Curve {
  name: string
  nodes: number[]
  input: Num
  range: Num
}

function readCurves(raw: unknown): Curve[] {
  if (!raw || typeof raw !== 'object') return []
  const out: Curve[] = []
  for (const [name, body] of Object.entries(raw as Record<string, unknown>)) {
    if (!body || typeof body !== 'object') continue
    const curve = body as Record<string, unknown>
    let nodes = Array.isArray(curve['nodes']) ? (curve['nodes'] as unknown[]).map((n) => Number(n) || 0) : []
    if (String(curve['type']) === 'catmull_rom' && nodes.length > 3) nodes = nodes.slice(1, -1)
    if (!nodes.length) continue
    out.push({ name: name.toLowerCase(), nodes, input: num(curve['input']), range: num(curve['horizontal_range'], 1) })
  }
  return out
}

function applyCurves(curves: Curve[], ctx: Ctx): void {
  for (const curve of curves) {
    const range = curve.range(ctx) || 1
    const t = Math.min(1, Math.max(0, curve.input(ctx) / range))
    const last = curve.nodes.length - 1
    if (last <= 0) {
      ctx.vars[curve.name] = curve.nodes[0] as number
      continue
    }
    const at = t * last
    const i = Math.min(last - 1, Math.floor(at))
    const k = at - i
    ctx.vars[curve.name] = (curve.nodes[i] as number) + ((curve.nodes[i + 1] as number) - (curve.nodes[i] as number)) * k
  }
}

function hexColor(text: string): Rgba | null {
  const hex = text.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
  return hex.length === 8 ? [n(2), n(4), n(6), n(0)] : [n(0), n(2), n(4), 1]
}

function fixedColor(value: unknown): Rgba | null {
  if (typeof value === 'string') return hexColor(value)
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    const [r = 1, g = 1, b = 1, a = 1] = value as number[]
    return [r, g, b, a]
  }
  return null
}

type Tint =
  | { kind: 'fixed'; rgba: [Num, Num, Num, Num] }
  | { kind: 'gradient'; stops: { at: number; rgba: Rgba }[]; interpolant: Num }

function readTint(raw: unknown): Tint {
  const color = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['color'] : undefined
  if (color && typeof color === 'object' && !Array.isArray(color) && 'gradient' in (color as object)) {
    const body = color as Record<string, unknown>
    const gradient = body['gradient']
    const stops: { at: number; rgba: Rgba }[] = []
    if (Array.isArray(gradient)) {
      gradient.forEach((entry, i) => {
        const rgba = fixedColor(entry)
        if (rgba) stops.push({ at: gradient.length > 1 ? i / (gradient.length - 1) : 0, rgba })
      })
    } else if (gradient && typeof gradient === 'object') {
      for (const [key, entry] of Object.entries(gradient as Record<string, unknown>)) {
        const rgba = fixedColor(entry)
        if (rgba && Number.isFinite(Number(key))) stops.push({ at: Number(key), rgba })
      }
      stops.sort((a, b) => a.at - b.at)
    }
    if (stops.length) return { kind: 'gradient', stops, interpolant: num(body['interpolant']) }
  }
  const fixed = fixedColor(color)
  if (fixed) return { kind: 'fixed', rgba: [() => fixed[0], () => fixed[1], () => fixed[2], () => fixed[3]] }
  if (Array.isArray(color)) return { kind: 'fixed', rgba: [num(color[0], 1), num(color[1], 1), num(color[2], 1), num(color[3], 1)] }
  return { kind: 'fixed', rgba: [() => 1, () => 1, () => 1, () => 1] }
}

function tintAt(tint: Tint, ctx: Ctx, out: Rgba): void {
  if (tint.kind === 'fixed') {
    out[0] = tint.rgba[0](ctx)
    out[1] = tint.rgba[1](ctx)
    out[2] = tint.rgba[2](ctx)
    out[3] = tint.rgba[3](ctx)
    return
  }
  const stops = tint.stops
  const t = tint.interpolant(ctx)
  const first = stops[0] as { at: number; rgba: Rgba }
  const last = stops[stops.length - 1] as { at: number; rgba: Rgba }
  let from = first
  let to = first
  if (t <= first.at) to = first
  else if (t >= last.at) from = to = last
  else {
    for (let i = 0; i < stops.length - 1; i += 1) {
      const a = stops[i] as { at: number; rgba: Rgba }
      const b = stops[i + 1] as { at: number; rgba: Rgba }
      if (t >= a.at && t <= b.at) {
        from = a
        to = b
        break
      }
    }
  }
  const span = to.at - from.at
  const k = span > 0 ? (t - from.at) / span : 0
  for (let c = 0; c < 4; c += 1) out[c] = (from.rgba[c] as number) + ((to.rgba[c] as number) - (from.rgba[c] as number)) * k
}

type Shape = {
  kind: 'point' | 'sphere' | 'box' | 'disc' | 'aabb'
  offset: Vec | null
  radius: Num
  half: Vec | null
  surface: boolean
  normal: Vec | null
  direction: 'outwards' | 'inwards' | Vec
}

function readShape(components: Record<string, unknown>): Shape {
  const kinds: [string, Shape['kind']][] = [
    ['minecraft:emitter_shape_sphere', 'sphere'],
    ['minecraft:emitter_shape_box', 'box'],
    ['minecraft:emitter_shape_disc', 'disc'],
    ['minecraft:emitter_shape_entity_aabb', 'aabb'],
    ['minecraft:emitter_shape_point', 'point'],
  ]
  for (const [key, kind] of kinds) {
    const body = components[key]
    if (!body || typeof body !== 'object') continue
    const shape = body as Record<string, unknown>
    const direction = shape['direction']
    const plane = shape['plane_normal']
    return {
      kind,
      offset: vec(shape['offset']),
      radius: num(shape['radius'], 1),
      half: vec(shape['half_dimensions']),
      surface: shape['surface_only'] === true,
      normal: plane === 'x' ? vec([1, 0, 0]) : plane === 'z' ? vec([0, 0, 1]) : Array.isArray(plane) ? vec(plane) : null,
      direction:
        direction === undefined && kind === 'point'
          ? (vec([0, 0, 0]) as Vec)
          : direction === 'inwards'
            ? 'inwards'
            : direction === 'outwards' || direction === undefined
              ? 'outwards'
              : (vec(direction) ?? 'outwards'),
    }
  }
  return { kind: 'point', offset: null, radius: () => 0, half: null, surface: false, normal: null, direction: 'outwards' }
}

const UP = new Vector3(0, 1, 0)
const scratchA = new Vector3()
const scratchB = new Vector3()
const scratchN = new Vector3()

function randomUnit(out: Vector3): Vector3 {
  const z = roll() * 2 - 1
  const a = roll() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return out.set(r * Math.cos(a), z, r * Math.sin(a))
}

function sampleShape(shape: Shape, ctx: Ctx, position: Vector3, direction: Vector3): void {
  position.set(0, 0, 0)
  switch (shape.kind) {
    case 'sphere': {
      const radius = shape.radius(ctx)
      randomUnit(direction)
      position.copy(direction).multiplyScalar(shape.surface ? radius : radius * Math.cbrt(roll()))
      break
    }
    case 'box':
    case 'aabb': {
      const half = shape.kind === 'aabb' ? scratchA.set(0.3, 0.9, 0.3) : shape.half ? evalVec(shape.half, ctx, scratchA) : scratchA.set(0, 0, 0)
      position.set((roll() * 2 - 1) * half.x, (roll() * 2 - 1) * half.y, (roll() * 2 - 1) * half.z)
      if (shape.surface) {
        const axis = Math.floor(roll() * 3)
        const side = roll() < 0.5 ? -1 : 1
        position.setComponent(axis, side * half.getComponent(axis))
      }
      if (shape.kind === 'aabb') position.y += 0.9
      direction.copy(position)
      if (direction.lengthSq() < 1e-8) randomUnit(direction)
      direction.normalize()
      break
    }
    case 'disc': {
      const normal = shape.normal ? evalVec(shape.normal, ctx, scratchN) : scratchN.copy(UP)
      if (normal.lengthSq() < 1e-8) normal.copy(UP)
      normal.normalize()
      const a = Math.abs(normal.y) < 0.99 ? scratchA.crossVectors(normal, UP).normalize() : scratchA.set(1, 0, 0)
      const b = scratchB.crossVectors(normal, a).normalize()
      const radius = shape.radius(ctx)
      const angle = roll() * Math.PI * 2
      const dist = shape.surface ? radius : radius * Math.sqrt(roll())
      position.copy(a).multiplyScalar(Math.cos(angle) * dist).addScaledVector(b, Math.sin(angle) * dist)
      direction.copy(position)
      if (direction.lengthSq() < 1e-8) direction.copy(a)
      direction.normalize()
      break
    }
    default:
      randomUnit(direction)
  }
  if (shape.direction === 'inwards') direction.negate()
  else if (shape.direction !== 'outwards') evalVec(shape.direction, ctx, direction)
  if (shape.offset) position.add(evalVec(shape.offset, ctx, scratchA))
}

type Lifetime =
  | { kind: 'once'; active: Num }
  | { kind: 'looping'; active: Num; sleep: Num }
  | { kind: 'expression'; activation: Num; expiration: Num }

type Rate = { kind: 'instant'; count: Num } | { kind: 'steady'; rate: Num; max: Num } | null

type Uv =
  | { kind: 'static'; w: number; h: number; u: Num; v: Num; du: Num; dv: Num }
  | { kind: 'flipbook'; w: number; h: number; baseU: Num; baseV: Num; du: number; dv: number; stepU: number; stepV: number; fps: Num; max: Num; stretch: boolean; loop: boolean }
  | { kind: 'full' }

interface Def {
  id: string
  additive: boolean
  glow: number
  cutout: boolean
  curves: Curve[]
  init: Step | null
  perUpdate: Step | null
  perParticle: Step | null
  lifetime: Lifetime | null
  rate: Rate
  local: boolean
  shape: Shape
  life: Num
  expire: Num | null
  speed: Num | Vec
  spin: Num
  spinRate: Num
  dynamic: boolean
  accel: Vec | null
  drag: Num
  spinAccel: Num
  spinDrag: Num
  parametric: { position: Vec | null; rotation: Num | null } | null
  collision: { radius: Num; drag: number; bounce: number; expire: boolean } | null
  size: [Num, Num]
  facing: string
  custom: Vec | null
  uv: Uv
  tint: Tint
  onCreate: string[]
  onExpire: string[]
  timeline: { at: number; events: string[] }[]
  events: Record<string, string[]>
}

const listOf = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

function eventEffects(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const body = raw as Record<string, unknown>
  const out: string[] = []
  const own = body['particle_effect'] as Record<string, unknown> | undefined
  if (own && typeof own['effect'] === 'string') out.push(own['effect'])
  for (const key of ['sequence', 'randomize']) {
    const list = body[key]
    if (Array.isArray(list)) for (const entry of list) out.push(...eventEffects(entry))
  }
  return out
}

function readUv(billboard: Record<string, unknown>): Uv {
  const uv = billboard['uv'] as Record<string, unknown> | undefined
  if (!uv || typeof uv !== 'object') return { kind: 'full' }
  const w = Number(uv['texture_width']) || 1
  const h = Number(uv['texture_height']) || 1
  const flip = uv['flipbook'] as Record<string, unknown> | undefined
  if (flip && typeof flip === 'object') {
    const [baseU, baseV] = pair(flip['base_UV'])
    const size = pair(flip['size_UV'])
    const step = pair(flip['step_UV'])
    const zero = { animTime: 0, lifeTime: 0, vars: {} }
    return {
      kind: 'flipbook',
      w,
      h,
      baseU,
      baseV,
      du: size[0](zero),
      dv: size[1](zero),
      stepU: step[0](zero),
      stepV: step[1](zero),
      fps: num(flip['frames_per_second'], 8),
      max: num(flip['max_frame'], 1),
      stretch: flip['stretch_to_lifetime'] === true,
      loop: flip['loop'] === true,
    }
  }
  const [u, v] = pair(uv['uv'])
  const [du, dv] = pair(uv['uv_size'], 1)
  return { kind: 'static', w, h, u, v, du, dv }
}

function readDef(id: string, raw: unknown): Def | null {
  if (!raw || typeof raw !== 'object') return null
  const effect = raw as Record<string, unknown>
  const components = (effect['components'] ?? {}) as Record<string, unknown>
  const part = (key: string) => {
    const body = components[key]
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  }
  const description = (effect['description'] ?? {}) as Record<string, unknown>
  const material = String(((description['basic_render_parameters'] ?? {}) as Record<string, unknown>)['material'] ?? '')
  const once = part('minecraft:emitter_lifetime_once')
  const looping = part('minecraft:emitter_lifetime_looping')
  const expression = part('minecraft:emitter_lifetime_expression')
  const instant = part('minecraft:emitter_rate_instant')
  const steady = part('minecraft:emitter_rate_steady')
  const init = part('minecraft:emitter_initialization')
  const particleInit = part('minecraft:particle_initialization')
  const life = part('minecraft:particle_lifetime_expression')
  const speed = components['minecraft:particle_initial_speed']
  const spin = part('minecraft:particle_initial_spin')
  const dynamic = part('minecraft:particle_motion_dynamic')
  const parametric = part('minecraft:particle_motion_parametric')
  const collision = part('minecraft:particle_motion_collision')
  const billboard = part('minecraft:particle_appearance_billboard') ?? {}
  const direction = (billboard['direction'] ?? {}) as Record<string, unknown>
  const events = part('minecraft:particle_lifetime_events')
  const local = part('minecraft:emitter_local_space')
  const timeline = events?.['timeline'] && typeof events['timeline'] === 'object' ? (events['timeline'] as Record<string, unknown>) : {}
  const named: Record<string, string[]> = {}
  for (const [name, body] of Object.entries((effect['events'] ?? {}) as Record<string, unknown>)) named[name] = eventEffects(body)
  return {
    id,
    additive: material.includes('add'),
    glow: material.includes('add') ? 1 : HOT.test(id) && !COLD.test(id) ? 0.6 : 0,
    cutout: material === 'particles_alpha',
    curves: readCurves(effect['curves']),
    init: program(init?.['creation_expression']),
    perUpdate: program(init?.['per_update_expression']),
    perParticle: program(particleInit?.['per_update_expression']),
    lifetime: once
      ? { kind: 'once', active: num(once['active_time'], 10) }
      : looping
        ? { kind: 'looping', active: num(looping['active_time'], 10), sleep: num(looping['sleep_time'], 0) }
        : expression
          ? { kind: 'expression', activation: num(expression['activation_expression'], 1), expiration: num(expression['expiration_expression'], 0) }
          : null,
    rate: instant ? { kind: 'instant', count: num(instant['num_particles'], 10) } : steady ? { kind: 'steady', rate: num(steady['spawn_rate'], 1), max: num(steady['max_particles'], 50) } : null,
    local: local?.['position'] === true,
    shape: readShape(components),
    life: num(life?.['max_lifetime'], 1),
    expire: life?.['expiration_expression'] !== undefined ? num(life['expiration_expression']) : null,
    speed: Array.isArray(speed) ? (vec(speed) as Vec) : num(speed, 0),
    spin: num(spin?.['rotation']),
    spinRate: num(spin?.['rotation_rate']),
    dynamic: !!dynamic,
    accel: vec(dynamic?.['linear_acceleration']),
    drag: num(dynamic?.['linear_drag_coefficient']),
    spinAccel: num(dynamic?.['rotation_acceleration']),
    spinDrag: num(dynamic?.['rotation_drag_coefficient']),
    parametric: parametric ? { position: vec(parametric['relative_position']), rotation: parametric['rotation'] !== undefined ? num(parametric['rotation']) : null } : null,
    collision:
      collision && collision['enabled'] !== false
        ? {
            radius: num(collision['collision_radius'], 0.1),
            drag: Number(collision['collision_drag']) || 0,
            bounce: Number(collision['coefficient_of_restitution']) || 0,
            expire: collision['expire_on_contact'] === true,
          }
        : null,
    size: pair(billboard['size'], 0.1),
    facing: String(billboard['facing_camera_mode'] ?? 'rotate_xyz'),
    custom: vec(direction['custom_direction']),
    uv: readUv(billboard),
    tint: readTint(part('minecraft:particle_appearance_tinting')),
    onCreate: listOf(events?.['creation_event']),
    onExpire: listOf(events?.['expiration_event']),
    timeline: Object.entries(timeline)
      .map(([at, list]) => ({ at: Number(at), events: listOf(list) }))
      .filter((entry) => Number.isFinite(entry.at))
      .sort((a, b) => a.at - b.at),
    events: named,
  }
}

interface Particle {
  pos: Vector3
  vel: Vector3
  age: number
  life: number
  rot: number
  rate: number
  ctx: Ctx
  cue: number
}

interface Emitter {
  def: Def
  key: string
  where: (out: Vector3) => Vector3
  at: Vector3
  age: number
  ctx: Ctx
  activeTime: number
  sleepTime: number
  cycleStart: number
  burst: boolean
  wasActive: boolean
  owed: number
  done: boolean
  transient: boolean
  particles: Particle[]
}

interface Cue {
  at: number
  effect: string
  locator: string | null
}

interface Plan {
  name: string
  length: number
  loop: boolean
  cues: Cue[]
  bones: AnimationClip | null
}

function readPlans(raw: Record<string, unknown>): Plan[] {
  const clips = readAnimations({ animations: raw })
  const plans: Plan[] = []
  for (const [name, body] of Object.entries(raw)) {
    if (!body || typeof body !== 'object') continue
    const clip = body as Record<string, unknown>
    const cues: Cue[] = []
    const effects = clip['particle_effects']
    if (effects && typeof effects === 'object') {
      for (const [at, list] of Object.entries(effects as Record<string, unknown>)) {
        const time = Number(at)
        if (!Number.isFinite(time)) continue
        for (const entry of Array.isArray(list) ? list : [list]) {
          const cue = entry as Record<string, unknown> | null
          if (cue && typeof cue['effect'] === 'string') cues.push({ at: time, effect: cue['effect'], locator: typeof cue['locator'] === 'string' ? cue['locator'] : null })
        }
      }
    }
    cues.sort((a, b) => a.at - b.at)
    plans.push({ name, length: Number(clip['animation_length']) || 0, loop: clip['loop'] === true, cues, bones: clips[name] ?? null })
  }
  return plans
}

interface Stage {
  name: string
  loops: number | null
  next: Stage | null
}

function readStage(raw: unknown, depth = 0): Stage | null {
  if (!raw || typeof raw !== 'object' || depth > 8) return null
  const body = raw as Record<string, unknown>
  if (typeof body['name'] !== 'string') return null
  const loops = Number(body['loops'])
  return { name: body['name'], loops: Number.isFinite(loops) && loops > 0 ? loops : null, next: readStage(body['on_complete'], depth + 1) }
}

function idleStage(triggers: unknown[]): Stage | null {
  const idle = triggers.find((t) => t && typeof t === 'object' && (t as Record<string, unknown>)['type'] === 'IDLE') ?? triggers[0]
  return readStage(idle)
}

const followUp = (plans: Plan[], current: Plan): Plan | null =>
  plans.find((plan) => plan !== current && plan.name.toLowerCase().split(/[^a-z0-9]+/).includes('loop')) ?? null

export function particlePack(raw: unknown): ParticlePack | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const effects = body['effects']
  const animations = body['animations']
  if (!effects || typeof effects !== 'object' || !animations || typeof animations !== 'object') return null
  const triggers = Array.isArray(body['triggers']) ? (body['triggers'] as unknown[]) : []
  return { effects: effects as Record<string, unknown>, animations: animations as Record<string, unknown>, triggers }
}

/** Buffers for `size` quads: corners, picture coordinates, colours. */
function quads(size: number): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(size * 12), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(size * 8), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(size * 16), 4))
  const index = new Uint32Array(size * 6)
  for (let i = 0; i < size; i += 1) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6)
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.setDrawRange(0, 0)
  return geometry
}

class Halo {
  readonly mesh: Mesh
  private capacity = 64
  private n = 0

  constructor(spot: Texture) {
    this.mesh = new Mesh(this.fresh(), lightMaterial(spot))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 9
  }

  private fresh(): BufferGeometry {
    const geometry = quads(this.capacity)
    const uv = geometry.getAttribute('uv').array as Float32Array
    for (let i = 0; i < this.capacity; i += 1) uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8)
    return geometry
  }

  begin(count: number): void {
    this.n = 0
    if (count <= this.capacity) return
    while (this.capacity < count) this.capacity *= 2
    this.mesh.geometry.dispose()
    this.mesh.geometry = this.fresh()
  }

  put(at: Vector3, reach: number, light: Rgb, power: number, right: Vector3, up: Vector3): void {
    const p = this.mesh.geometry.getAttribute('position').array as Float32Array
    const c = this.mesh.geometry.getAttribute('color').array as Float32Array
    for (let corner = 0; corner < 4; corner += 1) {
      const x = corner === 1 || corner === 2 ? reach : -reach
      const y = corner > 1 ? reach : -reach
      const o = this.n * 12 + corner * 3
      p[o] = at.x + right.x * x + up.x * y
      p[o + 1] = at.y + right.y * x + up.y * y
      p[o + 2] = at.z + right.z * x + up.z * y
      const k = this.n * 16 + corner * 4
      c[k] = light[0]
      c[k + 1] = light[1]
      c[k + 2] = light[2]
      c[k + 3] = power
    }
    this.n += 1
  }

  end(): void {
    ;(this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
    ;(this.mesh.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true
    this.mesh.geometry.setDrawRange(0, this.n * 6)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
  }
}

class Batch {
  readonly mesh: Mesh
  readonly halo: Halo | null
  /** Light of this batch in the last drawn frame: the sum of colours and its weight. */
  readonly shed: Rgb = [0, 0, 0]
  weight = 0
  private capacity = 0
  private geometry = new BufferGeometry()

  constructor(
    readonly def: Def,
    texture: Texture,
    private readonly lights: LightMap,
  ) {
    const material = def.additive
      ? lightMaterial(texture)
      : new MeshBasicMaterial({
          map: texture,
          vertexColors: true,
          transparent: !def.cutout,
          alphaTest: def.cutout ? 0.5 : 0.01,
          depthWrite: def.cutout,
          side: DoubleSide,
          blending: NormalBlending,
        })
    this.mesh = new Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    this.grow(64)
    const spot = def.glow > 0 ? haloTexture() : null
    this.halo = spot ? new Halo(spot) : null
  }

  private grow(count: number): void {
    if (count <= this.capacity) return
    let size = Math.max(64, this.capacity)
    while (size < count) size *= 2
    this.capacity = size
    const geometry = quads(size)
    this.geometry.dispose()
    this.geometry = geometry
    this.mesh.geometry = geometry
  }

  fill(emitters: Emitter[], right: Vector3, up: Vector3, back: Vector3): void {
    let total = 0
    for (const emitter of emitters) if (emitter.def === this.def) total += emitter.particles.length
    this.grow(total)
    const position = this.geometry.getAttribute('position') as BufferAttribute
    const uv = this.geometry.getAttribute('uv') as BufferAttribute
    const color = this.geometry.getAttribute('color') as BufferAttribute
    const p = position.array as Float32Array
    const t = uv.array as Float32Array
    const c = color.array as Float32Array
    const def = this.def
    const rgba: Rgba = [1, 1, 1, 1]
    const center = new Vector3()
    const r = new Vector3()
    const u = new Vector3()
    const dir = new Vector3()
    let n = 0
    const halo = this.lights.ready ? this.halo : null
    const light: Rgb = [1, 1, 1]
    this.shed.fill(0)
    this.weight = 0
    halo?.begin(total)
    for (const emitter of emitters) {
      if (emitter.def !== def) continue
      for (const particle of emitter.particles) {
        const ctx = particle.ctx
        center.copy(particle.pos)
        if (def.local || def.parametric) center.add(emitter.at)
        const w = def.size[0](ctx)
        const h = def.size[1](ctx)
        orient(def, particle, ctx, right, up, back, r, u, dir)
        const cos = Math.cos(particle.rot * DEG)
        const sin = Math.sin(particle.rot * DEG)
        const rx = r.x * cos + u.x * sin
        const ry = r.y * cos + u.y * sin
        const rz = r.z * cos + u.z * sin
        const ux = u.x * cos - r.x * sin
        const uy = u.y * cos - r.y * sin
        const uz = u.z * cos - r.z * sin
        const o = n * 12
        p[o] = center.x - rx * w - ux * h
        p[o + 1] = center.y - ry * w - uy * h
        p[o + 2] = center.z - rz * w - uz * h
        p[o + 3] = center.x + rx * w - ux * h
        p[o + 4] = center.y + ry * w - uy * h
        p[o + 5] = center.z + rz * w - uz * h
        p[o + 6] = center.x + rx * w + ux * h
        p[o + 7] = center.y + ry * w + uy * h
        p[o + 8] = center.z + rz * w + uz * h
        p[o + 9] = center.x - rx * w + ux * h
        p[o + 10] = center.y - ry * w + uy * h
        p[o + 11] = center.z - rz * w + uz * h
        const [u0, v0, u1, v1] = uvOf(def.uv, particle, ctx)
        const q = n * 8
        t[q] = u0
        t[q + 1] = 1 - v1
        t[q + 2] = u1
        t[q + 3] = 1 - v1
        t[q + 4] = u1
        t[q + 5] = 1 - v0
        t[q + 6] = u0
        t[q + 7] = 1 - v0
        tintAt(def.tint, ctx, rgba)
        const k = n * 16
        for (let corner = 0; corner < 4; corner += 1) c.set(rgba, k + corner * 4)
        n += 1
        if (!halo) continue
        const bright = this.lights.at(u0, v0, u1, v1, light) * rgba[3]
        if (bright < 0.01) continue
        const size = Math.max(Math.abs(w), Math.abs(h))
        const near = Math.min(1, Math.max(0, (HALO_NONE - size) / (HALO_NONE - HALO_FULL)))
        const share = bright * def.glow * size
        for (let i = 0; i < 3; i += 1) {
          light[i] = (light[i] as number) * (rgba[i] as number)
          this.shed[i] = (this.shed[i] as number) + (light[i] as number) * share
        }
        this.weight += share
        if (near > 0) halo.put(center, size * HALO_REACH + HALO_PAD, light, Math.min(1, Math.sqrt(bright)) * def.glow * near * HALO_POWER, right, up)
      }
    }
    halo?.end()
    position.needsUpdate = true
    uv.needsUpdate = true
    color.needsUpdate = true
    this.geometry.setDrawRange(0, n * 6)
  }

  dispose(): void {
    this.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
    this.halo?.dispose()
  }
}

/** The light an effect throws: on the figure (a lamp at the chest) and on the floor (a spot under the feet). */
class Lamp {
  readonly light = new PointLight(0xffffff, 0, LAMP_REACH, 1)
  readonly floor: Halo | null
  private readonly color: Rgb = [1, 1, 1]
  private power = 0
  private readonly at = new Vector3(0, 0.02, 0)
  private readonly right = new Vector3(1, 0, 0)
  private readonly ahead = new Vector3(0, 0, -1)

  constructor(home: Group) {
    const spot = haloTexture()
    this.floor = spot ? new Halo(spot) : null
    this.light.position.set(0, 0.9, 1.15)
    home.add(this.light)
    if (this.floor) home.add(this.floor.mesh)
  }

  /** Eases to the light of the frame, so single particles do not make it flicker; a negative step jumps to it. */
  follow(batches: readonly Batch[], dt: number): void {
    let weight = 0
    const sum: Rgb = [0, 0, 0]
    for (const batch of batches) {
      weight += batch.weight
      for (let i = 0; i < 3; i += 1) sum[i] = (sum[i] as number) + (batch.shed[i] as number)
    }
    const k = dt < 0 ? 1 : 1 - Math.exp(-dt * LAMP_EASE)
    const top = Math.max(sum[0], sum[1], sum[2])
    if (top > 0) for (let i = 0; i < 3; i += 1) this.color[i] = (this.color[i] as number) + ((sum[i] as number) / top - (this.color[i] as number)) * k
    this.power += (Math.min(1, Math.sqrt(weight)) - this.power) * k
    this.light.color.setRGB(this.color[0], this.color[1], this.color[2])
    this.light.intensity = this.power * LAMP_POWER
    if (!this.floor) return
    this.floor.begin(1)
    this.floor.put(this.at, FLOOR_RADIUS, this.color, this.power * FLOOR_POWER, this.right, this.ahead)
    this.floor.end()
  }

  dispose(): void {
    this.light.dispose()
    this.floor?.dispose()
  }
}

function orient(def: Def, particle: Particle, ctx: Ctx, right: Vector3, up: Vector3, back: Vector3, r: Vector3, u: Vector3, dir: Vector3): void {
  switch (def.facing) {
    case 'rotate_y':
    case 'lookat_y':
      u.set(0, 1, 0)
      r.crossVectors(u, back)
      if (r.lengthSq() < 1e-8) r.copy(right)
      r.normalize()
      return
    case 'emitter_transform_xy':
      r.set(1, 0, 0)
      u.set(0, 1, 0)
      return
    case 'emitter_transform_xz':
      r.set(1, 0, 0)
      u.set(0, 0, 1)
      return
    case 'emitter_transform_yz':
      r.set(0, 0, 1)
      u.set(0, 1, 0)
      return
    case 'direction_x':
    case 'direction_y':
    case 'direction_z':
    case 'lookat_direction': {
      if (def.custom) evalVec(def.custom, ctx, dir)
      else dir.copy(particle.vel)
      if (dir.lengthSq() < 1e-8) break
      dir.normalize()
      if (def.facing === 'direction_x') {
        r.copy(dir)
        u.crossVectors(back, dir)
      } else if (def.facing === 'direction_z') {
        r.crossVectors(UP, dir)
        if (r.lengthSq() < 1e-8) r.set(1, 0, 0)
        r.normalize()
        u.crossVectors(dir, r)
      } else {
        u.copy(dir)
        r.crossVectors(dir, back)
      }
      if (r.lengthSq() < 1e-8 || u.lengthSq() < 1e-8) break
      r.normalize()
      u.normalize()
      return
    }
  }
  r.copy(right)
  u.copy(up)
}

function uvOf(uv: Uv, particle: Particle, ctx: Ctx): [number, number, number, number] {
  if (uv.kind === 'full') return [0, 0, 1, 1]
  if (uv.kind === 'static') {
    const u = uv.u(ctx)
    const v = uv.v(ctx)
    return [u / uv.w, v / uv.h, (u + uv.du(ctx)) / uv.w, (v + uv.dv(ctx)) / uv.h]
  }
  const max = Math.max(1, Math.floor(uv.max(ctx)))
  let frame = uv.stretch ? Math.floor((particle.age / Math.max(particle.life, 1e-6)) * max) : Math.floor(particle.age * uv.fps(ctx))
  frame = uv.loop ? ((frame % max) + max) % max : Math.min(max - 1, Math.max(0, frame))
  const u = uv.baseU(ctx) + uv.stepU * frame
  const v = uv.baseV(ctx) + uv.stepV * frame
  return [u / uv.w, v / uv.h, (u + uv.du) / uv.w, (v + uv.dv) / uv.h]
}

function context(parent?: Record<string, number>): Ctx {
  return { animTime: 0, lifeTime: 0, vars: Object.create(parent ?? null) as Record<string, number>, random: roll }
}

export interface ParticleOptions {
  /** Nobody runs the effect but `advance`: a still frame, or a shot taken step by step. */
  still?: boolean
  /** The effect also lights the figure and the floor: the shop window, card shots. */
  lit?: boolean
  /** Seconds the effect has already run when it is first seen. */
  warm?: number
}

export class ParticleShow {
  readonly pieces: ParticlePiece[] = []
  readonly usable: boolean
  private readonly defs = new Map<string, Def>()
  private readonly batches: Batch[] = []
  private readonly emitters: Emitter[] = []
  private readonly locators = new Map<string, Object3D>()
  private readonly joints: { joint: Object3D; name: string; rest: [number, number, number]; offset: [number, number, number] }[] = []
  private readonly roots: Object3D[] = []
  private readonly entity = new Group()
  private readonly texture: Texture
  private readonly plans: Plan[]
  private plan: Plan | null
  private stage: Stage | null
  private readonly firstStage: Stage | null
  private loopsLeft: number | null = null
  private clock = 0
  private fired = -1
  private holding = false
  private last = 0
  private warm: number
  private readonly frozen: boolean
  private readonly lights = new LightMap()
  private readonly lamp: Lamp | null = null
  private lampAt = -1
  private readonly right = new Vector3(1, 0, 0)
  private readonly up = new Vector3(0, 1, 0)
  private readonly back = new Vector3(0, 0, 1)

  constructor(
    pack: ParticlePack,
    geometry: unknown,
    textureUrl: string,
    clipName?: string,
    options: ParticleOptions = {},
  ) {
    this.frozen = options.still === true
    this.warm = this.frozen ? 0 : (options.warm ?? 1)
    for (const [id, raw] of Object.entries(pack.effects)) {
      const def = readDef(id, raw)
      if (def) this.defs.set(id, def)
    }
    this.plans = readPlans(pack.animations)
    const stage = idleStage(pack.triggers)
    const staged = stage ? this.plans.find((plan) => plan.name === stage.name) : undefined
    this.stage = staged ? stage : null
    this.firstStage = this.stage
    this.loopsLeft = staged && stage ? stage.loops : null
    this.plan =
      staged ??
      this.plans.find((plan) => plan.name === clipName && plan.cues.length) ??
      this.plans.find((plan) => plan.cues.length) ??
      null
    this.usable = this.plans.some((plan) => plan.cues.some((cue) => this.defs.has(cue.effect)))
    this.texture = new TextureLoader().load(textureUrl)
    this.texture.magFilter = NearestFilter
    this.texture.minFilter = NearestFilter
    this.texture.colorSpace = SRGBColorSpace
    if (!this.usable) return
    this.buildRig(geometry)
    this.entity.name = 'millida-particles'
    this.entity.position.y = -FEET_BELOW_NECK
    this.entity.scale.setScalar(PIXELS_PER_BLOCK)
    for (const def of this.defs.values()) {
      const batch = new Batch(def, this.texture, this.lights)
      batch.mesh.onBeforeRender = (_renderer, _scene, camera) => this.frame(batch, camera)
      this.batches.push(batch)
      this.entity.add(batch.mesh)
      if (batch.halo) this.entity.add(batch.halo.mesh)
    }
    if (options.lit && this.batches.some((batch) => batch.halo)) this.lamp = new Lamp(this.entity)
    this.pieces.push({ anchor: 'root', object: this.entity })
  }

  private buildRig(geometry: unknown): void {
    const mesh = readCosmeticMesh(geometry)
    if (!mesh) return
    const marks = readLocators(geometry)
    const rig = buildRig(mesh)
    const joints: Object3D[] = []
    const roots = new Map<CosmeticAnchor, Group>()
    rig.bones.forEach((bone, index) => {
      const joint = new Object3D()
      joint.name = bone.name
      joint.position.set(bone.offset[0], bone.offset[1], bone.offset[2])
      poseJoint(joint, bone.rotation, [0, 0, 0])
      joints.push(joint)
      this.joints.push({ joint, name: bone.name, rest: bone.rotation, offset: bone.offset })
      const pivot = mesh.bones[index]?.pivot ?? [0, 0, 0]
      for (const [name, point] of Object.entries(marks[bone.name] ?? {})) {
        const mark = new Object3D()
        mark.name = name
        mark.position.set(point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2])
        joint.add(mark)
        this.locators.set(name, mark)
      }
      if (bone.parent >= 0) {
        ;(joints[bone.parent] as Object3D).add(joint)
        return
      }
      const anchor = bone.anchor ?? 'root'
      let root = roots.get(anchor)
      if (!root) {
        root = new Group()
        root.name = 'millida-particle-rig'
        root.scale.set(1, -1, -1)
        root.position.y = anchorShift(anchor)
        roots.set(anchor, root)
        this.roots.push(root)
      }
      root.add(joint)
    })
    if (!this.locators.size) return
    for (const [anchor, object] of roots) this.pieces.push({ anchor, object })
  }

  advance(seconds: number): void {
    let left = seconds
    while (left > 1e-6) {
      const dt = Math.min(WARM_STEP, left)
      this.step(dt)
      left -= dt
    }
  }

  private frame(batch: Batch, camera: Camera): void {
    try {
      this.draw(batch, camera)
    } catch {
      this.entity.visible = false
      this.emitters.length = 0
    }
  }

  private draw(batch: Batch, camera: Camera): void {
    if (batch === this.batches[0]) {
      this.lights.read(this.texture.image)
      this.shine()
    }
    if (!this.frozen && batch === this.batches[0]) {
      const now = performance.now()
      if (this.warm > 0) {
        const warm = this.warm
        this.warm = 0
        this.advance(warm)
      } else if (this.last) {
        this.step(Math.min(MAX_STEP, (now - this.last) / 1000))
      }
      this.last = now
    }
    const turn = new Quaternion()
    this.entity.getWorldQuaternion(turn).invert()
    const look = camera.getWorldQuaternion(new Quaternion())
    turn.multiply(look)
    this.right.set(1, 0, 0).applyQuaternion(turn)
    this.up.set(0, 1, 0).applyQuaternion(turn)
    this.back.set(0, 0, 1).applyQuaternion(turn)
    batch.fill(this.emitters, this.right, this.up, this.back)
  }

  private shine(): void {
    if (!this.lamp) return
    const now = performance.now()
    this.lamp.follow(this.batches, this.frozen || this.lampAt < 0 ? -1 : (now - this.lampAt) / 1000)
    if (this.batches.some((batch) => batch.weight > 0)) this.lampAt = now
  }

  private where(locator: string | null): (out: Vector3) => Vector3 {
    const mark = locator ? this.locators.get(locator) : undefined
    if (!mark) return (out) => out.set(0, 0, 0)
    return (out) => this.entity.worldToLocal(mark.getWorldPosition(out))
  }

  private poseRig(): void {
    const clip = this.plan?.bones
    for (const { joint, name, rest, offset } of this.joints) {
      const pose = clip ? poseOf(clip, name, this.clock) : null
      if (!pose) continue
      poseJoint(joint, rest, pose.rotation)
      joint.position.set(offset[0] + pose.position[0], offset[1] + pose.position[1], offset[2] + pose.position[2])
      joint.scale.set(pose.scale[0], pose.scale[1], pose.scale[2])
    }
    this.entity.updateWorldMatrix(true, false)
    for (const root of this.roots) root.updateWorldMatrix(true, true)
  }

  private fire(from: number, to: number): void {
    const plan = this.plan
    if (!plan) return
    for (const cue of plan.cues) {
      if (cue.at <= from || cue.at > to) continue
      const key = cue.effect + '@' + (cue.locator ?? '')
      if (this.emitters.some((emitter) => emitter.key === key && !emitter.done)) continue
      this.spawn(cue.effect, key, this.where(cue.locator))
    }
  }

  private runClock(dt: number): void {
    const plan = this.plan
    if (!plan || this.holding) return
    const length = plan.length > 0 ? plan.length : 1
    let from = this.fired
    let to = this.clock + dt
    while (to >= length) {
      this.fire(from, length)
      if (this.loopsLeft !== null) {
        this.loopsLeft -= 1
        if (this.loopsLeft > 0) {
          to -= length
          from = -1
          continue
        }
        this.nextStage(to - length)
        return
      }
      if (plan.loop) {
        to -= length
        from = -1
        continue
      }
      if (this.stage) {
        this.nextStage(to - length)
        return
      }
      const next = followUp(this.plans, plan)
      if (next) {
        this.plan = next
        this.clock = 0
        this.fired = -1
        this.runClock(to - length)
        return
      }
      this.holding = true
      this.clock = length
      return
    }
    this.fire(from, to)
    this.clock = to
    this.fired = to
  }

  private nextStage(rest: number): void {
    const next = this.stage?.next ?? this.firstStage
    const plan = next ? this.plans.find((candidate) => candidate.name === next.name) : undefined
    if (!next || !plan) {
      this.holding = true
      this.clock = this.plan && this.plan.length > 0 ? this.plan.length : 1
      return
    }
    this.stage = next
    this.plan = plan
    this.loopsLeft = next.loops
    this.clock = 0
    this.fired = -1
    this.runClock(Math.max(0, rest))
  }

  private spawn(effect: string, key: string, where: (out: Vector3) => Vector3, transient = false): void {
    const def = this.defs.get(effect)
    if (!def || (transient && this.emitters.length >= MAX_EMITTERS)) return
    const ctx = context()
    for (let i = 1; i <= 4; i += 1) ctx.vars['variable.emitter_random_' + i] = roll()
    ctx.vars['variable.emitter_age'] = 0
    def.init?.(ctx)
    const emitter: Emitter = {
      def,
      key,
      where,
      at: where(new Vector3()),
      age: 0,
      ctx,
      activeTime: 0,
      sleepTime: 0,
      cycleStart: 0,
      burst: false,
      wasActive: false,
      owed: 0,
      done: false,
      transient,
      particles: [],
    }
    this.cycle(emitter)
    this.emitters.push(emitter)
  }

  private cycle(emitter: Emitter): void {
    const life = emitter.def.lifetime
    if (life?.kind === 'once') emitter.activeTime = life.active(emitter.ctx)
    if (life?.kind === 'looping') {
      emitter.activeTime = life.active(emitter.ctx)
      emitter.sleepTime = life.sleep(emitter.ctx)
    }
    emitter.ctx.vars['variable.emitter_lifetime'] = emitter.activeTime
    emitter.burst = false
  }

  private active(emitter: Emitter): boolean {
    const life = emitter.def.lifetime
    if (emitter.transient && (life?.kind !== 'once') && emitter.age >= Math.max(emitter.activeTime, life?.kind === 'looping' ? 0 : TRANSIENT_SECONDS)) {
      emitter.done = true
      return false
    }
    if (!life) return true
    if (life.kind === 'once') {
      if (emitter.age >= emitter.activeTime) emitter.done = true
      return !emitter.done
    }
    if (life.kind === 'looping') {
      const period = emitter.activeTime + emitter.sleepTime
      if (period > 0 && emitter.age - emitter.cycleStart >= period) {
        emitter.cycleStart += period
        this.cycle(emitter)
      }
      return emitter.age - emitter.cycleStart < emitter.activeTime
    }
    if (life.expiration(emitter.ctx)) {
      emitter.done = true
      return false
    }
    return !!life.activation(emitter.ctx)
  }

  private total(): number {
    let n = 0
    for (const emitter of this.emitters) n += emitter.particles.length
    return n
  }

  private emit(emitter: Emitter): void {
    if (this.total() >= MAX_PARTICLES) return
    const def = emitter.def
    const ctx = context(emitter.ctx.vars)
    for (let i = 1; i <= 4; i += 1) ctx.vars['variable.particle_random_' + i] = roll()
    ctx.vars['variable.particle_age'] = 0
    applyCurves(def.curves, ctx)
    const life = def.life(ctx)
    ctx.vars['variable.particle_lifetime'] = life > 0 ? life : 1
    applyCurves(def.curves, ctx)
    const pos = new Vector3()
    const dir = new Vector3()
    sampleShape(def.shape, ctx, pos, dir)
    if (!def.local && !def.parametric) pos.add(emitter.at)
    const vel = new Vector3()
    if (Array.isArray(def.speed)) evalVec(def.speed, ctx, vel)
    else {
      const speed = def.speed(ctx)
      if (dir.lengthSq() > 1e-8) vel.copy(dir).normalize().multiplyScalar(speed)
    }
    const particle: Particle = { pos, vel, age: 0, life: life > 0 ? life : 1, rot: def.spin(ctx), rate: def.spinRate(ctx), ctx, cue: 0 }
    emitter.particles.push(particle)
    this.events(def, def.onCreate, particle, emitter)
  }

  private events(def: Def, names: string[], particle: Particle, emitter: Emitter): void {
    for (const name of names) {
      for (const effect of def.events[name] ?? []) {
        const at = particle.pos.clone()
        if (def.local || def.parametric) at.add(emitter.at)
        this.spawn(effect, effect + '#' + Math.random(), (out) => out.copy(at), true)
      }
    }
  }

  private step(dt: number): void {
    this.poseRig()
    this.runClock(dt)
    this.poseRig()
    for (const emitter of this.emitters) this.stepEmitter(emitter, dt)
    for (let i = this.emitters.length - 1; i >= 0; i -= 1) {
      const emitter = this.emitters[i] as Emitter
      if (emitter.done && !emitter.particles.length) this.emitters.splice(i, 1)
    }
  }

  private stepEmitter(emitter: Emitter, dt: number): void {
    const def = emitter.def
    emitter.age += dt
    emitter.ctx.vars['variable.emitter_age'] = emitter.age
    emitter.ctx.animTime = emitter.ctx.lifeTime = emitter.age
    def.perUpdate?.(emitter.ctx)
    emitter.where(emitter.at)
    const active = !emitter.done && this.active(emitter)
    if (active && def.rate) {
      if (def.rate.kind === 'instant') {
        if (!emitter.burst || (def.lifetime?.kind === 'expression' && !emitter.wasActive)) {
          emitter.burst = true
          const count = Math.round(def.rate.count(emitter.ctx))
          for (let i = 0; i < count; i += 1) this.emit(emitter)
        }
      } else {
        const max = def.rate.max(emitter.ctx)
        emitter.owed += def.rate.rate(emitter.ctx) * dt
        while (emitter.owed >= 1 && emitter.particles.length < max) {
          this.emit(emitter)
          emitter.owed -= 1
        }
        if (emitter.particles.length >= max) emitter.owed = Math.min(emitter.owed, 1)
      }
    }
    emitter.wasActive = active
    if (!def.lifetime && !def.rate) emitter.done = true
    const kept: Particle[] = []
    for (const particle of emitter.particles) if (this.stepParticle(emitter, particle, dt)) kept.push(particle)
    emitter.particles = kept
  }

  private stepParticle(emitter: Emitter, particle: Particle, dt: number): boolean {
    const def = emitter.def
    const ctx = particle.ctx
    particle.age += dt
    ctx.animTime = ctx.lifeTime = particle.age
    ctx.vars['variable.particle_age'] = particle.age
    def.perParticle?.(ctx)
    applyCurves(def.curves, ctx)
    while (particle.cue < def.timeline.length && (def.timeline[particle.cue] as { at: number }).at <= particle.age) {
      this.events(def, (def.timeline[particle.cue] as { events: string[] }).events, particle, emitter)
      particle.cue += 1
    }
    if (particle.age >= particle.life || (def.expire && def.expire(ctx))) {
      this.events(def, def.onExpire, particle, emitter)
      return false
    }
    if (def.parametric) {
      if (def.parametric.position) evalVec(def.parametric.position, ctx, particle.pos)
      if (def.parametric.rotation) particle.rot = def.parametric.rotation(ctx)
    } else if (def.dynamic) {
      const accel = def.accel ? evalVec(def.accel, ctx, scratchA) : scratchA.set(0, 0, 0)
      const drag = def.drag(ctx)
      particle.vel.addScaledVector(accel.addScaledVector(particle.vel, -drag), dt)
      particle.pos.addScaledVector(particle.vel, dt)
      particle.rate += (def.spinAccel(ctx) - particle.rate * def.spinDrag(ctx)) * dt
      particle.rot += particle.rate * dt
    }
    if (def.collision) {
      const radius = def.collision.radius(ctx)
      const lift = def.local || def.parametric ? emitter.at.y : 0
      if (particle.pos.y + lift - radius < 0) {
        particle.pos.y = radius - lift
        if (def.collision.expire) {
          this.events(def, def.onExpire, particle, emitter)
          return false
        }
        particle.vel.y = -particle.vel.y * def.collision.bounce
        const slow = Math.max(0, 1 - def.collision.drag * dt)
        particle.vel.x *= slow
        particle.vel.z *= slow
      }
    }
    return true
  }

  dispose(): void {
    for (const batch of this.batches) batch.dispose()
    this.lamp?.dispose()
    this.texture.dispose()
    this.emitters.length = 0
  }
}

export function startParticles(pack: ParticlePack, geometry: unknown, textureUrl: string, clipName?: string, options: ParticleOptions = {}): ParticleShow | null {
  try {
    const show = new ParticleShow(pack, geometry, textureUrl, clipName, options)
    if (show.usable) return show
    show.dispose()
    return null
  } catch {
    return null
  }
}

export function wearParticles(
  raw: unknown,
  geometry: unknown,
  textureUrl: string,
  clipName: string | undefined,
  options: ParticleOptions,
  attach: (anchor: CosmeticAnchor, object: Object3D) => void,
): ParticleShow | null {
  const pack = particlePack(raw)
  const show = pack ? startParticles(pack, geometry, textureUrl, clipName, options) : null
  if (!show) return null
  for (const piece of show.pieces) attach(piece.anchor, piece.object)
  if (options.still) show.advance(options.warm ?? PARTICLE_WARM_SECONDS)
  return show
}
