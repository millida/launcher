/**
 * Один и тот же сервер приходит из разных мест по-разному: из лога игры —
 * строчными и с портом, из карточки рейтинга — как его набрал владелец.
 * Ключ сравниваем в каноническом виде, иначе имя не находится.
 */
export const canonAddr = (addr: string): string => {
  const raw = (addr || '').trim().replace(/\.+$/, '')
  const m = /^(.*):(\d{1,5})$/.exec(raw)
  const host = (m ? m[1] : raw).replace(/\.+$/, '').toLowerCase()
  const port = m ? Number(m[2]) : 25565
  return port === 25565 ? host : host + ':' + port
}

