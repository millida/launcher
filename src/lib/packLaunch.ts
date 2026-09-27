import { loadProfileSettings, updateCatalogPack } from '../ipc/commands'
import type { Profile } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { forgetPackView, loadPackView } from '../components/premium/packView'
import { installTask, runInstall, taskCancelled, useInstalls } from '../state/installs'
import type { InstallTask } from '../state/installs'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { keyCatalogPack } from './installKeys'
import { catalogPackSlug, packLaunchStep, packNeedsCheck, packUpdateFor } from './packUpdate'
import type { PackCard, PackLaunchStep, PackUpdate, PackUpdateOutcome } from './packUpdate'

export async function findPackUpdate(profile: string): Promise<PackUpdate | null> {
  const settings = await loadProfileSettings(profile)
  const slug = catalogPackSlug(settings)
  if (!slug) return null
  return packUpdateFor(settings, await loadPackView(slug))
}

/** What Play does with a catalogue build before the game starts. */
export async function packStepForLaunch(profile: string): Promise<PackLaunchStep> {
  if (!hasTauri() || !profile) return { kind: 'launch' }
  // Unreadable settings leave nothing to compare; the launch itself reports what is wrong with the build.
  const settings = await loadProfileSettings(profile).catch(() => null)
  const slug = catalogPackSlug(settings)
  if (!slug || !packNeedsCheck(settings)) return { kind: 'launch' }
  const card: PackCard = await loadPackView(slug).then(
    (view) => ({ view }),
    (error: unknown) => ({ error }),
  )
  return packLaunchStep(settings, card)
}

/**
 * The job the build page and Play both run. The cached card can be older than
 * the version just installed, and compared with it the build would be offered
 * that older version as an update, so it is dropped before the job reports done.
 */
export const packUpdateJob = (profile: string, slug: string): Promise<Profile> =>
  updateCatalogPack(profile).then((p) => {
    forgetPackView(slug)
    return p
  })

function outcomeOf(t: InstallTask | undefined): PackUpdateOutcome | null {
  if (t && t.state === 'run') return null
  if (!t || t.state === 'done') return t ? { kind: 'done' } : { kind: 'failed', error: 'обновление остановилось без ответа' }
  return taskCancelled(t) ? { kind: 'cancelled' } : { kind: 'failed', error: t.msg }
}

function watchUpdate(key: string, onProgress: (pct: number) => void): Promise<PackUpdateOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (t: InstallTask | undefined) => {
      if (settled) return
      const out = outcomeOf(t)
      if (!out) {
        onProgress(t ? t.pct : 0)
        return
      }
      settled = true
      stop()
      resolve(out)
    }
    const stop = useInstalls.subscribe((s) => settle(s.tasks[key]))
    settle(useInstalls.getState().tasks[key])
  })
}

export interface PackUpdateRun {
  key: string
  own: boolean
  outcome: Promise<PackUpdateOutcome>
}

/**
 * Starts the update, or follows one the build page already started: two jobs
 * for one pack would share its temp files. Its toasts are Play's to show, so
 * the job itself stays quiet on failure and cancel.
 */
export function runPackUpdateForLaunch(profile: string, u: PackUpdate, onProgress: (pct: number) => void): PackUpdateRun {
  const key = keyCatalogPack(u.slug)
  const running = installTask(key)
  const own =
    !(running && running.state === 'run') &&
    runInstall({
      key,
      title: profile,
      running: 'Обновляем…',
      run: () => packUpdateJob(profile, u.slug),
      onDone: () => {
        void useProfiles.getState().refresh()
        showToast('Сборка «' + profile + '» обновлена до версии ' + u.to, 'ok', 'achievement')
      },
      onError: () => {},
      onCancel: () => {},
    })
  return { key, own, outcome: watchUpdate(key, onProgress) }
}
