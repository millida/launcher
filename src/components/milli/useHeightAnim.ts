import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { reducedMotion } from './motion/reduced'

/*
 * Плавная высота тела вкладки в карточке сборки (MOTION.md §1.1).
 *
 *   const fold = useRef<HTMLDivElement>(null)
 *   const keep = useHeightAnim(fold, open, tab)
 *   <div ref={fold} className="mpc-fold">{(open || keep) && <div className="mpc-body">…</div>}</div>
 *
 * - open false→true / true→false: высота 0 ↔ контент (240 мс), содержимое
 *   проявляется (CSS по `data-mlm-fold`).
 * - key меняется при открытом теле (другая вкладка): высота доезжает от старой
 *   к новой (200 мс).
 * - Возвращает true, пока идёт сворачивание: тело держится смонтированным до
 *   конца анимации. Если тело не снимается — обёртке остаётся height:0.
 *
 * Дёшево: НИ ОДНОГО принудительного layout в коммите React. Старая высота —
 * из ResizeObserver; в коммите обёртка лишь фиксируется на старой высоте, а
 * новую высоту первого ребёнка читаем в следующем rAF (это тот layout, который
 * кадр сделал бы всё равно) и запускаем Web Animation from→to. Прерывание —
 * текущая высота считается по прогрессу анимации, без чтения DOM.
 * Обёртка без вертикальных padding/border; её первый ребёнок — тело.
 */

export interface HeightAnimOpts {
  /** Длительность раскрытия/сворачивания, мс (240). */
  ms?: number
  /** Длительность смены высоты при смене key, мс (200). */
  resizeMs?: number
}

type Phase = 'open' | 'opening' | 'closing' | 'closed' | 'resize'

// = --m-ease-move (Web Animations не понимает var()).
const EASE = 'cubic-bezier(.32,.72,0,1)'

interface St {
  first: boolean
  open: boolean
  key: unknown
  lastH: number
  anim: Animation | 'pending' | null
  from: number
  to: number
  raf: number
}

export function useHeightAnim(ref: RefObject<HTMLElement | null>, open: boolean, key?: unknown, opts: HeightAnimOpts = {}): boolean {
  const { ms = 240, resizeMs = 200 } = opts

  // Свёртывание: держим тело смонтированным до конца анимации.
  // Состояние «из пропсов» в рендере — тело не снимается ни на один коммит.
  const [closing, setClosing] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    setClosing(!open)
  }

  const s = useRef<St>({ first: true, open, key, lastH: -1, anim: null, from: 0, to: 0, raf: 0 })

  // Последняя устоявшаяся высота обёртки (до коммита, который её поменяет).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((ents) => {
      if (s.current.anim) return
      const b = ents[ents.length - 1]
      s.current.lastH = b.borderBoxSize?.[0]?.blockSize ?? (b.target as HTMLElement).offsetHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  useLayoutEffect(() => {
    const st = s.current
    const el = ref.current
    const wasOpen = st.open
    const keyChanged = !Object.is(st.key, key)
    st.open = open
    st.key = key
    if (!el) return

    const setPhase = (p: Phase) => el.setAttribute('data-mlm-fold', p)
    const settle = (isOpen: boolean, h: number) => {
      st.anim = null
      if (isOpen) {
        el.style.height = ''
        el.style.overflow = ''
        setPhase('open')
        if (h >= 0) st.lastH = h
      } else {
        el.style.height = '0px'
        el.style.overflow = 'hidden'
        setPhase('closed')
        st.lastH = 0
        setClosing(false)
      }
    }

    if (st.first) {
      st.first = false
      if (!open) {
        el.style.height = '0px'
        el.style.overflow = 'hidden'
      }
      setPhase(open ? 'open' : 'closed')
      return
    }
    if (wasOpen === open && !(open && keyChanged)) return

    // Откуда: середина текущей анимации (по прогрессу) или последняя устоявшаяся высота.
    let from: number
    const cur = st.anim
    if (cur === 'pending') from = st.from
    else if (cur) {
      const p = cur.effect?.getComputedTiming().progress
      from = st.from + (st.to - st.from) * (p ?? 1)
      cur.onfinish = null
      cur.cancel()
    } else if (!wasOpen) from = 0
    else from = st.lastH >= 0 ? st.lastH : el.getBoundingClientRect().height
    cancelAnimationFrame(st.raf)

    if (reducedMotion() || typeof el.animate !== 'function') {
      settle(open, -1)
      return
    }

    // Фиксируем старую высоту на этот кадр (запись, не чтение).
    const dur = wasOpen && open ? resizeMs : ms
    setPhase(wasOpen && open ? 'resize' : open ? 'opening' : 'closing')
    el.style.overflow = 'hidden'
    el.style.height = from + 'px'
    st.anim = 'pending'
    st.from = from
    st.to = from

    st.raf = requestAnimationFrame(() => {
      const inner = el.firstElementChild as HTMLElement | null
      const to = open && inner ? inner.offsetHeight : 0
      if (Math.abs(to - from) < 2) {
        settle(open, to)
        return
      }
      el.style.height = to + 'px' // значение под анимацией = конечное
      const a = el.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: dur, easing: EASE })
      st.anim = a
      st.to = to
      a.onfinish = () => {
        if (st.anim === a) settle(open, to)
      }
    })
  }, [ref, open, key, ms, resizeMs])

  useEffect(
    () => () => {
      const st = s.current
      cancelAnimationFrame(st.raf)
      if (st.anim && st.anim !== 'pending') st.anim.cancel()
    },
    [],
  )

  return closing
}

export default useHeightAnim
