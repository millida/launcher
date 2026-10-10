/*
 * Ответы каталога на диске (IndexedDB) — показать сразу, обновить в фоне
 * (stale-while-revalidate). Без них каждый запуск открывал каталог пустым и ждал
 * сервер: холодный запрос раздела у сервера — до 10 с, а сеть с VPN иногда
 * «залипает» (владелец 10.10.2026: «очень всё просто долго загружает»).
 *
 * localStorage не годится: синхронный, ~5 МБ на всё приложение, а фильтры
 * раздела «Все» одни весят 200 КБ. Не открылась база (приватный режим, сбой
 * диска) — всё работает как раньше, просто без мгновенного показа.
 */

const DB_NAME = 'millida-catalog'
const STORE = 'kv'
/** Сколько ответов держим — дальше выбрасываем самые старые. */
const MAX_ROWS = 300
/** Старше недели не показываем: витрина успела смениться. */
export const DISK_MAX_AGE_MS = 7 * 24 * 3600 * 1000

export interface DiskRow<T> {
  at: number
  value: T
}

let opening: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

/** Сохранённый ответ или null. Никогда не бросает. */
export async function diskGet<T>(key: string): Promise<DiskRow<T> | null> {
  const d = await db()
  if (!d) return null
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => {
        const row = req.result as DiskRow<T> | undefined
        resolve(row && typeof row.at === 'number' && Date.now() - row.at < DISK_MAX_AGE_MS ? row : null)
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Сохранённый ответ, если диск успел ответить за `ms` (первый кадр не ждёт диск дольше). */
export function diskPeek<T>(key: string, ms = 120): Promise<DiskRow<T> | null> {
  return Promise.race([diskGet<T>(key), new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

let writes = 0

/** Записать в фоне; раз в 40 записей — подрезать старое. */
export function diskSet<T>(key: string, value: T): void {
  void db().then((d) => {
    if (!d) return
    try {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ at: Date.now(), value } satisfies DiskRow<T>, key)
      if (++writes % 40 === 0) tx.oncomplete = () => void prune(d)
    } catch {
      /* диск полон или база закрыта — переживём */
    }
  })
}

async function prune(d: IDBDatabase): Promise<void> {
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
    const keys: IDBValidKey[] = []
    const ats: number[] = []
    await new Promise<void>((resolve) => {
      const cur = store.openCursor()
      cur.onsuccess = () => {
        const c = cur.result
        if (!c) return resolve()
        keys.push(c.key)
        ats.push((c.value as DiskRow<unknown>)?.at || 0)
        c.continue()
      }
      cur.onerror = () => resolve()
    })
    if (keys.length <= MAX_ROWS) return
    const order = keys.map((k, i) => ({ k, at: ats[i]! })).sort((a, b) => a.at - b.at)
    const drop = order.slice(0, keys.length - MAX_ROWS)
    const tx = d.transaction(STORE, 'readwrite')
    for (const x of drop) tx.objectStore(STORE).delete(x.k)
  } catch {
    /* не подрезали — в следующий раз */
  }
}
