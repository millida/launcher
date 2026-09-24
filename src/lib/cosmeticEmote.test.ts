import { describe, expect, it } from 'bun:test'
import { Group, Vector3 } from 'three'
import { readAnimations } from './cosmeticAnimation'
import { CosmeticEmote } from './cosmeticEmote'
import { emoteSequence } from './emoteSequence'

/**
 * The fitting room turns the torso about the middle of its group, the game
 * about the neck. However the gap is bridged, the figure has to stay in one
 * piece: the neck of the posed torso sits where the head turns, and its
 * shoulders where the arms turn. When it did not, "Anime: power" showed the
 * head floating off a torso that had slid away from the arms.
 */
function rig(bodyPivotHeight: number) {
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: 'geometry.rig', texture_width: 64, texture_height: 64 },
        bones: [
          { name: 'root', pivot: [0, 0, 0] },
          { name: 'body_orbit', parent: 'root', pivot: [0, 18, 0] },
          { name: 'body', parent: 'body_orbit', pivot: [0, bodyPivotHeight, 0] },
          { name: 'head', parent: 'body', pivot: [0, 24, 0] },
          { name: 'arm_left', parent: 'body', pivot: [5, 22, 0] },
          { name: 'arm_right', parent: 'body', pivot: [-5, 22, 0] },
          { name: 'leg_left', parent: 'root', pivot: [1.9, 12, 0] },
          { name: 'leg_right', parent: 'root', pivot: [-1.9, 12, 0] },
        ],
      },
    ],
  }
}

const CLIP = readAnimations({
  'animation.rig.lean': {
    loop: true,
    animation_length: 2,
    bones: {
      body_orbit: { rotation: { '0': [0, 0, 0], '1': [20, -35, 15], '2': [0, 0, 0] } },
      body: {
        rotation: { '0': [0, 0, 0], '1': [30, 10, -25], '2': [0, 0, 0] },
        position: { '0': [0, 0, 0], '1': [1, -6, 3], '2': [0, 0, 0] },
      },
      arm_left: { rotation: { '0': [0, 0, 0], '1': [-120, 40, 0], '2': [0, 0, 0] } },
    },
  },
})['animation.rig.lean']!

/** Where each part's group stands before any pose, as the viewer builds the figure. */
const REST: Record<string, [number, number, number]> = {
  head: [0, 0, 0],
  body: [0, -6, 0],
  leftArm: [5, -2, 0],
  rightArm: [-5, -2, 0],
  leftLeg: [1.9, -12, -0.1],
  rightLeg: [-1.9, -12, -0.1],
}

function figure() {
  const parent = new Group()
  const skin: Record<string, Group> = {}
  for (const [name, at] of Object.entries(REST)) {
    const part = new Group()
    part.position.set(...at)
    parent.add(part)
    skin[name] = part
  }
  return { parent, skin, position: { y: 0 } }
}

/** Case -> why it is pinned. */
const CASES: [string, number][] = [
  ['the body bone at the neck, where the game turns the torso', 24],
  ['the body bone twelve pixels lower, as 98 of the hundred emotes hang it', 12],
]

describe('an emote keeps the figure in one piece', () => {
  for (const [why, height] of CASES) {
    it(why, () => {
      const emote = new CosmeticEmote(emoteSequence({}, CLIP)!, rig(height))
      const body = figure()
      for (const step of [0.25, 0.5, 0.75, 1, 1.25]) {
        emote.progress = step
        emote.update(body, 0)
        body.parent.updateMatrixWorld(true)
        const torso = body.skin['body']!
        const neck = torso.localToWorld(new Vector3(0, 6, 0))
        const head = body.skin['head']!.position
        expect(
          neck.distanceTo(head),
          `at ${step}s the torso's neck is ${neck.distanceTo(head).toFixed(2)} px from the head: the figure comes apart`,
        ).toBeLessThan(0.05)
        for (const [arm, side] of [['leftArm', 5], ['rightArm', -5]] as const) {
          const shoulder = torso.localToWorld(new Vector3(side, 4, 0))
          const joint = body.skin[arm]!.position
          expect(
            shoulder.distanceTo(joint),
            `at ${step}s the ${arm} hangs ${shoulder.distanceTo(joint).toFixed(2)} px off its shoulder`,
          ).toBeLessThan(0.05)
        }
      }
    })
  }
})
