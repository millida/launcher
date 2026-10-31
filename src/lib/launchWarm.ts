// Prepared ahead of Play. While the lobby shows a build and the player has left the window alone
// for two seconds, the core prepares that build without starting it: Java, the game files (only
// looked at, never downloaded), the version descriptions, the lists of our mod, the skin server, a
// token about to end (engine/game/pipeline/warm.rs). Play then goes straight to starting the game.
// The core itself prepares a build at most once in ten minutes and never during a launch, a
// download or on a battery below 20 %; the same ten minutes here keep the window from asking for
// nothing.
import { warmLaunch } from '../ipc/commands'
import type { LaunchAuth } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { getAccount, launchAuthKind, millidaGameNick } from '../state/accounts'
import { useInstalls } from '../state/installs'
import { hasMillidaAccount } from './api'
import { whenIdle } from './idle'
import { MS_RENEW_AHEAD_MS, msTokenEndsSoon, warmDue, WARM_QUIET_MS } from './launchWarmRules'
import { noted } from './noted'

const lastWarm = new Map<string, number>()

const installing = () => Object.values(useInstalls.getState().tasks).some((t) => t.state === 'run')

function warmAuth(): LaunchAuth {
  return { kind: launchAuthKind(getAccount(), hasMillidaAccount(), false, millidaGameNick()) }
}

/**
 * Prepares `profile` for Play once the window has been quiet for two seconds. `launching`: Play is
 * under way (lib/launch.ts). Returns the cancel (the lobby left, another build was picked).
 */
export function scheduleLaunchWarm(profile: string | null, launching: () => boolean): () => void {
  if (!hasTauri() || !profile) return () => {}
  return whenIdle(
    () => {
      const now = Date.now()
      const facts = { profile, now, last: lastWarm.get(profile), launching: launching(), installing: installing(), hidden: document.hidden }
      if (!warmDue(facts)) return
      lastWarm.set(profile, now)
      void warmLaunch(profile, warmAuth()).catch(noted('launch-warm'))
      const acc = getAccount()
      if (msTokenEndsSoon(acc, now)) void import('../state/msLogin').then((m) => m.ensureMsAuth(acc, MS_RENEW_AHEAD_MS)).catch(noted('launch-warm-token'))
      // The module Play opens with: loaded now, it costs nothing at the click.
      void import('./prelaunchCare').catch(noted('launch-warm-care'))
    },
    WARM_QUIET_MS,
    15_000,
  )
}
