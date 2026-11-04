/**
 * While a chest reveal is up, the 3D chests of the shelf under it turn into a flat drawing: they
 * cannot be seen behind the reveal, and drawing them every frame takes frames from its scene.
 */
let held = 0
const subs = new Set<() => void>()

export const shelfHeld = () => held > 0

/** Whether a chest gives up its live slot. A chest inside the reveal scene itself never does. */
export const shelfYields = (inScene: boolean) => shelfHeld() && !inScene

/** A reveal scene is on screen: the shelf stays still until the returned function is called. */
export function holdShelfChests(): () => void {
  held += 1
  subs.forEach((f) => f())
  let done = false
  return () => {
    if (done) return
    done = true
    held = Math.max(0, held - 1)
    subs.forEach((f) => f())
  }
}

export function onShelfHold(f: () => void): () => void {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
