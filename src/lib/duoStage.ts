import type { AnimationClip } from './cosmeticAnimation'
import type { DuoScene } from './duoEmotes'
import { emoteSequence } from './emoteSequence'
import type { EmoteSequence } from './emoteSequence'

/** The stand-in for the other player: the same default skin the launcher shows when a nick has none. */
export const DUO_PARTNER_NICK = 'MHF_Steve'

/** A block is sixteen model pixels, and the viewer measures in pixels. */
export const VIEWER_UNITS_PER_BLOCK = 16

export interface DuoSpot {
  x: number
  z: number
  yaw: number
}

export interface DuoStage {
  a: DuoSpot
  b: DuoSpot
}

/** B's extra turn in degrees this far into the clip; the same rule as DuoEmote.spinAt in the mod. */
export function duoSpin(scene: DuoScene, seconds: number): number {
  if (scene.spinB === 0 || seconds <= scene.spinFrom) return 0
  const span = scene.spinTo - scene.spinFrom
  const progress = span > 0 ? Math.min(1, (seconds - scene.spinFrom) / span) : 1
  return scene.spinB * progress
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * The pair as DuoScene.place builds it in the game: A looks at B, B stands the
 * scene's distance away along that line and looks back, each with its own turn
 * on top. The line runs across the screen and the pair is centred on it, A on
 * the right: then the selfie's turns face both figures to the camera.
 *
 * The game's yaw grows the other way round the vertical than the viewer's, so
 * every angle from the scene changes sign here.
 */
export function duoStage(scene: DuoScene, seconds: number): DuoStage {
  const half = (scene.distance * VIEWER_UNITS_PER_BLOCK) / 2
  const gameYawA = 90 + scene.turnA
  const gameYawB = -90 + scene.turnB + duoSpin(scene, seconds)
  return {
    a: { x: half, z: 0, yaw: -radians(gameYawA) },
    b: { x: -half, z: 0, yaw: -radians(gameYawB) },
  }
}

/** One half of a paired emote on its own: no wind-up or loop is borrowed from the other scenes in the file. */
export const soloSequence = (clip: AnimationClip | null): EmoteSequence | null =>
  clip ? emoteSequence({ [clip.name]: clip }, clip) : null
