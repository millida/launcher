import { useEffect, useState } from 'react'
import { Icon } from '../Icon'

/** Разделы ленты магазина: порядок = порядок денег (ТЗ магазина v2, 06.10.2026). */
export const SHOP_SECTIONS = [
  { id: 'shop-rubies', name: 'Рубины', icon: 'i-gem' },
  { id: 'shop-pass', name: 'Пропуск', icon: 'i-star' },
  { id: 'shop-day', name: 'Скидки', icon: 'i-flame' },
  { id: 'shop-tasks', name: 'Бонусы', icon: 'i-gift' },
  { id: 'shop-sets', name: 'Наборы', icon: 'i-shirt' },
  { id: 'shop-cases', name: 'Ящики', icon: 'i-chest' },
] as const

/**
 * Липкая полоса якорей: прыжок прокруткой по ленте, активный раздел
 * подсвечен. Вкладок нет — страница одна.
 */
export function ShopNav({ on, order }: { on: boolean; /** Порядок разделов ленты (задания выше у новичков). */ order?: string[] }) {
  const list = order ? order.map((id) => SHOP_SECTIONS.find((s) => s.id === id)!).filter(Boolean) : SHOP_SECTIONS
  const [active, setActive] = useState<string>(SHOP_SECTIONS[0].id)
  useEffect(() => {
    if (!on || typeof IntersectionObserver === 'undefined') return
    const visible = new Map<string, number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0)
        // Активен самый верхний из видимых разделов.
        const first = list.find((s) => (visible.get(s.id) ?? 0) > 0)
        if (first) setActive(first.id)
      },
      // Верхняя полоса экрана: раздел считается открытым, когда его начало пересекло 140 px от верха.
      { rootMargin: '-140px 0px -55% 0px', threshold: [0, 0.01] },
    )
    for (const s of SHOP_SECTIONS) {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [on, list.map((s) => s.id).join()])
  const go = (id: string) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <nav className="sv-nav" aria-label="Разделы магазина">
      {list.map((s) => (
        <button key={s.id} className={'sv-chip' + (active === s.id ? ' on' : '')} aria-current={active === s.id} data-track={'shop_jump_' + s.id.slice(5)} onClick={() => go(s.id)}>
          <Icon id={s.icon} />
          {s.name}
        </button>
      ))}
    </nav>
  )
}
