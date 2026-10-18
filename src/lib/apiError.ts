import { offPlatformReason } from './offPlatform'
import { moneyShortfall, shortfallText } from './money'
import { t } from '../i18n'

/// Разбор один на весь лаунчер: раньше каждый экран решал сам, и «не нашли
/// такого ника» доезжало до игрока как «войди в аккаунт» — человек шёл
/// проверять вход вместо того, чтобы поправить ник. Голый код («http 429»,
/// «Too Many Requests») не говорит ни что случилось, ни что делать дальше.
const STATUS_TEXT: Record<number, string> = {
  get 400() { return t('Запрос не принят — проверь введённые данные') },
  get 401() { return t('Сессия Millida закончилась — войди в аккаунт заново') },
  get 402() { return t('Не хватает средств на балансе — пополни счёт и повтори') },
  get 403() { return t('Millida отказала в этом действии') },
  get 404() { return t('Не найдено — возможно, это уже удалено') },
  get 405() { return t('Действие недоступно — обнови лаунчер и повтори') },
  get 408() { return t('Сервер не ответил вовремя — повтори попытку') },
  get 409() { return t('Занято — выбери другое значение') },
  get 410() { return t('Ссылка устарела — запроси новую') },
  get 413() { return t('Файл слишком большой — уменьши размер и повтори') },
  get 415() { return t('Такой формат файла не поддерживается') },
  get 422() { return t('Данные заполнены неверно — проверь поля') },
  get 423() { return t('Действие временно заблокировано — повтори позже') },
  get 500() { return t('Сбой на стороне Millida — повтори через минуту') },
  get 502() { return t('Millida временно недоступна — повтори через минуту') },
  get 503() { return t('Millida перегружена или обновляется — повтори через минуту') },
  get 504() { return t('Millida не успела ответить — повтори через минуту') },
}

const rateLimitText = (): string => t('Слишком много попыток подряд — подожди немного и повтори')

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

export function isTransientApiError(e: unknown): boolean {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '').trim()
  if (OFFLINE.test(raw) || TIMEOUT.test(raw)) return true
  const status = statusOf(raw)
  return status === 429 || status >= 500 || /^too many requests$/i.test(raw) || /^throttlerexception/i.test(raw)
}

/// Сбой кода, а не ответ службы: «Cannot read properties of undefined» игроку
/// ничего не говорит, ему нужен запасной текст экрана.
const CODE_FAULT =
  /cannot read propert|cannot set propert|is not a function|is not defined|is not iterable|is not an object|undefined is not|null is not|unexpected token|unexpected end of json|is not valid json|maximum call stack/i

function isCodeFault(e: unknown, raw: string): boolean {
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError) {
    // fetch падает TypeError'ом при обрыве связи — это не сбой кода.
    return !OFFLINE.test(raw)
  }
  return CODE_FAULT.test(raw)
}

export function apiErrorText(e: unknown, fallback: string): string {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '')
    .replace(/^Error:\s*/, '')
    .trim()
  const held = offPlatformReason(e)
  if (held) return held
  if (!raw) return fallback
  const short = moneyShortfall(e)
  if (short) return shortfallText(short)

  if (OFFLINE.test(raw)) return t('Нет связи с Millida — проверь интернет и повтори')
  if (TIMEOUT.test(raw)) return t('Millida не ответила вовремя — повтори попытку')
  if (isCodeFault(e, raw)) return fallback

  const status = statusOf(raw)
  if (status === 429 || /^too many requests$/i.test(raw) || /^throttlerexception/i.test(raw)) {
    return rateLimitText()
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
