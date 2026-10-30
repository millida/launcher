// What keeps the main window from being unloaded into the tray (lib/window.ts): work that
// lives only in the page. Kept apart from window.ts so stores can register without pulling it in.

export type UnloadHold = 'install' | 'call' | 'launch' | null
type HoldSource = { check: () => UnloadHold; subscribe: (cb: () => void) => () => void }
const sources: HoldSource[] = []

export function registerUnloadHold(check: () => UnloadHold, subscribe: (cb: () => void) => () => void) {
  sources.push({ check, subscribe })
}

export function currentHold(): UnloadHold {
  for (const s of sources) {
    const h = s.check()
    if (h) return h
  }
  return null
}

/** Calls `cb` on every change of any source; returns the unsubscribe. */
export function watchHolds(cb: () => void): () => void {
  const offs = sources.map((s) => s.subscribe(cb))
  return () => offs.forEach((off) => off())
}
