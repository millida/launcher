import { describe, expect, it } from 'bun:test'
import type { Mesh, MeshLambertMaterial, Object3D, Texture } from 'three'
import { buildCosmetic } from './cosmeticModel'

;(globalThis as { document?: unknown }).document = {
  createElementNS: () => ({
    width: 64,
    height: 64,
    src: '',
    style: {},
    addEventListener() {},
    removeEventListener() {},
  }),
}

const MODEL = {
  'minecraft:geometry': [
    {
      description: { texture_width: 64, texture_height: 64 },
      bones: [{ name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [0, 0] }] }],
    },
  ],
}

type Texel = [number, number, number, number]

function glowMapOf(root: Object3D): Texture {
  let found: Texture | null = null
  root.traverse((node) => {
    const mesh = node as Mesh
    if (mesh.isMesh) found = (mesh.material as MeshLambertMaterial).emissiveMap
  })
  if (!found) throw new Error('the suit built no mesh with a glow map')
  return found
}

function uploaded(texel: Texel, texture: Texture): [number, number, number] {
  const [r, g, b, a] = texel
  const share = texture.premultiplyAlpha ? a / 255 : 1
  return [Math.round(r * share), Math.round(g * share), Math.round(b * share)]
}

describe('glow map honours its own transparency', () => {
  const glow = glowMapOf(
    buildCosmetic(MODEL, 'base.png', 'BODY', undefined, undefined, undefined, undefined, 'glow.png')[0]!.object,
  )
  const cases: Array<{ why: string; texel: Texel; emitted: [number, number, number] }> = [
    {
      why: 'light blue hidden under a fully transparent texel flooded the whole jack-o-lantern suit',
      texel: [120, 200, 255, 0],
      emitted: [0, 0, 0],
    },
    {
      why: 'red hidden under transparency painted the VR headset and Enderman takeover flat red',
      texel: [255, 0, 0, 0],
      emitted: [0, 0, 0],
    },
    { why: 'an opaque glow texel is the neon the artist drew and must stay at full strength', texel: [255, 140, 0, 255], emitted: [255, 140, 0] },
    { why: 'a half transparent texel glows as much as the game overlay lets it through', texel: [200, 100, 50, 128], emitted: [100, 50, 25] },
  ]
  for (const { why, texel, emitted } of cases) {
    it(why, () => {
      expect(uploaded(texel, glow), 'glow colour under transparent texels must not light the item').toEqual(emitted)
    })
  }
})
