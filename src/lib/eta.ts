import { intlTag } from '../i18n'

/// Время до конца установки словами языка игрока, без отдельных строк в таблицах переводов:
/// «через 25 сек.», «in 3 min». Секунды до полутора минут, дальше минуты, дальше часы.
/// Округление вверх: «через 3 мин» не должно оказаться двумя.
export function etaText(seconds: number, tag: string = intlTag()): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'always', style: 'short' })
  if (seconds < 90) return rtf.format(Math.max(5, Math.ceil(seconds / 5) * 5), 'second')
  if (seconds < 90 * 60) return rtf.format(Math.ceil(seconds / 60), 'minute')
  return rtf.format(Math.ceil(seconds / 3600), 'hour')
}
