const SWING = 0.8
const PERIOD_S = 11
const WAIT_MS = 900
const MAX_STEP = 0.1

interface Turned {
  playerYaw: number
  setPlayerYaw(yaw: number): void
}

/** Sways the figure from side to side so an effect is seen in depth and the face stays in view; a drag picks where the swing starts. */
export function turntable(engine: Turned, held: () => boolean): () => void {
  let raf = 0
  let last = 0
  let phase = 0
  let start = engine.playerYaw
  let resumeAt = performance.now() + WAIT_MS
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    const dt = Math.min(MAX_STEP, last ? (now - last) / 1000 : 0)
    last = now
    if (held()) {
      resumeAt = now + WAIT_MS
      phase = 0
      start = engine.playerYaw
      return
    }
    if (now < resumeAt) return
    phase += (dt / PERIOD_S) * Math.PI * 2
    engine.setPlayerYaw(start - SWING + Math.cos(phase) * SWING)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
