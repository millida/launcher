import { describe, expect, it } from 'bun:test'
import { compileMolang } from './molang'
import { poseOf, readAnimations } from './cosmeticAnimation'

const CLOCK = { animTime: 0.25, lifeTime: 3.25 }

/** Expression -> value at CLOCK, and why the case is pinned. */
const CASES: [string, number | null, string][] = [
  ['36.0', 36, 'a number written as text is still that number'],
  ['(36.0+(math.sin(((query.anim_time*360.0)*6.0))*0.3))', 36 + Math.sin(540 * (Math.PI / 180)) * 0.3, 'the sway "Anime love" bends its torso with'],
  ['math.sin(90)', 1, 'Molang trigonometry takes degrees, not radians'],
  ['math.cos(180)', -1, 'the same for cosine'],
  ['-q.anim_time * 2', -0.5, 'short aliases and unary minus'],
  ['query.life_time', 3.25, 'life time runs past the loop'],
  ['2 + 3 * 4', 14, 'multiplication binds tighter than addition'],
  ['(2 + 3) * 4', 20, 'parentheses group'],
  ['math.clamp(5, 0, 2)', 2, 'clamp keeps the value in range'],
  ['query.anim_time > 0.2 ? 10 : 20', 10, 'the ternary picks by the clock'],
  ['variable.rot_rn_y * 4', 0, 'an unset variable reads as zero, as in the game'],
  ['math.random(-10, 10)', 0, 'random holds still at the middle instead of shaking every frame'],
  ['return 7;', 7, 'a statement-form expression still gives its value'],
  ['1 / 0', 0, 'division by zero does not throw the figure to infinity'],
  ['v.x = 3; return v.x;', null, 'scripts with assignments are not keyframe values'],
  ['(1 + ', null, 'broken text falls back instead of throwing'],
  ['@#', null, 'unknown characters fall back'],
]

describe('molang keyframe expressions', () => {
  for (const [source, want, why] of CASES) {
    it(source, () => {
      const compiled = compileMolang(source)
      if (want === null) {
        expect(compiled, why).toBeNull()
        return
      }
      expect(compiled, why).not.toBeNull()
      expect(compiled!(CLOCK), why).toBeCloseTo(want, 5)
    })
  }
})

describe('an emote keyframe written as an expression', () => {
  const clips = readAnimations({
    'animation.love.loop': {
      loop: true,
      animation_length: 1,
      bones: {
        body_wrap: {
          position: { '0.0': [0, '(-4.3727+(math.sin(((query.anim_time*360.0)*5.0))*0.15))', 3.31] },
          rotation: { '0.0': ['(36.0+(math.sin(((query.anim_time*360.0)*6.0))*0.3))', 0, 0] },
        },
      },
    },
  })
  const clip = clips['animation.love.loop']!

  it('bends the torso by the expression instead of standing it upright', () => {
    const pose = poseOf(clip, 'body_wrap', 0)!
    expect(pose.rotation[0], 'без формулы корпус стоял прямо и отрывался от ног').toBeCloseTo(36, 3)
  })

  it('lowers the torso by the expression while keeping the plain number beside it', () => {
    const pose = poseOf(clip, 'body_wrap', 0)!
    expect(pose.position[1], 'корпус опускается к ногам, высота у мода считается вниз').toBeCloseTo(4.3727, 3)
    expect(pose.position[2], 'числовой сдвиг того же кадра сохраняется').toBeCloseTo(3.31, 3)
  })

  it('moves with the clip clock', () => {
    const a = poseOf(clip, 'body_wrap', 0)!.rotation[0]
    const b = poseOf(clip, 'body_wrap', 1 / 24)!.rotation[0]
    expect(a, 'покачивание идёт по времени клипа, а не замирает').not.toBeCloseTo(b, 3)
  })
})
