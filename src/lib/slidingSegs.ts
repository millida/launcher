import { useEffect } from 'react'

/**
 * Скользящая подложка у всех переключателей лаунчера (07.10.2026, «как в чате
 * Милли»): выбранная вкладка не вспыхивает, а подложка плавно едет к ней.
 * Работает на любом `.segs`: ищет выбранный (`.on` или
 * aria-selected) и двигает `.ms-ind` через transform.
 */
const SEL = '.segs'

function place(box: HTMLElement) {
  const on = box.querySelector<HTMLElement>(':scope > .on, :scope > [aria-selected="true"]')
  let ind = box.querySelector<HTMLElement>(':scope > .ms-ind')
  if (!on) {
    if (ind) ind.style.opacity = '0'
    return
  }
  if (!ind) {
    ind = document.createElement('span')
    ind.className = 'ms-ind'
    ind.setAttribute('aria-hidden', 'true')
    box.prepend(ind)
    box.classList.add('ms-box')
  }
  const first = !box.hasAttribute('data-ms')
  ind.style.transition = first ? 'none' : ''
  ind.style.opacity = '1'
  ind.style.width = on.offsetWidth + 'px'
  ind.style.height = on.offsetHeight + 'px'
  ind.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)'
  if (first) {
    box.setAttribute('data-ms', '')
    requestAnimationFrame(() => ind && (ind.style.transition = ''))
  }
}

export function useSlidingSegs() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const all = () => {
      raf = 0
      document.querySelectorAll<HTMLElement>(SEL).forEach((b) => b.offsetParent && !b.querySelector(':scope > .mlm-seg-ind') && place(b))
    }
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(all)
    }
    const mo = new MutationObserver(queue)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected'] })
    window.addEventListener('resize', queue)
    queue()
    return () => {
      mo.disconnect()
      window.removeEventListener('resize', queue)
      cancelAnimationFrame(raf)
    }
  }, [])
}
