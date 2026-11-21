// Игра жива, а окна нет 4 минуты (ядро: game-stuck). Отдельный чанк: нужен редко, стартовый набор
// JS этим вопросом не платит.
import { t } from '../i18n'
import { uiChoice } from '../state/confirm'
import { useGame } from '../state/game'
import { stopWaitingGame } from './launch'

/** Ядро: игра жива, а окна нет 4 минуты. «Подождать» прячет лаунчер, как после обычного запуска. */
export async function gameStuck(profile: string) {
  if (!useGame.getState().list.includes(profile)) return
  const answer = await uiChoice(t('Игра «{name}» не открыла окно за 4 минуты — возможно, она зависла.', { name: profile }), {
    title: t('Игра не открылась'),
    confirmLabel: t('Остановить игру'),
    cancelLabel: t('Подождать ещё'),
    danger: true,
  })
  if (answer === 'yes') stopWaitingGame(profile)
}
