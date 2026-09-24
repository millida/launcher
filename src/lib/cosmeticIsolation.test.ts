import { describe, expect, it } from 'bun:test'
import { Group, Matrix4, type Mesh, Object3D } from 'three'
import { buildCosmetic } from './cosmeticModel'
import type { CosmeticAnchor } from './cosmeticPlacement'

;(globalThis as { document?: unknown }).document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_: string) {} }),
}

/**
 * Вещь двигает только свои кости. Владелец (23.09.2026): «крылья полностью
 * ломают позу персонажа». У крыльев и питомцев кости зовутся так же, как части
 * игрока (`body`, `head`, `root`). Клип вещи обязан крутить крыло, а голова,
 * корпус, руки и ноги игрока - стоять там, где их поставила его собственная
 * анимация.
 *
 * Модели синтетические, но устроены как настоящие из сборки мода: те же имена
 * костей, та же вложенность, клип крутит и «чужие» имена. Настоящие модели
 * платной косметики в репозиторий не кладутся: он уходит в открытый код.
 */
type Vec3 = [number, number, number]
type Bone = { name: string; parent?: string; pivot?: Vec3; cubes?: { origin: Vec3; size: Vec3; uv: [number, number] }[] }
type Track = Partial<Record<'rotation' | 'position', Record<string, Vec3>>>

const box = (origin: Vec3, size: Vec3) => [{ origin, size, uv: [0, 0] as [number, number] }]
const swing = (a: Vec3, b: Vec3): Record<string, Vec3> => ({ '0.0': a, '0.6': b, '1.25': a })

function model(id: string, bones: Bone[], clip: string, tracks: Record<string, Track>) {
  return {
    geometry: {
      format_version: '1.12.0',
      'minecraft:geometry': [{ description: { identifier: 'geometry.' + id, texture_width: 32, texture_height: 32 }, bones }],
    },
    animations: { [clip]: { loop: true, animation_length: 1.25, bones: tracks } },
  }
}

const MODELS: Record<string, { slot: string; clip: string; file: ReturnType<typeof model> }> = {
  wings: {
    slot: 'WINGS',
    clip: 'animation.wings.flap',
    file: model(
      'wings',
      [
        { name: 'root' },
        { name: 'body', parent: 'root', pivot: [0, 24, 0] },
        { name: 'wing_left', parent: 'body', pivot: [2, 22, 2], cubes: box([2, 12, 2], [10, 10, 0]) },
        { name: 'wing_right', parent: 'body', pivot: [-2, 22, 2], cubes: box([-12, 12, 2], [10, 10, 0]) },
      ],
      'animation.wings.flap',
      {
        body: { rotation: swing([0, 0, 0], [8, 0, 0]) },
        wing_left: { rotation: swing([0, -20, 0], [0, -45, 5]) },
        wing_right: { rotation: swing([0, 20, 0], [0, 45, -5]) },
      },
    ),
  },
  jointed_wings: {
    slot: 'WINGS',
    clip: 'animation.jointed_wings.idle',
    file: model(
      'jointed_wings',
      [
        { name: 'root' },
        { name: 'body', parent: 'root', pivot: [0, 12, 0] },
        { name: 'wing_left_1', parent: 'body', pivot: [2, 21, 1], cubes: box([1, 20, 0], [2, 14, 2]) },
        { name: 'wing_left_2', parent: 'wing_left_1', pivot: [2, 34, 1], cubes: box([2, 34, 1], [14, 12, 0]) },
        { name: 'wing_right_1', parent: 'body', pivot: [-2, 21, 1], cubes: box([-3, 20, 0], [2, 14, 2]) },
        { name: 'wing_right_2', parent: 'wing_right_1', pivot: [-2, 34, 1], cubes: box([-16, 34, 1], [14, 12, 0]) },
      ],
      'animation.jointed_wings.idle',
      {
        wing_left_1: { rotation: swing([-10, -25, -9], [-8, -25, -15]), position: swing([0, 0, 1], [0, 0, 1.5]) },
        wing_left_2: { rotation: swing([0, 0, 33], [0, 0, 36]) },
        wing_right_1: { rotation: swing([-10, 25, 9], [-8, 25, 15]), position: swing([0, 0, 1], [0, 0, 1.5]) },
        wing_right_2: { rotation: swing([0, 0, -33], [0, 0, -36]) },
      },
    ),
  },
  pet: {
    slot: 'PET',
    clip: 'animation.pet.idle',
    file: model(
      'pet',
      [
        { name: 'root' },
        { name: 'head', parent: 'root', pivot: [0, 24, 0] },
        { name: 'pet', parent: 'head', pivot: [0, 32, 0] },
        { name: 'critter', parent: 'pet', pivot: [0, 34, 0], cubes: box([-2, 32, -3], [4, 4, 6]) },
        { name: 'tail', parent: 'critter', pivot: [0, 35, 3], cubes: box([-1, 34, 3], [2, 2, 4]) },
      ],
      'animation.pet.idle',
      {
        head: { rotation: swing([0, 0, 0], [0, 15, 0]) },
        critter: { position: swing([0, -1.3, 0], [0, -1.2, 0.1]), rotation: swing([-19, 0, 0], [-12, 0, 0]) },
        tail: { rotation: swing([0, -10, 0], [0, 10, 0]) },
      },
    ),
  },
}

