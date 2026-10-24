/*
 * Перед запуском: графика под ПК в сборку, которую игра ещё не открывала, и
 * проверка памяти. Занижённая вручную память — главная причина «лаунчер
 * лагает» на больших сборках: предлагаем поднять до автоподбора одной
 * кнопкой. Мало свободной памяти у самого ПК — подсказка закрыть программы.
 */
import { ramCheck, seedVideoOptions, type RamCheck } from '../ipc/commands'
import { uiChoice } from '../state/confirm'
import { showToast } from '../state/ui'
import { t } from '../i18n'
import { setLaunchRamMb } from './ramPref'

const BIG_PACK_MODS = 20
const MIN_GAP_MB = 1024
const SKIP_MS = 7 * 86_400_000

export type RamAdvice = { kind: 'ok' } | { kind: 'raise'; toGb: number; haveGb: number } | { kind: 'busy' }

export function ramAdvice(c: RamCheck): RamAdvice {
  if (c.packOwned || c.totalMb <= 0) return { kind: 'ok' }
  const target = Math.min(c.needMb, c.fitMb)
  if (c.manual && c.mods >= BIG_PACK_MODS && target - c.heapMb >= MIN_GAP_MB)
    return { kind: 'raise', toGb: Math.floor(target / 1024), haveGb: Math.max(1, Math.round(c.heapMb / 1024)) }
  // The heap is only a ceiling, but a game that cannot get even half of it swaps from the first minute.
  if (c.availableMb > 0 && c.availableMb * 2 < c.heapMb) return { kind: 'busy' }
  return { kind: 'ok' }
}

const skipKey = (profile: string) => 'm-ram-short-skip-' + profile

function skipped(profile: string): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(skipKey(profile)) || 0) < SKIP_MS
  } catch {
    return false
  }
}

async function seedVideo(profile: string) {
  const { hardwareVideo } = await import('./perfTier')
  await seedVideoOptions(profile, await hardwareVideo())
}

export async function prelaunchCare(profile: string): Promise<void> {
  await seedVideo(profile).catch((e) => console.error('[prelaunch] video', e))
  const { ramMbFor } = await import('./launch')
  const check = await ramCheck(profile, ramMbFor(profile)).catch(() => null)
  if (!check) return
  const advice = ramAdvice(check)
  if (advice.kind === 'busy') {
    showToast(t('Компьютеру мало свободной памяти — закрой браузер, чтобы игра не тормозила'), 'error')
    return
  }
  if (advice.kind !== 'raise' || skipped(profile)) return
  const answer = await uiChoice(t('Сборке нужно {need} ГБ памяти, а выделено {have} ГБ. С таким объёмом она будет тормозить и может вылететь.', { need: advice.toGb, have: advice.haveGb }), {
    title: t('Мало памяти'),
    confirmLabel: t('Дать {n} ГБ', { n: advice.toGb }),
    cancelLabel: t('Играть так'),
    danger: false,
  })
  if (answer === 'yes') {
    if (!setLaunchRamMb(profile, advice.toGb * 1024)) showToast(t('Не удалось сохранить память для сборки'), 'error')
    return
  }
  if (answer !== 'no') return
  try {
    localStorage.setItem(skipKey(profile), String(Date.now()))
  } catch {}
}
