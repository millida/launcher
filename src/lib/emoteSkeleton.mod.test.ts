import { describe, expect, it } from 'bun:test'
import { readAnimations } from './cosmeticAnimation'
import { EmoteSkeleton } from './emoteSkeleton'

/**
 * The fitting room must place a limb exactly where the game places it.
 *
 * An emote rig is a chain - orbit, body, arms, legs - and the pose the player
 * sees is one bone's place in that chain, read off as three angles. The mod and
 * the launcher each own a copy of that reading, so the numbers below were taken
 * from the mod itself on this rig (net.millida.core.animation.EmoteSkeleton) and
 * are the contract between the two. If they drift apart, the same emote looks
 * one way in the wardrobe and another in the world.
 *
 * The rig deliberately turns a container above a limb and scales one arm: those
 * are the two cases where a wrong reading used to tear the figure apart rather
 * than merely tilt it.
 */
const RIG = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.rig', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'body_orbit', parent: 'root', pivot: [0, 24, 0] },
        {
          name: 'body',
          parent: 'body_orbit',
          pivot: [0, 24, 0],
          cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }],
        },
        { name: 'arms', parent: 'body', pivot: [0, 22, 0] },
        {
          name: 'arm_left',
          parent: 'arms',
          pivot: [5, 22, 0],
          cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] }],
        },
        {
          name: 'arm_right',
          parent: 'arms',
          pivot: [-5, 22, 0],
          cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }],
        },
        { name: 'legs', parent: 'body', pivot: [0, 12, 0] },
        {
          name: 'leg_left',
          parent: 'legs',
          pivot: [1.9, 12, 0],
          cubes: [{ origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [16, 48] }],
        },
        {
          name: 'leg_right',
          parent: 'legs',
          pivot: [-1.9, 12, 0],
          cubes: [{ origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] }],
        },
        {
          name: 'head',
          parent: 'body',
          pivot: [0, 24, 0],
          cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }],
        },
      ],
    },
  ],
}

const CLIP = {
  'animation.rig.probe': {
    loop: true,
    bones: {
      body_orbit: { rotation: [10, -25, 40] },
      body: { rotation: [-15, 30, -20] },
      legs: { rotation: [25, -10, 35] },
      leg_left: { rotation: [-40, 15, -30] },
      arm_right: { rotation: [-50, 10, 25], scale: [1.4, 0.8, 1.2] },
    },
  },
}

/** Shift in model pixels then turn in radians, as the mod reports them. */
const FROM_THE_MOD: Record<string, number[]> = {
  head: [0, 0, 0, 0.03842, 0.14952, 0.48943],
  body: [0, 0, 0, 0.03842, 0.14952, 0.48943],
  arm_left: [-1.5657, 2.09368, -0.66883, 0.03842, 0.14952, 0.48943],
  arm_right: [-0.29322, -2.55513, 0.82076, -0.77078, 0.2929, 0.94655],
  leg_left: [-6.58852, 0.28952, 0.59426, -0.12983, 0.42445, 0.77658],
  leg_right: [-4.565, -3.05823, 0.31734, 0.55346, -0.07294, 1.08293],
}

/** Та же проба, но кость корпуса висит на двенадцать пикселей ниже точки игры - как у 98 эмоций набора. */
const RIG_LOW_BODY = JSON.parse(JSON.stringify(RIG)) as typeof RIG
RIG_LOW_BODY['minecraft:geometry'][0]!.bones.find((b) => b.name === 'body')!.pivot = [0, 12, 0]

const FROM_THE_MOD_LOW_BODY: Record<string, number[]> = {
  head: [-2.69412, -2.12884, 1.43275, 0.03842, 0.14952, 0.48943],
  body: [-2.69412, -2.12884, 1.43275, 0.03842, 0.14952, 0.48943],
  arm_left: [-4.25982, -0.03515, 0.76392, 0.03842, 0.14952, 0.48943],
  arm_right: [-2.98734, -4.68397, 2.25351, -0.77078, 0.2929, 0.94655],
  leg_left: [-9.28264, -1.83931, 2.027, -0.12983, 0.42445, 0.77658],
  leg_right: [-7.25912, -5.18706, 1.75009, 0.55346, -0.07294, 1.08293],
}

describe('the fitting room reads a pose the way the mod does', () => {
  it('puts every part where the mod puts it', () => {
    const skeleton = EmoteSkeleton.of(RIG)
    expect(skeleton).not.toBeNull()
    const clip = readAnimations(CLIP)['animation.rig.probe']
    expect(clip).toBeDefined()

    check(skeleton!.poseAt(clip!, 0), FROM_THE_MOD)
  })

  it('turns the body around the point the game turns it around', () => {
    const skeleton = EmoteSkeleton.of(RIG_LOW_BODY)
    expect(skeleton).not.toBeNull()
    const clip = readAnimations(CLIP)['animation.rig.probe']
    check(skeleton!.poseAt(clip!, 0), FROM_THE_MOD_LOW_BODY)
  })
})

/** A leg goes from a linear key to a catmullrom one and back: between keys the mod eases it by the key it left. */
const STEP = {
  'animation.rig.step': {
    loop: true,
    animation_length: 2,
    bones: {
      leg_left: {
        rotation: { '0': [0, 0, 0], '1': { post: [40, 0, 0], lerp_mode: 'catmullrom' }, '2': [0, 0, 0] },
        position: { '0': [0, 0, 0], '1': { post: [0, 0, -4], lerp_mode: 'catmullrom' }, '2': [0, 0, 0] },
      },
    },
  },
}

/** Moment of the clip -> the left leg as the mod places it (shift in pixels, turn in radians) -> why it is pinned. */
const EASING: [number, number[], string][] = [
  [0.25, [0, 0, -1, 0.17453, 0, 0], 'from a linear key the leg moves evenly, though the next key is catmullrom'],
  [1.25, [0, 0, -3.375, 0.58905, 0, 0], 'from a catmullrom key the leg eases out, though the next key is linear'],
]

describe('the fitting room eases a clip between keys the way the mod does', () => {
  for (const [seconds, wanted, why] of EASING) {
    it(why, () => {
      const skeleton = EmoteSkeleton.of(RIG)
      const clip = readAnimations(STEP)['animation.rig.step']
      expect(clip).toBeDefined()
      check(skeleton!.poseAt(clip!, seconds), { leg_left: wanted })
    })
  }
})

function check(posed: Record<string, { shift: number[]; turn: number[] }>, want: Record<string, number[]>) {
  {
    for (const [part, wanted] of Object.entries(want)) {
      const got = posed[part]
      expect(got, part + ' is missing from the pose').toBeDefined()
      const values = [...got!.shift, ...got!.turn]
      for (let k = 0; k < 6; k++) {
        expect(
          Math.abs(values[k]! - wanted[k]!),
          part + ' number ' + k + ': the mod says ' + wanted[k] + ', the fitting room says ' + values[k],
        ).toBeLessThan(0.002)
      }
    }
  }
}
