import { openExt } from './api'
import { isPaymentUrl } from './payHosts'
import { showToast } from '../state/ui'
import { t } from '../i18n'

/// Открыть страницу оплаты/управления подпиской; чужой адрес — отказ с тостом.
export function openPaymentUrl(url: string | null | undefined): boolean {
  if (!isPaymentUrl(url)) {
    showToast(t('Ссылка на оплату не прошла проверку'), 'error')
    return false
  }
  openExt(url as string)
  return true
}
