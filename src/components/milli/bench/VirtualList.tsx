import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { reducedMotion } from '../motion'
import { offsetsOf, rowsInView, scrollFor } from './benchRows'

/*
 * Свой виртуализатор (без библиотек): высоты строк известны заранее (их
 * считает вызывающий), окно по scrollTop + запас 8, не больше 60 строк в DOM,
 * позиция — transform. Roving tabindex: фокус живёт на одной строке,
 * ↑↓/PgUp/PgDn/Home/End двигают его, Пробел и Enter отдаются наружу.
 * Прокрутка сохраняется наружу (стор верстака) после остановки и
 * восстанавливается при `restoreSeq`.
 *
 * Анимация раскладки (FLIP без чтения DOM): когда вызывающий меняет `animKey`
 * (клик, свернул группу, новая ревизия), смонтированные строки едут со
 * старого места на новое (Web Animations, позиции знаем из offsets), новые
 * проявляются, ушедшие гаснут копией на старом месте. Прокрутка, поиск и
 * фильтры не анимируются. prefers-reduced-motion — мгновенно.
 */

export interface VirtualHandle {
  scrollToIndex(i: number, align?: 'nearest' | 'center'): void
  /** Сделать строку активной (roving) и прокрутить к ней. */
  focusIndex(i: number): void
  el(): HTMLDivElement | null
}

interface Props<T> {
  rows: readonly T[]
  heightOf: (r: T) => number
  keyOf: (r: T) => string
  /** data-pid строки (projectId) — для замеров QA и «Показать». */
  pidOf?: (r: T) => string | undefined
  render: (r: T, i: number, active: boolean) => ReactNode
  /** Атрибут data-bench-scroll — по нему оболочка находит скроллер. */
  scrollKey: string
  label: string
  /** Сохранённый scrollTop и «когда восстановить» (меняется при показе панели). */
  restoreTop?: number
  restoreSeq?: unknown
  /** Прокрутка остановилась (150 мс) — сохранить. */
  onSettle?: (top: number) => void
  /** Любая прокрутка (закрыть подсказку). */
  onScroll?: () => void
  onKey?: (key: 'toggle' | 'open', i: number) => void
  /** Ширина скроллера изменилась (вызывающий пересчитывает высоты строк). */
  onWidth?: (w: number) => void
  /** Новое значение (по ===) — следующая раскладка анимируется (строки едут, новые проявляются, ушедшие гаснут). */
  animKey?: unknown
  /** Обычный поток после всех строк (подсказки, «Не вошли»): прокручивается вместе со списком. */
  tail?: ReactNode
  className?: string
  /** Оценка высоты окна до первого измерения (высоту задаёт CSS, читаем clientHeight). */
  maxH?: number
  over?: number
  max?: number
}

const MOVE_MS = 220
const IN_MS = 200
const OUT_MS = 160
const EASE = 'cubic-bezier(.2,.8,.2,1)'

interface Shown {
  node: ReactNode
  top: number
  h: number
}

