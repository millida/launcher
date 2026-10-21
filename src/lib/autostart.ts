import { autostartSet, autostartState } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { hydratePrefs } from './prefs'
import { onboardingDone, useOnboarding } from '../state/onboarding'
import { useTour } from '../state/tour'
import { uiChoice } from '../state/confirm'
import { showToast } from '../state/ui'
import { t } from '../i18n'

const ASKED_KEY = 'm-autostart'

const asked = (): boolean => {
  try {
    return localStorage.getItem(ASKED_KEY) !== null
  } catch {
    return true
  }
}

const remember = (on: boolean) => {
  try {
    localStorage.setItem(ASKED_KEY, on ? '1' : '0')
  } catch {
    /* without storage the question comes back next launch, which is harmless */
  }
}

const firstRunSettled = (): boolean => onboardingDone() && !useOnboarding.getState().open && !useTour.getState().active

function nextChange(): Promise<void> {
  return new Promise((resolve) => {
    if (firstRunSettled()) return resolve()
    const check = () => {
      if (!firstRunSettled()) return
      unsubOnboarding()
      unsubTour()
      resolve()
    }
    const unsubOnboarding = useOnboarding.subscribe(check)
    const unsubTour = useTour.subscribe(check)
  })
}

/// finishOnboarding closes the wizard and only then starts the tour, so the
/// moment the wizard closes is not yet the end of the first run.
async function waitFirstRun(): Promise<void> {
  for (;;) {
    await nextChange()
    await new Promise((r) => setTimeout(r, 0))
    if (firstRunSettled()) return
  }
}

/// A launcher that registers itself at login without asking and then sits in
/// the background reads as malware, so it is enabled only on an explicit yes.
export async function initAutostart(): Promise<void> {
  if (!hasTauri() || asked()) return
  await hydratePrefs()
  await waitFirstRun()
  if (asked()) return
  const answer = await uiChoice(t('Лаунчер будет ждать в трее и напомнит о сундуке и серии. Выключается в Настройках.'), {
    title: t('Запускать вместе с системой?'),
    confirmLabel: t('Включить'),
    cancelLabel: t('Не нужно'),
    danger: false,
  })
  if (answer === 'dismiss') return
  if (answer === 'no') {
    remember(false)
    return
  }
  try {
    remember(await autostartSet(true))
  } catch (e) {
    // Windows keeps answering Access denied, so asking again on every start would only nag.
    remember(false)
    console.error('[autostart]', e)
    showToast(t('Система не дала включить запуск вместе с системой. Попробуй ещё раз в Настройках.'), 'error')
  }
}

export async function autostartOn(): Promise<boolean> {
  if (!hasTauri()) return false
  return autostartState().catch(() => false)
}

export async function setAutostart(on: boolean): Promise<boolean> {
  const got = await autostartSet(on)
  remember(got)
  return got
}
