import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { openExt } from '../../lib/api'
import { CHAPTER, FAQ, HERO, ICONS, LINKS, LOBBY, PERKS, ROUTE, TRAILER, clip, type Tile } from './content'
import './abonent.css'

const CHECK = 'M5 12.5l4.5 4.5L19 7.5'
const PLAY = 'M8 5.5v13l11-6.5z'
const ARROW = 'M5 12h13m-5-6l6 6-6 6'
const DISCORD =
  'M19.3 5.3A17 17 0 0 0 15 4l-.5 1.1a15.6 15.6 0 0 0-5 0L9 4a17 17 0 0 0-4.3 1.3C2 9.4 1.3 13.3 1.6 17.2A17 17 0 0 0 6.9 20l1.1-1.8c-.6-.2-1.2-.5-1.7-.9l.4-.3a12 12 0 0 0 10.6 0l.4.3c-.5.4-1.1.7-1.7.9L17.1 20a17 17 0 0 0 5.3-2.8c.4-4.6-.8-8.4-3.1-11.9zM8.5 14.8c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2zm7 0c-1 0-1.9-1-1.9-2.2s.8-2.2 1.9-2.2 1.9 1 1.9 2.2-.8 2.2-1.9 2.2z'
const TELEGRAM = 'M21.5 4.3L2.8 11.5c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.5zM9.7 14.6l-.4 4 -1.4-4.6 10.6-6.7z'

