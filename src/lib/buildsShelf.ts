/** Two rows of five on the default window: eight builds, «Все версии» and the toggle tile. */
export const BUILDS_SHOWN = 8

export interface BuildsShelf<T> {
  shown: T[]
  /** Builds left out while collapsed. */
  hidden: number
  /** The toggle tile is drawn only when collapsing actually hides something. */
  toggle: boolean
}

/**
 * «Мои сборки» collapsed to the first builds. One extra build would cost the
 * toggle tile's own slot, so the shelf only collapses from `cap + 2` builds.
 * The selected build stays visible: collapsing must not hide what «Играть» starts.
 */
export function buildsShelf<T extends { name: string }>(
  all: T[],
  selected: string | null,
  expanded: boolean,
  cap: number = BUILDS_SHOWN,
): BuildsShelf<T> {
  const toggle = all.length > cap + 1
  if (!toggle || expanded) return { shown: all, hidden: 0, toggle }
  const shown = all.slice(0, cap)
  if (selected && !shown.some((b) => b.name === selected)) {
    const pick = all.find((b) => b.name === selected)
    if (pick) shown[cap - 1] = pick
  }
  return { shown, hidden: all.length - shown.length, toggle }
}
