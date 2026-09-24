/**
 * Сколько ждать каталог. Без сети запрос мог висеть без конца, и раздел стоял
 * на скелетонах без ошибки и «Повторить» (аудит 24.09, UI-4). Сам запрос не
 * отменяется: дойдёт — ляжет в кэш для повтора.
 */
export const CATALOG_DEADLINE_MS = 10_000

/** Ответ или ошибка «timed out» не позже `ms`. */
export function inTime<T>(p: Promise<T>, ms = CATALOG_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('operation timed out')), ms)
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    )
  })
}
