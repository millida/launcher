import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import type { SnapshotServer } from '../../lib/snapshot'
import { loadFeedPage } from './data'

/**
 * Бесконечная лента серверов рейтинга (правка владельца 23.09.2026, 19:42):
 * первые 30, дальше подгрузка при прокрутке, порядок — как в рейтинге.
 * Дубли одного проекта по имени убираются: остаётся первая, то есть самая
 * высокая строка рейтинга.
 */
export function ServerFeed({
  category,
  search = '',
  render,
  onFirstPage,
}: {
  category?: string
  /** Имя или адрес: лента того же режима, суженная поиском рейтинга. */
  search?: string
  render: (s: SnapshotServer, pos: number) => ReactNode
  /** Первая страница пришла: сколько всего нашлось (для аналитики поиска). */
  onFirstPage?: (total: number, search: string) => void
}) {
  const [list, setList] = useState<SnapshotServer[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const names = useRef(new Set<string>())
  const tail = useRef<HTMLDivElement>(null)
  const gen = useRef(0)

  const more = (from: number) => {
    const my = gen.current
    setBusy(true)
    setFailed(false)
    loadFeedPage(from, category, search || undefined)
      .then((page) => {
        if (my !== gen.current) return
        const fresh = page.servers.filter((s) => {
          const k = s.name.trim().toLowerCase()
          if (names.current.has(k)) return false
          names.current.add(k)
          return true
        })
        setList((l) => [...l, ...fresh])
        setOffset(from + 30)
        // Пустая страница — конец, даже если total обещал больше.
        setTotal(page.servers.length ? page.total : from)
        if (from === 0) onFirstPage?.(page.servers.length ? page.total : 0, search)
      })
      .catch(() => my === gen.current && setFailed(true))
      .finally(() => my === gen.current && setBusy(false))
  }

  useEffect(() => {
    gen.current++
    names.current = new Set()
    setList([])
    setOffset(0)
    setTotal(null)
    more(0)
  }, [category, search])

  const done = total !== null && offset >= total

  useEffect(() => {
    const el = tail.current
    if (!el || done || busy || failed) return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && more(offset), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [offset, done, busy, failed])

  return (
    <div className="ph-list">
      {list.map((s, i) => (
        <Fragment key={s.slug || s.name}>{render(s, i)}</Fragment>
      ))}
      {busy
        ? Array.from({ length: list.length ? 3 : 6 }, (_, i) => (
            <span key={'sk' + i} className="ph-srv skel" style={{ height: 76 }}></span>
          ))
        : null}
      {!busy && !failed && search && !list.length ? (
        <span className="hs-none">
          <Icon id="i-search" /> Ничего не нашли
        </span>
      ) : null}
      {failed ? (
        <button className="btn md secondary ph-feed-retry" data-track="retry" onClick={() => more(offset)}>
          <Icon id="i-restart" /> Повторить
        </button>
      ) : null}
      <div ref={tail} className="ph-feed-tail" aria-hidden="true"></div>
    </div>
  )
}
