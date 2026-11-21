import { invoke } from '../ipc/commands'
import { t } from '../i18n'
import { showToast, type ToastAction } from '../state/ui'
import { apiErrorText } from './apiError'

/** «Открыть папку» on the toast of a file the core has just saved: the system file manager opens with the file selected. */
export function openFolderAction(path: string | null | undefined): ToastAction | undefined {
  if (!path) return undefined
  return {
    label: t('Открыть папку'),
    run: () => void invoke<void>('reveal_saved_file', { path }).catch((e) => showToast(apiErrorText(e, t('Не удалось открыть папку')), 'error')),
  }
}
