// Decides which server may be shown in live online statistics: only one from the rating or ours. The player's private server stays home.
import { isOwnServerAddr, serverNeedsMillidaAuth } from './ownServer'

const key = (ip: string) =>
  (ip || '')
    .trim()
    .toLowerCase()
    .replace(/:25565$/, '')

const OUR_HOSTS = /(^|\.)(millida\.net|millida\.host|mcru\.me)(:\d+)?$/

/**
 * Что о сервере уходит в живой онлайн. Только сервер из рейтинга или наш
 * собственный: приватный сервер друга (домашний IP, название) остаётся дома.
 * Для события входа на сервер так было с аудита 24.09.2026, а пульс «в игре»
 * слал адрес любого сервера (найдено 13.10.2026 при описи телеметрии).
 */
export function publicServerLabel(
  addr: string | null | undefined,
  name: string | null | undefined,
  rated: readonly { slug?: string | null; ip?: string | null }[],
): string | null {
  const k = key(addr || '')
  if (!k) return null
  const ours = isOwnServerAddr(addr) || serverNeedsMillidaAuth(addr) || OUR_HOSTS.test(k)
  if (!ours && !rated.some((s) => s.slug && key(s.ip || '') === k)) return null
  return (name || addr || '').slice(0, 64) || null
}
