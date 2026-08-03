import { copyText } from './clipboard'
import { showToast } from '../state/ui'

export async function copyLink(url: string) {
  if (!url) {
    showToast('Ссылка ещё не готова — подожди пару секунд')
    return
  }
  const copied = await copyText(url)
  showToast(copied ? 'Ссылка скопирована — открой её в браузере' : 'Открой вручную: ' + url, copied ? undefined : 'error')
}