function VirtualListIn<T>(props: Props<T>, ref: Ref<VirtualHandle>) {
  const { rows, heightOf, keyOf, render, over = 8, max = 60 } = props
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [viewH, setViewH] = useState(props.maxH ?? 600)
  const [active, setActive] = useState(0)
  const wantFocus = useRef(false)
  const offsets = useMemo(() => offsetsOf(rows.map(heightOf)), [rows, heightOf])
  const total = offsets[rows.length] ?? 0
  const [start, end] = rowsInView(offsets, top, viewH, over, max)

  // Свежие значения для обработчиков без пересоздания.
  const live = useRef({ offsets, viewH, start, end, props })
  live.current = { offsets, viewH, start, end, props }

  const raf = useRef(0)
  const settleT = useRef<number | undefined>(undefined)
  const onScroll = useCallback(() => {
    live.current.props.onScroll?.()
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        const el = box.current
        if (!el) return
        const t = el.scrollTop
        const l = live.current
        const [s, e] = rowsInView(l.offsets, t, l.viewH, over, max)
        // Окно не сдвинулось — React не трогаем.
        if (s !== l.start || e !== l.end) setTop(t)
      })
    window.clearTimeout(settleT.current)
    settleT.current = window.setTimeout(() => {
      const el = box.current
      if (el) live.current.props.onSettle?.(el.scrollTop)
    }, 150)
  }, [over, max])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      window.clearTimeout(settleT.current)
      window.clearTimeout(exitT.current)
      // Уходим (вкладку сменили) — последнее положение не теряем.
      const el = box.current
      if (el) live.current.props.onSettle?.(el.scrollTop)
    },
    [],
  )

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      setViewH(el.clientHeight || 600)
      if (el.clientWidth) live.current.props.onWidth?.(el.clientWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Восстановление прокрутки: при монтировании и при каждом показе панели
  // (WebKit сбрасывает scrollTop у элемента, побывавшего в display:none).
  useLayoutEffect(() => {
    const el = box.current
    const t = props.restoreTop ?? 0
    if (!el || !t) return
    el.scrollTop = t
    setTop(el.scrollTop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.restoreSeq])

  const scrollToIndex = useCallback((i: number, align: 'nearest' | 'center' = 'nearest') => {
    const el = box.current
    if (!el) return
    const l = live.current
    const t = scrollFor(l.offsets, i, el.scrollTop, el.clientHeight || l.viewH, align)
    if (t !== el.scrollTop) {
      el.scrollTop = t
      setTop(el.scrollTop)
    }
  }, [])

  const focusIndex = useCallback(
    (i: number) => {
      const n = live.current.props.rows.length
      if (!n) return
      const k = Math.max(0, Math.min(n - 1, i))
      wantFocus.current = true
      setActive(k)
      scrollToIndex(k)
    },
    [scrollToIndex],
  )

  useImperativeHandle(ref, () => ({ scrollToIndex, focusIndex, el: () => box.current }), [scrollToIndex, focusIndex])

  // Строка стала активной с клавиатуры — переводим фокус на неё после отрисовки.
  useEffect(() => {
    if (!wantFocus.current) return
    wantFocus.current = false
    box.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: true })
  }, [active, start])

  // Список стал короче (фильтр) — активная строка не должна выпасть.
  const act = Math.min(active, Math.max(0, rows.length - 1))

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    const row = t.closest<HTMLElement>('[data-index]')
    // Клавиши внутри полей и кнопок строки не перехватываем (кроме стрелок на самой строке).
    if (!row || (t !== row && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return
    const i = Number(row.dataset.index)
    const page = Math.max(1, Math.floor(viewH / 52) - 1)
    const go: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, PageDown: i + page, PageUp: i - page, Home: 0, End: rows.length - 1 }
    if (e.key in go) {
      e.preventDefault()
      focusIndex(go[e.key]!)
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      props.onKey?.('toggle', i)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      props.onKey?.('open', i)
    }
  }

  const out: ReactNode[] = []
  const shownNow = new Map<string, Shown>()
  for (let i = start; i < end; i++) {
    const r = rows[i]!
    const isAct = i === act
    const key = keyOf(r)
    const h = heightOf(r)
    const node = render(r, i, isAct)
    shownNow.set(key, { node, top: offsets[i]!, h })
    out.push(
      <div
        key={key}
        className="vl-row"
        role="listitem"
        data-row=""
        data-key={key}
        data-index={i}
        data-pid={props.pidOf?.(r)}
        tabIndex={isAct ? 0 : -1}
        style={{ transform: `translateY(${offsets[i]}px)`, height: h }}
        onFocus={() => (i !== act ? setActive(i) : undefined)}
      >
        {node}
      </div>,
    )
  }

  // ── Анимация раскладки ────────────────────────────────────────────────────
  // Что было на экране в прошлый коммит и где стояли все строки (ключ → верх).
  const prev = useRef<{ shown: Map<string, Shown>; rows: readonly T[]; offsets: Float64Array; seq: unknown; mounted: boolean }>({
    shown: new Map(),
    rows: [],
    offsets: new Float64Array(1),
    seq: props.animKey,
    mounted: false,
  })
  const [exits, setExits] = useState<[string, Shown][]>([])
  const exitT = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const p = prev.current
    const animate = p.mounted && p.seq !== props.animKey && !reducedMotion()
    const firstShow = !p.mounted && !reducedMotion()
    const host = inner.current
    if ((animate || firstShow) && host && typeof host.animate === 'function') {
      const oldTop = new Map<string, number>()
      if (animate) for (let i = 0; i < p.rows.length; i++) oldTop.set(keyOf(p.rows[i]!), p.offsets[i]!)
      const scroll = box.current?.scrollTop ?? 0
      const nodes = host.querySelectorAll<HTMLElement>(':scope > .vl-row[data-key]')
      let k = 0
      for (const n of nodes) {
        const s = shownNow.get(n.dataset.key!)
        if (!s) continue
        const was = oldTop.get(n.dataset.key!)
        const to = `translateY(${s.top}px)`
        if (was === undefined) {
          // Новая строка (развернули группу, добавили мод, первый показ): проявляется с лёгким сдвигом.
          const d = Math.min(k++, 12) * (firstShow ? 22 : 14)
          n.animate([{ opacity: 0, transform: to + ' translateX(10px)' }, { opacity: 1, transform: to }], { duration: IN_MS, delay: d, easing: EASE, fill: 'backwards' })
        } else if (was !== s.top) {
          // Строка поехала: со старого места (не дальше экрана — издалека «въезжает» с края).
          const from = Math.max(scroll - s.h, Math.min(scroll + viewH, was))
          n.animate([{ transform: `translateY(${from}px)` }, { transform: to }], { duration: MOVE_MS, easing: EASE })
        }
      }
      if (animate) {
        const gone: [string, Shown][] = []
        const now = new Set(rows.map(keyOf))
        for (const [key, s] of p.shown) if (!now.has(key)) gone.push([key, s])
        if (gone.length) {
          setExits(gone.slice(0, 24))
          window.clearTimeout(exitT.current)
          exitT.current = window.setTimeout(() => setExits([]), OUT_MS + 40)
        }
      }
    }
    p.shown = shownNow
    p.rows = rows
    p.offsets = offsets
    p.seq = props.animKey
    p.mounted = true
  })

  return (
    <div
      ref={box}
      className={'vl' + (props.className ? ' ' + props.className : '')}
      data-bench-list=""
      data-bench-scroll={props.scrollKey}
      role="list"
      aria-label={props.label}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div ref={inner} className="vl-in" style={{ height: total }}>
        {out}
        {exits.map(([key, s]) => (
          <div key={'x:' + key} className="vl-row vl-exit" aria-hidden="true" style={{ transform: `translateY(${s.top}px)`, height: s.h }}>
            {s.node}
          </div>
        ))}
      </div>
      {props.tail ? <div className="vl-tail">{props.tail}</div> : null}
    </div>
  )
}

export const VirtualList = forwardRef(VirtualListIn) as <T>(p: Props<T> & { ref?: Ref<VirtualHandle> }) => ReturnType<typeof VirtualListIn>
