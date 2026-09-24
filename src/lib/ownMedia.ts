/// Хосты нашего хранилища: вложения чата бэкенд кладёт в бакет с публичным
/// адресом cdn.millida.trade (у него же зеркало cdn.millida.net). Картинку с
/// другого адреса не грузим — иначе чужой хост узнаёт IP собеседника (аудит 24.09.2026).
const OWN_MEDIA_HOSTS = ['cdn.millida.trade', 'cdn.millida.net']

export function isOwnMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  // Локальное превью ещё не отправленной картинки.
  if (/^(blob:|data:image\/)/i.test(url)) return true
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && OWN_MEDIA_HOSTS.includes(u.hostname.toLowerCase())
  } catch {
    return false
  }
}
