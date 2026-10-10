/**
 * Долгий кэш больших ответов (каталог косметики 1,5 МБ, модели вещей) в IndexedDB.
 * Память живёт до закрытия лаунчера, а каждый запуск начинал с нуля и ждал
 * 3-12 секунд ответа каталога (жалоба 10.10.2026: «медленно надевается»).
 * Любая ошибка (приватный режим, квота, сорванная база) - просто промах кэша.
 */
const DB = 'millida-cache'
const STORE = 'kv'

let opened: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (opened) return opened
  opened = new Promise((done) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => done(req.result)
      req.onerror = () => done(null)
      req.onblocked = () => done(null)
    } catch {
      done(null)
    }
  })
  return opened
}

export interface CachedRow<T> {
  at: number
  value: T
}

export async function idbGet<T>(key: string): Promise<CachedRow<T> | null> {
  const db = await open()
  if (!db) return null
  return new Promise((done) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => {
        const row = req.result as CachedRow<T> | undefined
        done(row && typeof row.at === 'number' ? row : null)
      }
      req.onerror = () => done(null)
    } catch {
      done(null)
    }
  })
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ at: Date.now(), value } satisfies CachedRow<T>, key)
  } catch {
    // квота или закрытая база: кэш необязателен
  }
}
