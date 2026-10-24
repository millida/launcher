import { expect, test } from 'bun:test'
import { buildCosmetic } from './cosmeticModel'

;(globalThis as { document?: unknown }).document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_: string) {} }),
}

type Vec3 = [number, number, number]
type Bone = { name: string; parent?: string; pivot?: Vec3; cubes?: { origin: Vec3; size: Vec3; uv: [number, number] }[] }

const cube = (origin: Vec3, size: Vec3) => [{ origin, size, uv: [0, 0] as [number, number] }]

const geometry = (bones: Bone[]) => ({
  format_version: '1.12.0',
  'minecraft:geometry': [{ description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 }, bones }],
})

const skeleton = (cape: Bone): Bone[] => [
  { name: 'root' },
  { name: 'body_wrap', parent: 'root' },
  { name: 'body', parent: 'body_wrap', pivot: [0, 24, 0] },
  cape,
  { name: 'head', parent: 'root', pivot: [0, 24, 0] },
  { name: 'headphones', parent: 'head', pivot: [0, 24, 0], cubes: cube([-5, 26, -1], [10, 4, 2]) },
]

/**
 * Input -> verdict: which parts of an emote file reach the figure. The lobby
 * hides the account cape for every piece hung on the cape, and the VIBE_DANCE,
 * 67 and WAVE_R files carry an empty `cape` group from the player skeleton:
 * after one show the player's own cape was gone from the home screen.
 */
const CASES: { name: string; bones: Bone[]; cape: boolean; why: string }[] = [
  {
    name: 'empty cape group',
    bones: skeleton({ name: 'cape', parent: 'body', pivot: [0, 24, 2] }),
    cape: false,
    why: 'a skeleton group draws nothing and must not take the cape place',
  },
  {
    name: 'cape group with a prop',
    bones: skeleton({ name: 'cape', parent: 'body', pivot: [0, 24, 2], cubes: cube([-5, 8, 2], [10, 16, 1]) }),
    cape: true,
    why: 'a real piece on the cape still hangs there and covers the account cape',
  },
]

for (const c of CASES) {
  test(`emote ${c.name}: cape piece ${c.cape ? 'kept' : 'dropped'}`, () => {
    const pieces = buildCosmetic(geometry(c.bones), 'x.png', 'EMOTE')
    const anchors = pieces.map((piece) => piece.anchor)
    expect(anchors.includes('cape'), c.why).toBe(c.cape)
    expect(anchors.length > 0, 'the headphones prop must still reach the figure').toBe(true)
  })
}
