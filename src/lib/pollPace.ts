export const POLL_BASE_MS = 5_000
export const POLL_SERVER_MAX_MS = 30_000
export const POLL_HIDDEN_MIN_MS = 30_000
export const POLL_FAIL_MAX_MS = 60_000
export const POLL_AFTER_WAIT_MS = 1_000

/**
 * Интервал, названный сервером. Чужое число не принимается на веру: битое
 * значение иначе либо превратило бы опрос в шторм, либо остановило бы его.
 */
export function pollIntervalFrom(value: unknown): number {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return POLL_BASE_MS
  return Math.min(POLL_SERVER_MAX_MS, Math.max(POLL_BASE_MS, Math.round(ms)))
}

/**
 * Пауза перед следующим опросом. Разброс обязателен: без него все лаунчеры
 * возвращаются одной волной после перезапуска площадки и валят её повторно.
 */
export function pollDelayMs(
  serverMs: number,
  failures: number,
  hidden: boolean,
  random: () => number = Math.random,
  waited = false,
): number {
  // После ответа, который сервер держал до события, ждать нечего: новый долгий
  // запрос снова повиснет на сервере, а не будет стучаться.
  const base =
    failures > 0
      ? Math.min(POLL_FAIL_MAX_MS, POLL_BASE_MS * 2 ** (failures - 1))
      : hidden
        ? Math.max(POLL_HIDDEN_MIN_MS, serverMs)
        : waited
          ? POLL_AFTER_WAIT_MS
          : serverMs
  const spread = 0.8 + random() * 0.4
  return Math.round(base * spread)
}
