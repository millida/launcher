import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Euler,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Texture,
  NearestFilter,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { readCosmeticMesh } from './cosmeticGeometry'
import { poseOf, readAnimations, type AnimationClip } from './cosmeticAnimation'
import { anchorShift, buildRig, type CosmeticAnchor, type RigBone } from './cosmeticPlacement'
import { cosmeticInflate } from './cosmeticSlots'
import type { EmoteSequence } from './emoteSequence'
import { hiddenJoints, type PieceCover } from './cosmeticCover'

/** Столько кадров ленты в секунду показывает игра. */
export const ATLAS_FPS = 20

const radians = (degrees: number) => (degrees * Math.PI) / 180

const REST_TURN = new Euler(0, 0, 0, 'ZYX')
const POSE_TURN = new Euler(0, 0, 0, 'ZYX')
const REST_Q = new Quaternion()
const POSE_Q = new Quaternion()

/**
 * Покой кости и поворот из анимации - два разных поворота, и складывать их
 * углами нельзя: сумма углов равна повороту только когда оба идут вокруг одной
 * оси. У нижней пары «двойных» крыльев покой - чистое рысканье, а анимация
 * крутит по всем трём осям, и сложение уносило кончик крыла на шестнадцать
 * пикселей модели вверх - половину роста игрока. Верхняя пара крутится почти
 * по той же оси, что и её покой, поэтому выглядела правильной, а нижняя
 * задиралась вверх.
 *
 * Поворот анимации ложится поверх покоя в собственных осях кости - так его и
 * задаёт художник.
 */
export function poseJoint(joint: Object3D, rest: [number, number, number], turn: [number, number, number]) {
  REST_TURN.set(radians(rest[0]), radians(rest[1]), radians(rest[2]), 'ZYX')
  POSE_TURN.set(radians(turn[0]), radians(turn[1]), radians(turn[2]), 'ZYX')
  joint.quaternion.copy(REST_Q.setFromEuler(REST_TURN)).multiply(POSE_Q.setFromEuler(POSE_TURN))
}

const ATLAS_SLACK = 0.02
const ATLAS_MOST = 512

const wholePixels = (value: number) => {
  const rounded = Math.round(value)
  return rounded > 0 && Math.abs(value - rounded) < 0.001 ? rounded : 0
}

const sameScale = (imageWidth: number, textureWidth: number, imageHeight: number, textureHeight: number) => {
  const width = wholePixels(textureWidth)
  const height = wholePixels(textureHeight)
  if (width <= 0 || height <= 0 || imageWidth % width !== 0 || imageHeight % height !== 0) return false
  const across = imageWidth / width
  return across >= 2 && across === imageHeight / height
}

/**
 * Mirror of the mod's TextureFrames.of: a frame is exactly as tall as the
 * unwrap even when the strip is wider than it, so the count comes from the
 * height first. Counting by aspect ratio gave 18 frames instead of 32 on a
 * 144x2560 strip and cut every frame through the middle of the next one.
 */
export function atlasFrames(
  imageWidth: number,
  imageHeight: number,
  textureWidth: number,
  textureHeight: number,
): number {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(textureWidth > 0) || !(textureHeight > 0)) return 1
  if (sameScale(imageWidth, textureWidth, imageHeight, textureHeight)) return 1
  const whole = wholePixels(textureHeight)
  if (whole > 0 && imageHeight % whole === 0) {
    const count = imageHeight / whole
    if (count >= 2 && count <= ATLAS_MOST) return count
    if (count === 1) return 1
  }
  const frameHeight = (imageWidth * textureHeight) / textureWidth
  if (!(frameHeight > 0)) return 1
  const count = Math.round(imageHeight / frameHeight)
  if (count < 2 || count > ATLAS_MOST) return 1
  if (Math.abs(imageHeight / count - frameHeight) > ATLAS_SLACK * frameHeight) return 1
  return count
}

/**
 * Mirror of the mod's TextureFrames.widthShare: a strip wider than the unwrap
 * by a non-whole factor keeps the unwrap at its left edge in real pixels.
 */
