export const EMOTE_SHOW_MIN_MS = 2500
export const EMOTE_SHOW_MAX_MS = 8000

/**
 * Only the fitting room keeps a worn emote looping: there the person is trying
 * it on. On the home screen an endless loop reads as a stuck figure, so the
 * worn emote joins the occasional shows and the figure rests between them.
 */
export const wornEmoteLoops = (fittingRoom: boolean) => fittingRoom

/**
 * The emote whose skin mask cuts the figure: only one that is playing right now.
 * A worn emote that rests between shows on the home screen still carried its
 * mask, and the legs under roller skates or cloud boots stayed cut away.
 */
export function skinMaskEmote<T extends { slot: string }>(outfit: readonly T[], fittingRoom: boolean, showing: T | null): T | undefined {
  if (showing) return showing
  return wornEmoteLoops(fittingRoom) ? outfit.find((item) => item.slot === 'EMOTE') : undefined
}

/** A short loop repeats until the show is long enough to read; a long one is cut. */
export function emoteShowMs(introSeconds: number, loopSeconds: number): number {
  const loop = loopSeconds > 0 ? loopSeconds : 1
  const intro = introSeconds > 0 ? introSeconds : 0
  const seconds = intro + loop * Math.max(1, Math.ceil(3 / loop))
  return Math.min(EMOTE_SHOW_MAX_MS, Math.max(EMOTE_SHOW_MIN_MS, seconds * 1000))
}

/**
 * The emotes the figure plays now and then: the worn one first, then a shuffled
 * round of every emote, the worn one included once per round.
 */
export function showPicker<T>(show: readonly T[], worn: T | null, random: () => number = Math.random): () => T | null {
  const all = worn && !show.includes(worn) ? [worn, ...show] : [...show]
  let bag: T[] = worn ? [worn] : []
  return () => {
    if (!all.length) return null
    if (!bag.length) bag = all.map((item) => ({ item, key: random() })).sort((a, b) => a.key - b.key).map((x) => x.item)
    return bag.shift() ?? null
  }
}
