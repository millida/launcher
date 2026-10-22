import { describe, expect, it } from 'bun:test'
import { readCosmeticMesh } from './cosmeticGeometry'

const CUBE = { origin: [-2, 0, -2], size: [4, 2, 4], uv: [0, 0] }

function quadsOf(boneName: string): number {
  const mesh = readCosmeticMesh({
    'minecraft:geometry': [
      {
        description: { texture_width: 64, texture_height: 64 },
        bones: [
          { name: 'root', pivot: [0, 0, 0] },
          { name: boneName, parent: 'root', pivot: [0, 0, 0], cubes: [CUBE] },
        ],
      },
    ],
  })
  const bone = mesh?.bones.find((entry) => entry.name === boneName)
  if (!bone) throw new Error(`bone ${boneName} vanished from the rig, its children would lose their parent`)
  return bone.quads.length
}

describe('bounding box bones', () => {
  const cases: Array<{ why: string; bone: string; quads: number }> = [
    { why: 'bbox_ bone is a size hint: drawn, it boxed the sneakers in a rainbow palette chunk', bone: 'bbox_feet', quads: 0 },
    { why: 'bbox_ around a hand is the same hint and must stay invisible', bone: 'bbox_right_hand', quads: 0 },
    { why: 'the mod matches the prefix case sensitively, so BBOX_ is a real part', bone: 'BBOX_feet', quads: 6 },
    { why: 'bbox without the underscore is not the reserved prefix in the mod either', bone: 'bboxed_strap', quads: 6 },
    { why: 'an ordinary bone keeps all six faces of its cube', bone: 'left_shoe', quads: 6 },
  ]
  for (const { why, bone, quads } of cases) {
    it(why, () => {
      expect(quadsOf(bone), 'bounding boxes must produce no geometry, real parts must keep theirs').toBe(quads)
    })
  }
})
