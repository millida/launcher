import { useEffect, useRef, type ReactNode } from 'react'
import { HEAD } from './content'
import { HeroCast } from './HeroCast'
import { Release } from './Release'
import { Bosses } from './Bosses'
import { Stats } from './Stats'
import { World } from './World'
import { arriveArcania } from './transition'
import './arcania.css'

/**
 * Страница Arcania 2.0 в лаунчере — ужатый arcania.fun: ряд героев, «что нового»,
 * боссы и кнопка ещё раз внизу (владелец 22.10.2026). Старой страницы сборки (описание,
 * галерея, версии) здесь нет. Своё у лаунчера — только кнопка покупки/установки (cta)
 * и служебное под ней (extra: ключ, ожидание оплаты).
 */
export function ArcaniaPage({
  cta,
  extra,
  installed,
  onPlay,
  heroEnd,
}: {
  cta: ReactNode
  extra: ReactNode
  installed: boolean
  onPlay: () => void
  /** Метка низа шапки: ушла за верх окна — появляется липкая полоса с кнопкой. */
  heroEnd: React.RefObject<HTMLDivElement | null>
}) {
  const ctaRef = useRef<HTMLDivElement>(null)

  // Страница нарисована — растворяем пиксельное покрытие перехода.
  useEffect(() => arriveArcania(), [])

  // Высота видимой области прокрутки (а не окна: у лаунчера своя шапка и панели) — в --avail.
  // По ней кадры секций ужимаются так, чтобы секция помещалась в экран целиком.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    const scroller = root?.closest('.content')
    if (!root || !scroller) return
    const ro = new ResizeObserver(() => root.style.setProperty('--avail', scroller.clientHeight + 'px'))
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [])

  // Центральная карта делает то же, что главная кнопка: играть, установить или купить.
  const play = () => {
    if (installed) return onPlay()
    const btn = ctaRef.current?.querySelector('button')
    if (btn) btn.click()
    else ctaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="arc" ref={rootRef}>
      <HeroCast installed={installed} onPlay={play} />

      <div className="arc-head">
        <h1>
          {HEAD.title} <span className="arc-ver">{HEAD.version}</span> {HEAD.released}
        </h1>
        <p>{HEAD.lead}</p>
        <div className="ci-cta arc-cta" ref={ctaRef}>
          {cta}
        </div>
        {extra}
      </div>
      <div ref={heroEnd} className="pp-hero-end" aria-hidden="true" />

      <Release />
      <Stats />
      <Bosses />
      <World />

      <div className="arc-final">
        <h2>
          Твоё приключение в {HEAD.title} <span className="arc-ver">{HEAD.version}</span> начинается
        </h2>
        <div className="arc-cta">{cta}</div>
      </div>
    </div>
  )
}
