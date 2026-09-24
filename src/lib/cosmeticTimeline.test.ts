import { describe, expect, it } from 'bun:test'
import { Box3, Group, type Mesh, Vector3 } from 'three'
import { buildCosmetic } from './cosmeticModel'
import { readAnimations } from './cosmeticAnimation'
import { emoteSequence } from './emoteSequence'

;(globalThis as { document?: unknown }).document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_: string) {} }),
}

/**
 * The props of an emote - the digits of "67", Boba's cup - move on the emote's
 * own clock. The figure is posed from the emote's progress; props that kept a
 * clock of their own drifted off the hands and went on moving while the emote
 * was paused.
 */
const MODEL = {
  'minecraft:geometry': [
    {
      description: { texture_width: 16, texture_height: 16 },
      bones: [{ name: 'digit', pivot: [0, 24, 0], cubes: [{ origin: [0, 24, 0], size: [2, 2, 2], uv: [0, 0] }] }],
    },
  ],
}
const ANIMATIONS = {
  'animation.test.loop': {
    loop: true,
    animation_length: 2,
    bones: { digit: { position: { '0': [0, 0, 0], '1': [0, 10, 0], '2': [0, 0, 0] } } },
  },
}

function heightAt(clock: number): number {
  const clips = readAnimations(ANIMATIONS)
  const sequence = emoteSequence(clips, clips['animation.test.loop']!)!
  const root = new Group()
  for (const piece of buildCosmetic(MODEL, 'x.png', 'EMOTE', ANIMATIONS, 'animation.test.loop', {
    sequence,
    clock: () => clock,
  })) {
    root.add(piece.object)
  }
  let mesh: Mesh | null = null
  root.traverse((node) => {
    if ((node as Mesh).isMesh) mesh = node as Mesh
  })
  expect(mesh, 'у вещи есть что рисовать').not.toBeNull()
  const drawn = mesh as unknown as Mesh
  drawn.onBeforeRender({} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  root.updateMatrixWorld(true)
  return new Box3().setFromObject(drawn).getCenter(new Vector3()).y
}

describe('the props of an emote follow the emote', () => {
  it('stand where the emote clock says, not where their own clock does', () => {
    const still = heightAt(0)
    const raised = heightAt(1)
    expect(Math.abs(raised - still), 'в секунду эмоции цифра поднята на 10 пикселей - по её часам').toBeCloseTo(10, 3)
  })
})
