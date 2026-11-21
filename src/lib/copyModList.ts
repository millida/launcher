import { listContent, type ModFile, type Profile } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { t } from '../i18n'
import { showToast } from '../state/ui'
import { apiErrorText } from './apiError'
import { copyText } from './clipboard'
import { formatModList } from './modList'

/** Копирует читаемый список модов сборки. `known` — уже загруженные моды (вкладка модов), иначе читаем с диска. */
export async function copyModList(pr: Profile, known: ModFile[] | null): Promise<void> {
  try {
    const mods = known ?? (hasTauri() ? await listContent(pr.name, 'mod') : [])
    const ok = await copyText(formatModList(pr, mods))
    showToast(ok ? t('Список скопирован') : t('Не удалось скопировать'), ok ? 'ok' : 'error')
  } catch (e) {
    showToast(apiErrorText(e, t('Не удалось скопировать')), 'error')
  }
}
