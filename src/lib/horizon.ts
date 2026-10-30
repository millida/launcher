import { horizonJavaOnce } from '../ipc/commands'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { apiErrorText } from './apiError'
import { t, tx } from '../i18n'

export const HORIZON_VERSION = '26.3'

export const horizonFits = (version: string, loader: string) => version === HORIZON_VERSION && loader === 'vanilla'

export { horizonReason } from './horizonError'

/** Horizon did not start: say why and offer this one Play on the usual Java game. */
export async function offerJavaStart(profile: string, reason: string, relaunch: () => void) {
  const yes = await uiConfirm(tx(reason), {
    title: t('Horizon не запустился'),
    confirmLabel: t('Запустить на Java'),
    cancelLabel: t('Закрыть'),
    danger: false,
  })
  if (!yes) return
  try {
    await horizonJavaOnce(profile)
  } catch (e) {
    showToast(apiErrorText(e, t('Не удалось сохранить настройку')), 'error')
    return
  }
  relaunch()
}
