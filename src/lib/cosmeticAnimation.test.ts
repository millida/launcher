import { describe, expect, it } from 'bun:test'
import { poseOf, readAnimations } from './cosmeticAnimation'

/**
 * A switching keyframe -> the value on each side of it. Bedrock writes an
 * instant change as {"pre": old, "post": new}; the cat of "Cat cuddle" blinks
 * that way. The same case as the mod's AnimationTest: read as one value, the
 * open-eyed head shrank for two seconds and slid off its ears.
 */
const CLIPS = readAnimations({
  'animation.cat': {
    animation_length: 3,
    bones: { eyes_open: { scale: { '0.0': 1.0, '2.0': { pre: 1.0, post: 0.0 } } } },
  },
})

describe('a switching keyframe', () => {
  it('holds its old value until its moment', () => {
    expect(poseOf(CLIPS['animation.cat']!, 'eyes_open', 1)!.scale[0], 'голова целиком на месте, а не наполовину сжата').toBeCloseTo(1, 5)
  })

  it('takes the new value after it', () => {
    expect(poseOf(CLIPS['animation.cat']!, 'eyes_open', 2.5)!.scale[0], 'после переключения голова скрыта').toBeCloseTo(0, 5)
  })
})