export function atlasWidthShare(imageWidth: number, textureWidth: number): number {
  if (!(imageWidth > 0) || !(textureWidth > 0)) return 1
  const times = imageWidth / textureWidth
  if (Math.abs(times - Math.round(times)) < 0.0001) return 1
  const share = textureWidth / imageWidth
  return share > 0 && share <= 1 ? share : 1
}

/**
 * Клип, который просит каталог. У ста шестидесяти девяти вещей их несколько -
 * покой, ходьба, бег, - и первый попавшийся показывает вещь в чужом движении.
 */
export function pickClip(
  clips: Record<string, AnimationClip>,
  name?: string,
): AnimationClip | null {
  if (name && clips[name]) return clips[name] as AnimationClip
  const idle = Object.keys(clips).find((key) => key.toLowerCase().includes('idle'))
  if (idle) return clips[idle] as AnimationClip
  const first = Object.values(clips)[0]
  return (first as AnimationClip) ?? null
}

export interface CosmeticPiece {
  anchor: CosmeticAnchor
  object: Object3D
}

function boneGeometry(bone: RigBone): BufferGeometry | null {
  if (!bone.quads.length) return null
  const positions = new Float32Array(bone.quads.length * 18)
  const uvs = new Float32Array(bone.quads.length * 12)
  let at = 0
  let uvAt = 0
  for (const quad of bone.quads) {
    // Четырёхугольник в два треугольника: вершины 0-1-2 и 0-2-3.
    for (const corner of [0, 1, 2, 0, 2, 3]) {
      positions[at++] = quad.positions[corner * 3] as number
      positions[at++] = quad.positions[corner * 3 + 1] as number
      positions[at++] = quad.positions[corner * 3 + 2] as number
      uvs[uvAt++] = quad.uvs[corner * 2] as number
      // Картинка считается сверху вниз, а Three - снизу вверх.
      uvs[uvAt++] = 1 - (quad.uvs[corner * 2 + 1] as number)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Готовая к показу вещь: части, которые вешаются на кости фигуры.
 *
 * Кости живут как в моде - деревом со своими точками вращения, - поэтому клип
 * анимации двигает их теми же углами, и крыло в окне машет так же, как в игре.
 * Вся ветка стоит в координатах игры, а к части фигуры её разворачивает один
 * поворот на месте крепления: у игры высота считается вниз, а спина смотрит
 * в другую сторону.
 *
 * Рисуем обе стороны граней: у чужих моделей порядок вершин бывает любым, и
 * отсечение задних граней съедало бы половину вещи молча.
 */
/**
 * The clock an emote's own props run on. The figure is posed from the emote's
 * sequence at its own progress; props on a separate clock drifted off the hands
 * and kept moving while the emote was paused.
 */
/**
 * Часы вещей для покадровой съёмки (outfitSnapshot, петли карточек магазина):
 * пока задано, движение вещей и лента кадров текстуры берут время отсюда, а не
 * из performance.now() — так кадр N петли снимается ровно в свой момент.
 */
export const cosmeticClock: { now: (() => number) | null } = { now: null }

export interface EmoteTimeline {
  sequence: EmoteSequence
  clock(): number
}

function pixelated(texture: Texture) {
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.colorSpace = SRGBColorSpace
}

export function buildCosmetic(
  model: unknown,
  textureUrl: string,
  slot = '',
  animations?: unknown,
  clipName?: string,
  timeline?: EmoteTimeline,
  cover?: PieceCover,
  glowUrl?: string,
): CosmeticPiece[] {
  const mesh = readCosmeticMesh(model, cosmeticInflate(slot))
  if (!mesh) return []

  let frames = 1
  const texture = new TextureLoader().load(textureUrl, (ready) => {
    // Движущиеся вещи хранятся лентой кадров сверху вниз. Считаем кадры по
    // пропорции, а не по высоте: картинка бывает крупнее модели (64 на 128) и
    // это не лента, а рисунок в двойном разрешении.
    const image = ready.image as { width?: number; height?: number } | undefined
    frames = atlasFrames(image?.width ?? 0, image?.height ?? 0, mesh.textureWidth, mesh.textureHeight)
    const share = atlasWidthShare(image?.width ?? 0, mesh.textureWidth)
    if (frames > 1 || share < 1) {
      ready.repeat.set(share, 1 / frames)
      ready.offset.set(0, 1 - 1 / frames)
      ready.needsUpdate = true
    }
  })
  pixelated(texture)
  // Неоновые вещи держат цвет в карте свечения, а основная картинка у них
  // почти чёрная: без неё на фигуре они выходят тёмными пятнами. Лента
  // кадров у свечения та же, что у основной картинки, — двигаем их вместе.
  const glow = glowUrl
    ? new TextureLoader().load(glowUrl, (ready) => {
        ready.repeat.copy(texture.repeat)
        ready.offset.copy(texture.offset)
        ready.needsUpdate = true
      })
    : null
  if (glow) pixelated(glow)
  const material = new MeshLambertMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    side: DoubleSide,
    ...(glow ? { emissive: 0xffffff, emissiveMap: glow } : {}),
  })

  const rig = buildRig(mesh)
  const clip = pickClip(readAnimations(animations), clipName)
  const hidden = hiddenJoints(rig.bones, cover)

  const joints: Object3D[] = []
  const roots = new Map<CosmeticAnchor, Group>()
  let drawn = 0

  rig.bones.forEach((bone, index) => {
    const joint = new Object3D()
    joint.name = bone.name
    joint.visible = !hidden[index]
    joint.position.set(bone.offset[0], bone.offset[1], bone.offset[2])
    // Игра крутит кость вокруг z, затем y, затем x - тот же порядок и здесь.
    poseJoint(joint, bone.rotation, [0, 0, 0])
    const geometry = boneGeometry(bone)
    if (geometry) {
      joint.add(new Mesh(geometry, material))
      if (!hidden[index]) drawn += 1
    }
    joints.push(joint)

    if (bone.parent >= 0) {
      ;(joints[bone.parent] as Object3D).add(joint)
      return
    }
    const anchor = bone.anchor ?? 'root'
    let root = roots.get(anchor)
    if (!root) {
      root = new Group()
      root.name = 'millida-cosmetic'
      // Вся ветка считается в координатах игры: высота вниз, спина к +z.
      root.scale.set(1, -1, -1)
      root.position.y = anchorShift(anchor)
      roots.set(anchor, root)
    }
    root.add(joint)
  })

  if (!drawn) return []

  // A hidden joint is never rendered, so the clock must hang on a drawn one.
  const first = joints.find((joint, index) => !hidden[index] && joint.children.some((child) => (child as Mesh).isMesh))
  const ticker = first ? (first.children.find((child) => (child as Mesh).isMesh) as Mesh) : null
  if (ticker) {
    const started = performance.now()
    ticker.onBeforeRender = () => {
      const seconds = cosmeticClock.now ? cosmeticClock.now() : (performance.now() - started) / 1000
      if (frames > 1) {
        const at = Math.floor(seconds * ATLAS_FPS) % frames
        const offset = 1 - (at + 1) / frames
        if (texture.offset.y !== offset) {
          texture.offset.y = offset
          texture.needsUpdate = true
          if (glow) {
            glow.offset.y = offset
            glow.needsUpdate = true
          }
        }
      }
      const at = timeline ? timeline.clock() : seconds
      const playing = timeline ? timeline.sequence.clipAt(at) : clip
      const time = timeline ? timeline.sequence.timeAt(at) : seconds
      if (!playing) return
      for (let i = 0; i < rig.bones.length; i += 1) {
        const bone = rig.bones[i] as RigBone
        const joint = joints[i] as Object3D
        const pose = poseOf(playing, bone.name, time)
        if (!pose) continue
        poseJoint(joint, bone.rotation, pose.rotation)
        joint.position.set(
          bone.offset[0] + pose.position[0],
          bone.offset[1] + pose.position[1],
          bone.offset[2] + pose.position[2],
        )
        joint.scale.set(pose.scale[0], pose.scale[1], pose.scale[2])
      }
    }
  }

  return Array.from(roots.entries()).map(([anchor, object]) => ({ anchor, object }))
}
