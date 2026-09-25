import { api } from './api'

/**
 * Здоровье сборки каталога: когда её последний раз удачно запускали и какая
 * доля запусков за неделю прошла без ошибок. Считает сервер по телеметрии
 * запусков (GET /launcher/pack-health), снимок обновляется раз в 5 минут.
 */
export interface PackHealth {
  slug: string
  status: 'ok' | 'warn' | 'unknown'
  launches: number
  /** Процент без ошибок; null — запусков пока мало для процента. */
  successPct: number | null
  lastOkAt: string | null
}

export interface HealthLine {
  tone: 'ok' | 'warn'
  /** «Работает» / «Бывают сбои». */
  head: string
  /** «запускали 2 ч назад»; пусто — удачных запусков в окне не было. */
  when: string
  /** Процент без ошибок; null — запусков мало. */
  pct: number | null
  report: boolean
}

function ago(iso: string, now: number): string {
  const min = (now - Date.parse(iso)) / 60_000
  if (!Number.isFinite(min)) return ''
  if (min < 5) return 'только что'
  if (min < 60) return Math.round(min) + ' мин назад'
  if (min < 1440) return Math.round(min / 60) + ' ч назад'
  return Math.round(min / 1440) + ' дн назад'
}

/** Строка под кнопкой. null — данных нет, строки на странице нет. */
export function healthLine(h: PackHealth | null, now = Date.now()): HealthLine | null {
  if (!h || h.status === 'unknown') return null
  const since = h.lastOkAt ? ago(h.lastOkAt, now) : ''
  const when = since ? 'запускали ' + since : ''
  const pct = h.successPct
  if (h.status === 'warn') return { tone: 'warn', head: 'Бывают сбои', when, pct, report: true }
  if (!when && pct === null) return null
  return { tone: 'ok', head: 'Работает', when, pct, report: false }
}

const cache = new Map<string, Promise<PackHealth | null>>()

export function loadPackHealth(slug: string): Promise<PackHealth | null> {
  const key = slug.trim().toLowerCase()
  if (!key) return Promise.resolve(null)
  let hit = cache.get(key)
  if (!hit) {
    hit = api<{ packs?: PackHealth[] }>('/launcher/pack-health?slugs=' + encodeURIComponent(key))
      .then((r) => (Array.isArray(r?.packs) ? r.packs.find((p) => p.slug === key) || null : null))
      .catch(() => {
        cache.delete(key)
        return null
      })
    cache.set(key, hit)
    // Снимок на сервере живёт 5 минут — дольше держать ответ незачем.
    setTimeout(() => cache.delete(key), 5 * 60_000)
  }
  return hit
}
