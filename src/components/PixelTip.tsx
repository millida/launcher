import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/// Своя подсказка вместо системной (22.09.2026). Нативный `title` рисует ОС —
/// он выглядит чужим, и язык интерфейса его запрещает; при этом кнопки-значки
/// без подсказки превращаются в загадку. Один слушатель на весь документ:
/// - `data-tip` — явная подсказка;
/// - `title` — переносится в `data-tip` при первом наведении, чтобы ОС не всплыла;
/// - `aria-label` — только у элементов без видимого текста (кнопка-значок).
/// Плашка живёт в `document.body`: срез угла у карточек (clip-path) иначе её обрезал бы.

interface Tip {
  text: string
  x: number
  y: number
  below: boolean
}

const SELECTOR = '[data-tip],[title],button[aria-label],[role="button"][aria-label],a[aria-label]'
const DELAY_MS = 380

function tipText(el: HTMLElement): string {
  const title = el.getAttribute('title')
  if (title) {
    el.dataset.tip = title
    el.removeAttribute('title')
  }
  if (el.dataset.tip) return el.dataset.tip
  const label = el.getAttribute('aria-label') || ''
  return label && !(el.textContent || '').trim() ? label : ''
}

export function PixelTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<HTMLElement | null>(null)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      current.current = null
      setTip(null)
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = (e.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null
      if (el === current.current) return
      clear()
      if (!el) return
      // У сайдбара свои подсказки на CSS (свёрнутое меню) — вторая не нужна.
      if (el.closest('.sidebar') && el.dataset.tip) return
      const text = tipText(el)
      if (!text) return
      current.current = el
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return
        const r = el.getBoundingClientRect()
        const below = r.bottom + 40 < window.innerHeight
        setShift(0)
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below })
      }, DELAY_MS)
    }
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null
      if (current.current && to && current.current.contains(to)) return
      if (current.current && (e.target as Node) && current.current.contains(e.target as Node)) clear()
    }
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', clear, true)
    document.addEventListener('keydown', clear, true)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      clear()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', clear, true)
      document.removeEventListener('keydown', clear, true)
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  // Край окна: плашка сдвигается внутрь, а не уезжает за границу.
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!tip || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const pad = 8
    if (r.left < pad) setShift(pad - r.left)
    else if (r.right > window.innerWidth - pad) setShift(window.innerWidth - pad - r.right)
    else setShift(0)
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      className={'px-tip' + (tip.below ? '' : ' up')}
      role="tooltip"
      style={{ left: tip.x + shift, top: tip.y }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
