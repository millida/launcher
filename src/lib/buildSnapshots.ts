import { hasTauri } from '../ipc/tauri'
import { t, tx } from '../i18n'
import { useGame } from '../state/game'
import { showToast, type ToastAction } from '../state/ui'
import { snapshot, snapshotDelete, snapshotRestore, snapshots, type MilliSnap } from './milliLocal'

export type { MilliSnap }

const demo = () => (import.meta.env.DEV && !hasTauri() ? import('./demoSnapshots') : null)

export async function listSnapshots(profile: string): Promise<MilliSnap[]> {
  const d = demo()
  return d ? (await d).demoSnapshots.list() : snapshots(profile)
}

export async function takeSnapshot(profile: string, label: string, auto: boolean): Promise<MilliSnap> {
  const d = demo()
  return d ? (await d).demoSnapshots.take(label, auto) : snapshot(profile, label, auto)
}

/** Resolves with the automatic "before the rollback" snapshot, so the rollback itself can be undone. */
export async function restoreSnapshot(profile: string, id: string): Promise<MilliSnap> {
  const d = demo()
  return d ? (await d).demoSnapshots.restore(id) : snapshotRestore(profile, id)
}

export async function deleteSnapshot(profile: string, id: string): Promise<void> {
  const d = demo()
  return d ? (await d).demoSnapshots.remove(id) : snapshotDelete(profile, id)
}

/** Content kinds whose folder a snapshot holds: rolling back anything else would undo nothing. */
export const snapshotCovers = (kind: string): boolean => kind === 'mod' || kind === 'resourcepack' || kind === 'shader'

export const isGameRunning = (profile: string): boolean => useGame.getState().list.includes(profile)

/** «Откатить» on the toast after a change made under an automatic snapshot. */
export function rollbackAction(profile: string, snap: MilliSnap, onRestored: () => void): ToastAction {
  return {
    label: t('Откатить'),
    run: () => {
      if (isGameRunning(profile)) {
        showToast(t('Закрой игру, чтобы откатить сборку'), 'error')
        return
      }
      restoreSnapshot(profile, snap.id)
        .then(() => {
          onRestored()
          showToast(t('Сборка вернулась к снимку «{label}»', { label: tx(snap.label) }), 'ok')
        })
        .catch((e) => showToast(t('Не удалось откатить: {error}', { error: tx(e) }), 'error'))
    },
  }
}
