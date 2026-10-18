export const ANSWER_TIMEOUT_MS = 15_000

export type HitView = 'tap' | 'wait' | 'stalled'

export function hitView(hits: number, need: number, answered: boolean, late: boolean): HitView {
  if (hits < need) return 'tap'
  return late && !answered ? 'stalled' : 'wait'
}

// The server replays a case purchase by its key, so a retry must reuse the key or it charges twice.
export function caseOpenKeys(fresh: () => string) {
  let opening: unknown = undefined
  let run: number | null = null
  let key = ''
  return {
    at(nextOpening: unknown, nextRun: number): string {
      if (nextOpening !== opening || nextRun !== run) {
        opening = nextOpening
        run = nextRun
        key = fresh()
      }
      return key
    },
  }
}

export type SkipAction = 'summary' | 'close'

export function skipAction(answered: boolean): SkipAction {
  return answered ? 'summary' : 'close'
}
