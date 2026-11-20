import { listenWorldAutoBackup, type WorldAutoBackupDone } from '../ipc/worldBackups'
import { showToast } from '../state/ui'
import { t, tx } from '../i18n'

// None of the notification kinds (messages, friends, rooms) describes a backup, so it has no
// level of its own: a quiet toast, never a sound. A finished backup is not news worth a chime.

export function autoBackupToastText(r: WorldAutoBackupDone): { text: string; error: boolean } | null {
  if (r.failed.length) return { text: t('Автобэкап не удался: {error}', { error: tx(r.failed[0] ?? '') }), error: true }
  if (!r.worlds.length) return null
  if (r.cloudError) return { text: t('Автобэкап сохранён на ПК, в облако не загрузился: {error}', { error: tx(r.cloudError) }), error: true }
  const name = r.worlds[0] ?? ''
  if (r.uploaded) {
    return r.worlds.length === 1
      ? { text: t('Автобэкап мира «{name}» готов и загружен в облако', { name }), error: false }
      : { text: t('Автобэкап миров готов и загружен в облако: {n}', { n: r.worlds.length }), error: false }
  }
  return r.worlds.length === 1
    ? { text: t('Автобэкап мира «{name}» готов', { name }), error: false }
    : { text: t('Автобэкап миров готов: {n}', { n: r.worlds.length }), error: false }
}

export function watchWorldAutoBackups() {
  void listenWorldAutoBackup((r) => {
    const toast = autoBackupToastText(r)
    if (toast) showToast(toast.text, toast.error ? 'error' : 'ok', false)
  })
}