/** Фигура как у skin3d: части с теми же именами, что у костей вещей. */
function figure() {
  const skin = new Group()
  skin.name = 'skin'
  const parts: Record<string, Object3D> = {}
  const place: [string, number, number, number][] = [
    ['head', 0, 4, 0],
    ['body', 0, -2, 0],
    ['rightArm', -5, -2, 0],
    ['leftArm', 5, -2, 0],
    ['rightLeg', -1.9, -12, 0],
    ['leftLeg', 1.9, -12, 0],
  ]
  for (const [name, x, y, z] of place) {
    const part = new Group()
    part.name = name
    part.position.set(x, y, z)
    part.rotation.set(0.1, -0.2, 0.05)
    skin.add(part)
    parts[name] = part
  }
  const anchorOf = (anchor: CosmeticAnchor): Object3D =>
    anchor === 'root' || anchor === 'cape' ? skin : (parts[anchor] ?? parts['body']!)
  return { skin, parts, anchorOf }
}

const snapshot = (nodes: Object3D[]) =>
  nodes.map((node) => {
    node.updateMatrix()
    return node.matrix.clone()
  })

describe('анимация вещи не трогает кости игрока', () => {
  for (const [name, { slot, clip, file }] of Object.entries(MODELS)) {
    it(name + ': крутит свои кости, фигура стоит как стояла', () => {
      const { skin, parts, anchorOf } = figure()
      const body = [skin, ...Object.values(parts)]
      const before = snapshot(body)

      const pieces = buildCosmetic(file.geometry, 'x.png', slot, file.animations, clip)
      expect(pieces.length, 'вещь построилась').toBeGreaterThan(0)
      const own: Object3D[] = []
      for (const piece of pieces) {
        anchorOf(piece.anchor).add(piece.object)
        piece.object.traverse((node) => own.push(node))
      }
      let ticker: Mesh | null = null
      for (const node of own) if (!ticker && (node as Mesh).onBeforeRender && (node as Mesh).isMesh) ticker = node as Mesh
      expect(ticker, 'у вещи есть что рисовать').not.toBeNull()

      const clock = performance.now
      const start = clock.call(performance)
      const ownStart = snapshot(own)
      let moved = false
      try {
        for (const seconds of [0.1, 0.37, 0.8, 1.3, 2.05]) {
          performance.now = () => start + seconds * 1000
          ;(ticker as unknown as Mesh).onBeforeRender({} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
          const after = snapshot(body)
          after.forEach((m, i) => {
            expect(m.equals(before[i] as Matrix4), 'часть игрока ' + body[i]!.name + ' не сдвинулась').toBe(true)
          })
          if (snapshot(own).some((m, i) => !m.equals(ownStart[i] as Matrix4))) moved = true
        }
      } finally {
        performance.now = clock
      }
      expect(moved, 'клип вещи и правда двигает её кости').toBe(true)
      // Кости вещи не подменяют части игрока: всё, что висит на фигуре, - внутри
      // групп вещи, а не рядом с головой или корпусом.
      for (const piece of pieces) expect(piece.object.name).toBe('millida-cosmetic')
    })
  }
})
