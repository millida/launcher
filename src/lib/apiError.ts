import { offPlatformReason } from './offPlatform'

/// Разбор один на весь лаунчер: раньше каждый экран решал сам, и «не нашли
/// такого ника» доезжало до игрока как «войди в аккаунт» — человек шёл
/// проверять вход вместо того, чтобы поправить ник. Голый код («http 429»,
/// «Too Many Requests») не говорит ни что случилось, ни что делать дальше.
const STATUS_TEXT: Record<number, string> = {
  400: 'Запрос не принят — проверь введённые данные',
  401: 'Сессия Millida закончилась — войди в аккаунт заново',
  402: 'Не хватает средств на балансе — пополни счёт и повтори',
  403: 'Millida отказала в этом действии',
  404: 'Не найдено — возможно, это уже удалено',
  405: 'Действие недоступно — обнови лаунчер и повтори',
  408: 'Сервер не ответил вовремя — повтори попытку',
  409: 'Занято — выбери другое значение',
  410: 'Ссылка устарела — запроси новую',
  413: 'Файл слишком большой — уменьши размер и повтори',
  415: 'Такой формат файла не поддерживается',
  422: 'Данные заполнены неверно — проверь поля',
  423: 'Действие временно заблокировано — повтори позже',
  500: 'Сбой на стороне Millida — повтори через минуту',
  502: 'Millida временно недоступна — повтори через минуту',
  503: 'Millida перегружена или обновляется — повтори через минуту',
  504: 'Millida не успела ответить — повтори через минуту',
}

const RATE_LIMIT_TEXT = 'Слишком много попыток подряд — подожди немного и повтори'

const NOISE = [
  /^throttlerexception/i,
  /^too many requests$/i,
  /^unauthorized$/i,
  /^forbidden$/i,
  /^not found$/i,
  /^bad request$/i,
  /^internal server error$/i,
  /^service unavailable$/i,
  /^error$/i,
]

const OFFLINE =
  /нет связи|error sending request|os error 11001|os error 10051|failed to fetch|dns error|connection refused|connection reset/i

const TIMEOUT = /operation timed out|timed out|deadline has elapsed/i

function statusOf(raw: string): number {
  const match = /\bhttp (\d{3})\b/i.exec(raw)
  return match ? Number(match[1]) : 0
}

export function apiErrorText(e: unknown, fallback: string): string {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '')
    .replace(/^Error:\s*/, '')
    .trim()
  const held = offPlatformReason(e)
  if (held) return held
  if (!raw) return fallback

  if (OFFLINE.test(raw)) return 'Нет связи с Millida — проверь интернет и повтори'
  if (TIMEOUT.test(raw)) return 'Millida не ответила вовремя — повтори попытку'

  const status = statusOf(raw)
  if (status === 429 || /^too many requests$/i.test(raw) || /^throttlerexception/i.test(raw)) {
    return RATE_LIMIT_TEXT
  }
  if (/^unauthorized$/i.test(raw)) return STATUS_TEXT[401]

  const bare = /^http \d{3}$/i.test(raw) || NOISE.some((pattern) => pattern.test(raw))
  if (!bare) return raw

  if (status) {
    const known = STATUS_TEXT[status]
    if (known) return known
    if (status >= 500) return STATUS_TEXT[500]
    return fallback + ' (http ' + status + ')'
  }
  return fallback
}
