/// Куда лаунчер может отправить игрока платить или управлять подпиской: шлюзы
/// провайдеров (Antilopay, Enot) и сам сайт. Ссылку с другим хостом не
/// открываем — подменённый ответ или запись в localStorage не уведёт на фишинг
/// (аудит 24.09.2026).
const PAY_DOMAINS = ['antilopay.com', 'enot.io', 'millida.net']

export function isPaymentUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return PAY_DOMAINS.some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}
