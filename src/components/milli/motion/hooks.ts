import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefCallback } from 'react'
import { reducedMotion } from './reduced'

/*
 * Мелкие хуки микро-анимаций Милли (MOTION.md §2). Без зависимостей,
 * без setState на кадр: тикер пишет текст прямо в DOM, индикатор — CSS-переменные.
 */

/** Направление входа новой вкладки: 'r' — пришла справа (индекс вырос), 'l' — слева. На первом показе undefined. */
export function useSlideDir(index: number): 'l' | 'r' | undefined {
  const prev = useRef(index)
  const dir = useRef<'l' | 'r' | undefined>(undefined)
  if (prev.current !== index) {
    dir.current = index > prev.current ? 'r' : 'l'
    prev.current = index
  }
  return dir.current
}

/**
 * Перезапуск короткой анимации при смене значения: '0'/'1' чередуются
 * (в CSS две одинаковые keyframes с разными именами), undefined — пока не менялось.
 * <b data-mlm-bump={useBump(count)}>{count}</b>
 */
export function useBump(value: unknown): '0' | '1' | undefined {
  const prev = useRef(value)
  const n = useRef(-1)
  if (!Object.is(prev.current, value)) {
    prev.current = value
    n.current++
  }
  return n.current < 0 ? undefined : n.current % 2 ? '1' : '0'
}

/**
 * Скользящий индикатор сегмента. Ref — на контейнер вкладок; активная кнопка —
 * `.on` или `[aria-selected="true"]`. Ставит --mlm-x/--mlm-y/--mlm-w/--mlm-h и
 * data-mlm-ind ('0' — первый кадр без анимации, '1' — дальше с анимацией).
 * Внутри контейнера нужен `<i className="mlm-seg-ind" aria-hidden="true" />`.
 */
export function useSegIndicator(index: number): RefCallback<HTMLElement> {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!el) return
    let raf = 0
    const place = () => {
      const on = el.querySelector<HTMLElement>('.on, [aria-selected="true"]')
      if (!on) {
        el.removeAttribute('data-mlm-ind')
        return
      }
      el.style.setProperty('--mlm-x', on.offsetLeft + 'px')
      el.style.setProperty('--mlm-y', on.offsetTop + 'px')
      el.style.setProperty('--mlm-w', on.offsetWidth + 'px')
      el.style.setProperty('--mlm-h', on.offsetHeight + 'px')
      if (!el.hasAttribute('data-mlm-ind')) {
        el.setAttribute('data-mlm-ind', '0')
        raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => el.setAttribute('data-mlm-ind', '1'))))
      }
    }
    // Читаем геометрию не в коммите React (там layout грязный — был бы
    // принудительный пересчёт), а в rAF/ResizeObserver: это layout, который
    // кадр делает всё равно. Индикатор сдвигается на кадр позже — незаметно.
    const first = requestAnimationFrame(place)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null
    ro?.observe(el)
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [el, index])
  return setEl
}

const nf = typeof Intl !== 'undefined' ? new Intl.NumberFormat('ru-RU') : null
const fmt = (n: number) => (nf ? nf.format(n) : String(n))

/**
 * Тикающий счётчик без перерисовки родителя: элемент рендерится БЕЗ детей,
 * текст пишет хук (≤20 обновлений/с, доезд `ms`, «1 234»).
 * <b className="mlm-num" ref={useTicker(found)} />
 */
export function useTicker(value: number, opts: { ms?: number } = {}): RefCallback<HTMLElement> {
  const { ms = 400 } = opts
  const el = useRef<HTMLElement | null>(null)
  const cur = useRef(value)
  const raf = useRef(0)
  const set = useCallback((node: HTMLElement | null) => {
    el.current = node
    if (node) node.textContent = fmt(Math.round(cur.current))
  }, [])
  useEffect(() => {
    const node = el.current
    const from = cur.current
    const to = value
    if (!node || from === to || reducedMotion()) {
      cur.current = to
      if (node) node.textContent = fmt(Math.round(to))
      return
    }
    const t0 = performance.now()
    let last = -Infinity
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      if (t - last >= 50 || k === 1) {
        last = t
        cur.current = from + (to - from) * (1 - (1 - k) * (1 - k))
        node.textContent = fmt(Math.round(cur.current))
      }
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, ms])
  return set
}

/**
 * «Окно вспышки»: true ~ms после смены seq (не на первом рендере). Строки
 * виртуального списка, смонтированные в это окно, получают `.flash` /
 * `data-mlm-flash`; доскролленные позже — уже нет (никаких анимаций на 300 строках).
 */
export function useFlashWindow(seq: unknown, ms = 1400): boolean {
  const prev = useRef(seq)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (Object.is(prev.current, seq)) return
    prev.current = seq
    if (seq == null) return
    setOn(true)
    const t = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(t)
  }, [seq, ms])
  return on
}

/**
 * Сколько строк уже показано (по одной каждые stepMs). Reduced motion или
 * `instant` (событие из истории) — сразу все.
 */
export function useStagger(count: number, stepMs = 280, instant = false): number {
  const now = instant || reducedMotion()
  const [shown, setShown] = useState(() => (now ? count : Math.min(count, 1)))
  useEffect(() => {
    if (now) {
      if (shown !== count) setShown(count)
      return
    }
    if (shown >= count) return
    const t = setTimeout(() => setShown((s) => Math.min(count, s + 1)), stepMs)
    return () => clearTimeout(t)
  }, [shown, count, stepMs, now])
  return Math.min(shown, count)
}

/**
 * Отложенное снятие (тост, плашка): mounted держится ещё ms после show=false,
 * leaving=true в это время (data-mlm-leave="1" → анимация ухода).
 */
export function useLeave(show: boolean, ms = 140): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(show)
  const [leaving, setLeaving] = useState(false)
  if (show && (!mounted || leaving)) {
    setMounted(true)
    setLeaving(false)
  } else if (!show && mounted && !leaving) {
    setLeaving(true)
  }
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(
      () => {
        setMounted(false)
        setLeaving(false)
      },
      reducedMotion() ? 0 : ms,
    )
    return () => clearTimeout(t)
  }, [leaving, ms])
  return { mounted, leaving }
}
