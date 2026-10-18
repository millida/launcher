export type Wait = (ms: number) => Promise<void>

const sleep: Wait = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** The answer if it comes within `ms`, otherwise what `instead` gives; `instead` is not asked once the answer is in. */
export function answerOr<T>(answer: Promise<T>, ms: number, instead: () => T | Promise<T>, wait: Wait = sleep): Promise<T> {
  let settled = false
  const marked = answer.finally(() => {
    settled = true
  })
  return Promise.race([marked, wait(ms).then(() => (settled ? marked : instead()))])
}

export interface LookParts<S, O> {
  skin: Promise<S>
  nickSkin: () => Promise<S>
  outfit: Promise<O>
  noOutfit: O
}

export interface LookWaits {
  skinMs: number
  outfitMs: number
}

/**
 * The look in two stages. `first` never waits longer than the slower of the two
 * limits: a stalled skin answer is stood in for by the skin found by nick, a
 * stalled outfit by no outfit. `full` is the real look and replaces `first`.
 */
export function lookStages<S extends object, O extends object>(
  parts: LookParts<S, O>,
  waits: LookWaits,
  wait: Wait = sleep,
): { first: Promise<S & O>; full: Promise<S & O> } {
  const full = Promise.all([parts.skin, parts.outfit]).then(([s, o]) => ({ ...s, ...o }))
  const skinSoon = answerOr(parts.skin, waits.skinMs, parts.nickSkin, wait)
  const outfitSoon = answerOr(parts.outfit, waits.outfitMs, () => parts.noOutfit, wait)
  const interim = Promise.all([skinSoon, outfitSoon]).then(([s, o]) => ({ ...s, ...o }))
  return { first: Promise.race([full, interim]), full }
}
