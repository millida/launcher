import { describe, expect, it } from 'bun:test'
import type { Mesh, MeshLambertMaterial, Object3D } from 'three'
import { buildCosmetic } from './cosmeticModel'

interface FakeImage {
  width: number
  height: number
  src: string
  fire(): void
}

const images: FakeImage[] = []

;(globalThis as { document?: unknown }).document = {
  createElementNS: () => {
    let onLoad: ((this: FakeImage) => void) | null = null
    const image = {
      width: 64,
      height: 2048,
      src: '',
      style: {},
      addEventListener(kind: string, listener: (this: FakeImage) => void) {
        if (kind === 'load') onLoad = listener
      },
      removeEventListener() {},
      fire() {
        onLoad?.call(image)
      },
    }
    images.push(image)
    return image
  },
}

/**
 * The flame helmet keeps 32 frames stacked in one 64x2048 strip, in the base
 * picture and in the glow map alike. Both must show one frame at a time.
 */
const MODEL = {
  'minecraft:geometry': [
    {
      description: { texture_width: 64, texture_height: 64 },
      bones: [{ name: 'head', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] }],
    },
  ],
}

const FRAMES = 32

function materialOf(root: Object3D): MeshLambertMaterial {
  let found: MeshLambertMaterial | null = null
  root.traverse((node) => {
    const mesh = node as Mesh
    if (mesh.isMesh) found = mesh.material as MeshLambertMaterial
  })
  if (!found) throw new Error('the helmet built no mesh')
  return found
}

function glowAfter(order: Array<'base.png' | 'glow.png'>) {
  images.length = 0
  const pieces = buildCosmetic(MODEL, 'base.png', 'HEAD', undefined, undefined, undefined, undefined, 'glow.png')
  for (const src of order) images.find((image) => image.src === src)?.fire()
  const material = materialOf(pieces[0]!.object)
  return { base: material.map!, glow: material.emissiveMap! }
}

describe('glow map of a frame strip', () => {
  const cases: Array<{ why: string; order: Array<'base.png' | 'glow.png'> }> = [
    { why: 'base picture arrives first, the usual order on a cold cache', order: ['base.png', 'glow.png'] },
    {
      why: 'glow arrives first: it used to copy the still untouched repeat and smear all 32 frames over the head',
      order: ['glow.png', 'base.png'],
    },
  ]
  for (const { why, order } of cases) {
    it(why, () => {
      const { base, glow } = glowAfter(order)
      expect(base.repeat.y, 'the base picture must show one frame of the strip').toBeCloseTo(1 / FRAMES, 6)
      expect(glow.repeat.y, 'the glow map must show one frame, not the whole strip squeezed onto the model').toBeCloseTo(
        1 / FRAMES,
        6,
      )
      expect(glow.offset.y, 'the glow map must sit on the same frame as the base picture').toBeCloseTo(base.offset.y, 6)
    })
  }
})