function Glyph({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

function Loop({ name }: { name: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const { video, poster } = clip(name)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void el.play().catch(() => undefined)
        else el.pause()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <video ref={ref} src={video} poster={poster} muted loop playsInline preload="none" aria-hidden="true" />
}

function Frames({ tiles, kind }: { tiles: Tile[]; kind: 'grid' | 'trio' | 'quad' }) {
  const t = useT()
  return (
    <div className={'abp-' + kind}>
      {tiles.map((tile) => (
        <div key={tile.name} className="abp-frame">
          <Loop name={tile.name} />
          <span className="abp-label">{t(tile.title)}</span>
        </div>
      ))}
    </div>
  )
}

function Head({ eyebrow, title, sub }: { eyebrow: ReactNode; title: string; sub?: string }) {
  const t = useT()
  return (
    <header className="abp-head">
      <span className="abp-eyebrow">{eyebrow}</span>
      <h2 className="abp-h2">{t(title)}</h2>
      {sub ? <p className="abp-sub">{t(sub)}</p> : null}
    </header>
  )
}

function Trailer() {
  const t = useT()
  const [on, setOn] = useState(false)
  return (
    <div className="abp-trailer">
      <div className="abp-frame">
        {on ? (
          <video src={TRAILER.video} poster={TRAILER.poster} controls autoPlay playsInline />
        ) : (
          <button type="button" className="abp-trailer-cover" data-track="abonent_trailer" aria-label={t('Смотреть трейлер') + ', 0:50'} onClick={() => setOn(true)}>
            <img src={TRAILER.poster} alt="" loading="lazy" draggable={false} />
            <span className="abp-play">
              <Glyph d={PLAY} fill />
            </span>
            <span className="abp-label">{t('Смотреть трейлер') + ' · 0:50'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

function Faq() {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="abp-faq">
      {FAQ.map((f, i) => (
        <div key={f.q} className={'abp-faq-item' + (f.friends ? ' is-friends' : '')}>
          <button type="button" className="abp-faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {t(f.q)}
          </button>
          <div className="abp-faq-a" data-open={open === i ? '' : undefined}>
            <div>
              <p>{t(f.a)}</p>
              {f.friends ? (
                <button type="button" className="abp-btn" onClick={() => openExt(LINKS.discord)}>
                  {t('Найти напарника')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The Abonent page from arcania.fun, rebuilt for the launcher. Only the buy, install and play controls are the
 * launcher's own: they arrive as cta, and the key field as extra.
 */
export function AbonentPage({
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
  heroEnd: React.RefObject<HTMLDivElement | null>
}) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const accessRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const scroller = root?.closest('.content') as HTMLElement | null
    if (!root || !scroller) return
    const ro = new ResizeObserver(() => root.style.setProperty('--abp-hero-h', scroller.clientHeight + 'px'))
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [])

  const start = () => {
    if (installed) return onPlay()
    accessRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="abp" ref={rootRef}>
      <section className="abp-hero">
        <video className="abp-cover abp-hero-video" src={HERO.video} poster={HERO.poster} muted loop playsInline autoPlay aria-hidden="true" />
        <div className="abp-hero-shade" />
        <div className="abp-hero-copy">
          <span className="abp-kind">{t('Хоррор-сборка Minecraft')}</span>
          <h1 className="abp-title">
            {t('Абонент')}
            <span>{t('вышел')}</span>
          </h1>
          <p className="abp-lede">{t('Припять, май 1986. В брошенной квартире звонит телефон.')}</p>
          <div className="abp-start">
            <button type="button" className="abp-btn" data-track="abonent_start" onClick={start}>
              {installed ? t('Играть') : t('Начать играть')}
            </button>
          </div>
          <ul className="abp-facts">
            <li>
              <span className="abp-fact-flag" aria-hidden="true" />
              {t('Полная русская озвучка')}
            </li>
            <li>
              <img className="abp-fact-icon" src={ICONS.coop} alt="" />
              {t('От 1 до 4 игроков, голосовой чат встроен')}
            </li>
            <li>
              <img className="abp-fact-icon" src={ICONS.own} alt="" />
              {t('Полностью самописная сборка')}
            </li>
          </ul>
        </div>
      </section>
      <div ref={heroEnd} className="pp-hero-end" aria-hidden="true" />

      <section className="abp-section">
        <Head eyebrow={t('Лобби')} title="Мини-игры, пока все собираются" />
        <Frames tiles={LOBBY} kind="grid" />
      </section>

      <section className="abp-section">
        <Head eyebrow={t('Глава первая')} title="Полное погружение" sub="Квартиры и подъезды проработаны до мелочей, каждую дверь можно открыть." />
        <Frames tiles={CHAPTER} kind="trio" />
      </section>

      <section className="abp-section">
        <Head eyebrow={t('Маршрут')} title="Дорога к станции" />
        <Frames tiles={ROUTE} kind="quad" />
      </section>

      <section className="abp-section">
        <Head eyebrow={t('Трейлер')} title="Трейлер сборки" />
        <Trailer />
      </section>

      <section className="abp-section">
        <Head eyebrow={t('Вопросы')} title="Коротко о главном" />
        <Faq />
      </section>

      <section className="abp-section">
        <Head
          eyebrow={
            <>
              05<i />
              {t('Доступ')}
            </>
          }
          title="Двигайся с нами"
          sub="Подписка открывает сборку и лаунчер. А в Discord — живое сообщество: напарники, голосовые комнаты и новости раньше всех."
        />
        <div className="abp-access" ref={accessRef}>
          <div>
            <span className="abp-access-brand">
              <img src={ICONS.sign} alt="" />
              {t('Подписка «Абонент»')}
            </span>
            <h3>{t('Приобрети доступ к проекту')}</h3>
            <p>{t('Доступ к сборке открывается сразу после оплаты, сборка ставится и обновляется прямо в лаунчере.')}</p>
            <ul className="abp-perks">
              {PERKS.map((p) => (
                <li key={p}>
                  <Glyph d={CHECK} />
                  {t(p)}
                </li>
              ))}
            </ul>
          </div>
          <div className="abp-buy ci-cta">{cta}</div>
        </div>
        <div className="abp-extra">{extra}</div>
        <div className="abp-social">
          <button type="button" className="abp-social-card" data-track="abonent_discord" onClick={() => openExt(LINKS.discord)}>
            <span className="abp-social-top">
              <Glyph d={DISCORD} fill />
              {t('Сообщество игроков в моды')}
            </span>
            <b>{t('Найди напарника для игры')}</b>
            <span className="abp-social-go">
              {t('Зайти в Discord')}
              <Glyph d={ARROW} />
            </span>
          </button>
          <button type="button" className="abp-social-card is-telegram" data-track="abonent_telegram" onClick={() => openExt(LINKS.telegram)}>
            <span className="abp-social-top">
              <Glyph d={TELEGRAM} fill />
              {t('Анонсы и ивенты')}
            </span>
            <b>{t('Новости в Telegram')}</b>
            <span className="abp-social-go">
              {t('Подписаться')}
              <Glyph d={ARROW} />
            </span>
          </button>
        </div>
      </section>
    </div>
  )
}
