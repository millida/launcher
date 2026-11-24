import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { SnapshotServer } from '../lib/snapshot'
import { ensureMcVersions } from './mcVersions'
import { toRatingCard } from './ratingCard'
import type { RatingServer } from './servers'

export type FeedSortId = 'rating' | 'online' | 'votes' | 'new'

interface Page {
  servers?: RatingServer[]
  total?: number
}

/** Запрос списка — тот же, что у millida.net/rating: /v2/rating/servers, sort=rating по умолчанию, без своих фильтров. */
const url = (offset: number, limit: number, sort: FeedSortId, search: string) => {
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset), sort })
  if (search) q.set('search', search.slice(0, 60))
  return '/rating/servers?' + q.toString()
}

/** Не чаще раза в полминуты: возврат в окно обновляет список, но не заваливает рейтинг запросами. */
const REFRESH_MS = 30_000
const REFRESH_CAP = 40

/**
 * Список серверов рейтинга порциями: первые `step`, «Показать ещё» добавляет по `step`.
 * Порядок мест — как у API без перестановок и без склейки дублей. Сам обновляется
 * при открытии и при возврате в окно.
 */
export function useRatingFeed({ sort = 'rating', search = '', step = 10, on = true }: { sort?: FeedSortId; search?: string; step?: number; on?: boolean }) {
  const [list, setList] = useState<SnapshotServer[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const gen = useRef(0)
  const at = useRef(0)
  const len = useRef(0)
  len.current = list.length

  const first = useCallback(
    (silent: boolean, keep = 0) => {
      const my = ++gen.current
      if (!silent) setState('loading')
      const limit = Math.min(Math.max(step, keep), REFRESH_CAP)
      void ensureMcVersions()
        .then(() => api<Page>(url(0, limit, sort, search)))
        .then((d) => {
          if (my !== gen.current) return
          const raw = d.servers || []
          at.current = Date.now()
          setList(raw.map((s, i) => toRatingCard(s, i + 1)))
          setTotal(d.total ?? raw.length)
          setState('ok')
        })
        .catch(() => {
          if (my !== gen.current || silent) return
          setState('error')
        })
    },
    [sort, search, step],
  )

  useEffect(() => {
    if (on) first(false)
  }, [on, first])

  // Возврат в окно и открытие экрана: список не старше полуминуты.
  useEffect(() => {
    if (!on) return
    const wake = () => {
      if (document.visibilityState === 'hidden' || Date.now() - at.current < REFRESH_MS) return
      first(true, len.current)
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [on, first])

  const more = useCallback(() => {
    if (busy || state !== 'ok') return
    const my = gen.current
    const from = len.current
    setBusy(true)
    api<Page>(url(from, step, sort, search))
      .then((d) => {
        if (my !== gen.current) return
        const raw = d.servers || []
        setList((l) => l.concat(raw.map((s, i) => toRatingCard(s, l.length + i + 1))))
        setTotal(d.total ?? total)
      })
      .catch(() => {})
      .finally(() => setBusy(false))
  }, [busy, state, step, sort, search, total])

  return { list, total, state, busy, hasMore: list.length < total, more, retry: () => first(false) }
}
