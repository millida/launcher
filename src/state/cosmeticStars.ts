const KEY = 'm-cosmetic-stars'

/**
 * Избранные вещи. Живут в этом лаунчере, а не на сервере: подписка открывает
 * сотню вещей, человек носит десяток, и список «своих» нужен ему здесь и
 * сейчас. Переезд на другой компьютер не потеря - звёздочка ставится в одно
 * нажатие.
 */
function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Память браузера может быть закрыта настройками: звёздочки не та вещь,
    // ради которой стоит показывать ошибку.
  }
}

export function starredIds(): string[] {
  return read()
}

export function isStarred(id: string): boolean {
  return read().includes(id)
}

export function toggleStar(id: string): string[] {
  const list = read()
  const next = list.includes(id) ? list.filter((one) => one !== id) : list.concat(id)
  write(next)
  return next
}

/** Избранное сверху, остальное в прежнем порядке. */
export function starredFirst<T>(items: T[], idOf: (item: T) => string, stars: string[]): T[] {
  if (!stars.length) return items
  const marked: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (stars.includes(idOf(item))) marked.push(item)
    else rest.push(item)
  }
  return marked.concat(rest)
}
