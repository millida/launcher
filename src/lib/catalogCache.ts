/**
 * Кэш ответов каталога контента: Modrinth, CurseForge и наши сборки.
 *
 * Переключение вкладки — это не новые данные, а тот же запрос, который человек
 * уже делал минуту назад: сборки, моды, ресурспаки. Без кэша каждое нажатие
 * уходило в сеть через щит, и TLS-рукопожатие там временами застревает на
 * секунды — отсюда и шесть секунд ожидания на пустом месте.
 *
 * Срок жизни тот же, что у кэша прокси в trade-api: держать клиентскую копию
 * дольше серверной бессмысленно, короче — бессмысленно вдвойне.
 */
const TTL_MS = 5 * 60 * 1000

const LIMIT = 120

interface Row {
  at: number
  value: unknown
}

const rows = new Map<string, Row>()
const inflight = new Map<string, Promise<unknown>>()

function evictOldest(): void {
  let oldestKey = ''
  let oldestAt = Infinity
  for (const [key, row] of rows) {
    if (row.at < oldestAt) {
      oldestAt = row.at
      oldestKey = key
    }
  }
  if (oldestKey) rows.delete(oldestKey)
}

/** Свежий ответ, если он есть, — без обращения к сети и без промиса. */
export function peekCatalog<T>(key: string): T | undefined {
  const row = rows.get(key)
  if (!row) return undefined
  if (Date.now() - row.at >= TTL_MS) {
    rows.delete(key)
    return undefined
  }
  return row.value as T
}

/**
 * Ответ из кэша, а если его нет — один запрос на всех ждущих.
 *
 * Склейка нужна не меньше самого кэша: вкладка, предзагрузка соседних вкладок и
 * повторное нажатие легко просят одно и то же в один кадр, и до склейки это
 * были три отдельных соединения к одному адресу.
 */
export function cachedCatalog<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = peekCatalog<T>(key)
  if (hit !== undefined) return Promise.resolve(hit)

  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running

  // Сбой не кэшируем и промах снимаем в `finally`: иначе одна ошибка сети
  // заперла бы ключ до перезапуска лаунчера.
  const started = load()
    .then((value) => {
      if (inflight.get(key) !== started) return value
      if (rows.size >= LIMIT) evictOldest()
      rows.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      if (inflight.get(key) === started) inflight.delete(key)
    })
  inflight.set(key, started)
  return started
}

/** The next read of the key goes to the network; a request already under way does not put its answer back. */
export function forgetCatalog(key: string): void {
  rows.delete(key)
  inflight.delete(key)
}

export function clearCatalogCache(): void {
  rows.clear()
  inflight.clear()
}
