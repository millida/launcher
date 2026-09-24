import type { AnimationClip } from './cosmeticAnimation'

/**
 * The clips of an emote in the order Essential plays them: the wind-up, then
 * the loop until the player moves. The same rule as the mod's EmoteSequence -
 * if the two disagree, the fitting room shows one emote and the game another.
 *
 * The catalogue keeps one clip per emote, and for most of them it is the
 * wind-up. Played alone, it ended the emote before the part it is named after.
 * When the catalogue names the loop itself, its wind-up still opens it; a
 * clip the artist kept as a backup ("bkp") never plays.
 */
export interface EmoteSequence {
  intro: AnimationClip | null
  main: AnimationClip
  /** The clip playing this far into the emote. */
  clipAt(seconds: number): AnimationClip
  /** How far into that clip. */
  timeAt(seconds: number): number
}

const words = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/)
const backup = (name: string) => words(name).some((word) => word.includes('bkp'))

function sequence(intro: AnimationClip | null, main: AnimationClip): EmoteSequence {
  return {
    intro,
    main,
    clipAt: (seconds) => (intro && seconds < intro.length ? intro : main),
    timeAt: (seconds) => (intro ? (seconds < intro.length ? seconds : seconds - intro.length) : seconds),
  }
}

export function emoteSequence(
  clips: Record<string, AnimationClip>,
  chosen: AnimationClip | null,
): EmoteSequence | null {
  if (!chosen) return null
  const others = Object.entries(clips).filter(([name, clip]) => clip !== chosen && !backup(name))
  if (chosen.endless === true) {
    // The wind-up plays once whatever its own flag says: "67" marks its start
    // as looping too, and read that way it had no opening at all.
    const intro = others.find(([name]) => {
      const said = words(name)
      return said.includes('start') || said.includes('pre') || said.includes('first')
    })
    return sequence(intro ? intro[1] : null, chosen)
  }
  const loops = others.filter(([name]) => words(name).includes('loop'))
  const loop = loops.find(([, clip]) => clip.endless === true) ?? loops[0]
  return loop ? sequence(chosen, loop[1]) : sequence(null, chosen)
}
