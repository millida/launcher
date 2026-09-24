import { describe, expect, it } from 'bun:test'
import { readAnimations } from './cosmeticAnimation'
import { EmoteSkeleton } from './emoteSkeleton'

const geometry = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'root' },
        { name: 'body_wrap', parent: 'root', pivot: [0, 12, 0] },
        { name: 'body', parent: 'body_wrap', pivot: [0, 24, 0] },
        { name: 'arm_right', parent: 'body_wrap', pivot: [-5, 22, 0] },
        { name: 'head', parent: 'body_wrap', pivot: [0, 24, 0] },
      ],
    },
  ],
}

const lying = readAnimations({
  'animation.test.lie': {
    loop: true,
    animation_length: 1,
    bones: { body_wrap: { rotation: { '0.0': [0, 0, 90], '1.0': [0, 0, 90] } } },
  },
})['animation.test.lie']!

const tPoseGeometry = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.test', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'body', pivot: [0, 24, 0] },
        { name: 'arm_left', parent: 'body', pivot: [5, 22, 0] },
        { name: 'arm_right', parent: 'body', pivot: [-5, 22, 0] },
      ],
    },
  ],
}

const tPose = readAnimations({
  'animation.test.t_pose': {
    loop: true,
    animation_length: 1,
    bones: {
      arm_left: { rotation: { '0.0': [0, 0, -90] } },
      arm_right: { rotation: { '0.0': [0, 0, 90] } },
    },
  },
})['animation.test.t_pose']!

describe('emote skeleton', () => {
  /**
   * Тот же договор, что у мода (EmotePoseAxesTest): клип пишется с высотой
   * вверх, примерочная и игра считают её вниз, и это зеркало переворачивает
   * поворот вокруг z. Без знака Т-поза складывала руки на груди - и в игре, и
   * на превью, и здесь.
   */
  it('a T-pose spreads the arms away from the body, as in the mod', () => {
    const skeleton = EmoteSkeleton.of(tPoseGeometry)
    expect(skeleton).not.toBeNull()
    const pose = skeleton!.poseAt(tPose, 0)

    expect((pose['arm_left']!.turn[2] * 180) / Math.PI).toBeCloseTo(-90, 0)
    expect((pose['arm_right']!.turn[2] * 180) / Math.PI).toBeCloseTo(90, 0)
  })

  it('a limb follows the body it hangs on', () => {
    const skeleton = EmoteSkeleton.of(geometry)
    expect(skeleton).not.toBeNull()
    const pose = skeleton!.poseAt(lying, 0.5)

    // The clip turns only the wrapper above the body. Turning each part by its
    // own clip angle - the old way - left the arm upright at the shoulder of a
    // standing player while the body lay on its side.
    const arm = pose['arm_right']!
    expect(Math.abs(Math.abs(arm.turn[2]) - Math.PI / 2)).toBeLessThan(0.01)
    expect(Math.hypot(...arm.shift)).toBeGreaterThan(5)

    const head = pose['head']!
    expect(Math.abs(Math.abs(head.turn[2]) - Math.PI / 2)).toBeLessThan(0.01)
  })

  it('a file without player bones gives no skeleton, so the old path is kept', () => {
    const props = {
      'minecraft:geometry': [{ description: { identifier: 'geometry.cup' }, bones: [{ name: 'cup' }] }],
    }
    expect(EmoteSkeleton.of(props)).toBeNull()
  })

  it('a parent loop in a broken file does not hang the viewer', () => {
    const looped = {
      'minecraft:geometry': [
        {
          description: { identifier: 'geometry.loop' },
          bones: [
            { name: 'body', parent: 'head', pivot: [0, 24, 0] },
            { name: 'head', parent: 'body', pivot: [0, 24, 0] },
          ],
        },
      ],
    }
    const skeleton = EmoteSkeleton.of(looped)
    expect(skeleton).not.toBeNull()
    expect(skeleton!.poseAt(lying, 0.5)['head']).toBeDefined()
  })
})
