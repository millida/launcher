// What Play does before it calls the core, in what order. The build's own freshening (its update)
// and the care that follows it (graphics options, memory check) touch the same folder, so they go
// one after the other; signing in touches nothing of the build and starts at the same moment.
// Before, all three queued up, one network round trip after another.
import type { LaunchOutcome } from '../ipc/commands'

export interface LaunchSteps<A> {
  /** Brings a catalogue build to its published version. */
  freshen: () => Promise<void>
  /** Graphics options and the memory check; needs the build as the update left it. */
  care: () => Promise<void>
  /** Account credentials for the launch. */
  auth: () => Promise<A>
}

/**
 * Runs the steps and returns the sign-in result. If both sides fail, the build side wins: it is the
 * one that used to run first, and its failure (a cancel, mostly) is what the player asked for.
 */
export async function prepareLaunch<A>(steps: LaunchSteps<A>): Promise<A> {
  const build = steps.freshen().then(() => steps.care())
  const signedIn = steps.auth()
  const [b, a] = await Promise.allSettled([build, signedIn])
  if (b.status === 'rejected') throw b.reason
  if (a.status === 'rejected') throw a.reason
  return a.value
}

/** An answer of the core that is not a new game: the build is already running or already starting. */
export type NotLaunched = Exclude<LaunchOutcome, 'started'>

export function notLaunched(answer: unknown): NotLaunched | null {
  return answer === 'focused' || answer === 'running' || answer === 'starting' ? answer : null
}

/** The window that came forward explains itself; the other two answers need a word. */
export function notLaunchedNotice(answer: NotLaunched, say: { running: string; starting: string }): string | null {
  if (answer === 'focused') return null
  return answer === 'starting' ? say.starting : say.running
}

/**
 * What Play does after asking the core to raise a build that looks already running: the window came
 * forward (nothing to prepare, maybe a word to say), or the core has no such game and Play goes on
 * the usual way (a stale "running" list in the page, a game that has just closed).
 */
export type AfterRaise = { launch: true } | { launch: false; notice: string | null }

export function afterRaise(answer: unknown, say: { running: string; starting: string }): AfterRaise {
  const not = notLaunched(answer)
  return not ? { launch: false, notice: notLaunchedNotice(not, say) } : { launch: true }
}
