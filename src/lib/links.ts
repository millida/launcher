import { copyText } from './clipboard'
import { showToast } from '../state/ui'
import { t } from '../i18n'

export async function copyLink(url: string) {
  if (!url) {
    showToast(t('Ссылка ещё не готова — подожди пару секунд'))
    return
  }
  const copied = await copyText(url)
  showToast(copied ? t('Ссылка скопирована — открой её в браузере') : t('Открой вручную: {url}', { url }), copied ? undefined : 'error')
}
