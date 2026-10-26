import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { ARCANIA_VERSION, HEAD } from './content'
import { HeroCast } from './HeroCast'
import { Release } from './Release'
import { Bosses } from './Bosses'
import { Stats } from './Stats'
import { World } from './World'
import { arriveArcania } from './transition'
import type { HeroAction } from './offer'
import './arcania.css'

function withVersion(text: string): ReactNode {
  const [before, after = ''] = text.split('{v}')
  return (
    <>
      {before}
      <span className="arc-ver">{ARCANIA_VERSION}</span>
      {after}
    </>
  )
}

/** The launcher keeps only its own parts here: the buy/install button (cta), key and payment notes (extra). */
export function ArcaniaPage({
  cta,
  extra,
  legacy,
  installed,
  hero,
  onPlay,
  heroEnd,
}: {
  cta: ReactNode
  extra: ReactNode
  legacy: ReactNode
  installed: boolean
  hero: HeroAction
  onPlay: () => void
  heroEnd: React.RefObject<HTMLDivElement | null>
}) {
  const t = useT()
  const ctaRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useEffect(() => arriveArcania(), [])

  // Sections size their frames by the visible scroll area, not the window: the launcher has its own header and panels.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    const scroller = root?.closest('.content')
    if (!root || !scroller) return
    const ro = new ResizeObserver(() => root.style.setProperty('--avail', scroller.clientHeight + 'px'))
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [])

  const play = () => {
    if (hero === 'play') return onPlay()
    const install = hero === 'install' ? ctaRef.current?.querySelector<HTMLButtonElement>('[data-hero-install] button') : null
    if (install) return install.click()
    const key = headRef.current?.querySelector<HTMLInputElement>('.pkb-key input')
    const target = key ?? ctaRef.current
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    key?.focus({ preventScroll: true })
  }

  return (
    <div className="arc" ref={rootRef}>
      <HeroCast installed={installed} onPlay={play} />

      <div className="arc-head" ref={headRef}>
        <h1>{withVersion(t('ARCANIA {v} вышла'))}</h1>
        <p>{t(HEAD.lead)}</p>
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
        <h2>{withVersion(t('Твоё приключение в ARCANIA {v} начинается'))}</h2>
        <div className="arc-cta">{cta}</div>
        <div className="arc-legacy">{legacy}</div>
      </div>
    </div>
  )
}
