import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { readAnimations } from './cosmeticAnimation'
import { EmoteSkeleton } from './emoteSkeleton'

/**
 * Parity with the mod on real emotes. The expected numbers come from the mod's
 * EmoteSkeleton run on the same files; point EMOTE_PARITY_DIR at a folder with
 * emote_<name>.json and emote_parity.json to run it.
 */
const DIR = process.env.EMOTE_PARITY_DIR ?? ''
const PARTS = ['head', 'body', 'arm_left', 'arm_right', 'leg_left', 'leg_right']

type Frame = Record<string, number[] | number | null>

describe('emote skeleton matches the mod', () => {
  it.skipIf(!DIR || !existsSync(DIR + '/emote_parity.json'))('same shifts and turns on real emotes', () => {
    const expected = JSON.parse(readFileSync(DIR + '/emote_parity.json', 'utf8')) as Record<
      string,
      { clip: string; frames: Frame[] }
    >
    let compared = 0
    for (const [name, want] of Object.entries(expected)) {
      const file = JSON.parse(readFileSync(DIR + '/emote_' + name + '.json', 'utf8'))
      const skeleton = EmoteSkeleton.of(file.geometry)
      expect(skeleton).not.toBeNull()
      const clip = readAnimations(file.animations)[want.clip]
      expect(clip).toBeDefined()
      for (const frame of want.frames) {
        // Past its end the mod holds the last frame while the wardrobe plays
        // the emote again: that is a choice about time, not about the skeleton.
        if ((frame['t'] as number) > clip!.length) continue
        const got = skeleton!.poseAt(clip!, frame['t'] as number)
        for (const part of PARTS) {
          const ref = frame[part] as number[] | null
          if (!ref) continue
          const pose = got[part]
          expect(pose).toBeDefined()
          const values = [...pose!.shift, ...pose!.turn]
          for (let k = 0; k < 6; k++) {
            const label = name + ' ' + part + ' @' + String(frame['t']) + ' [' + k + ']'
            // Keyframes marked catmullrom are eased more simply here than in the
            // mod: under a pixel and a few degrees at worst, not a broken pose.
            // The skeleton itself matches to the hundredth wherever keys are linear.
            const limit = k < 3 ? 1 : 0.05
            if (Math.abs(values[k]! - ref[k]!) >= limit) {
              throw new Error(label + ': launcher ' + values[k] + ', mod ' + ref[k])
            }
          }
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(40)
  })
})
