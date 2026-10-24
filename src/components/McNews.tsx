import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { minecraftNews, openUrl, type McNews } from '../ipc/commands'
import { backdropClose } from '../lib/dismiss'
import { coreErrorText } from '../lib/coreErrors'
import { useLocale, useT } from '../i18n'
import '../styles/pixel/mcnews.css'

export const useMcNews = create<{ open: boolean }>(() => ({ open: false }))
export const openMcNews = () => useMcNews.setState({ open: true })

type Load = { state: 'loading' } | { state: 'error'; text: string } | { state: 'ready'; items: McNews[] }

function newsDate(raw: string, locale: string): string {
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

export function McNewsModal() {
  const t = useT()
  const locale = useLocale()
  const open = useMcNews((s) => s.open)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const seq = useRef(0)

  const fetchNews = () => {
    const mine = ++seq.current
    setLoad({ state: 'loading' })
    minecraftNews()
      .then((items) => {
        if (mine === seq.current) setLoad({ state: 'ready', items })
      })
      .catch((e) => {
        if (mine === seq.current) setLoad({ state: 'error', text: coreErrorText(e) })
      })
  }

  useEffect(() => {
    if (open && hasTauri()) fetchNews()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useMcNews.setState({ open: false })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const close = () => useMcNews.setState({ open: false })

  return (
    <div className="modal-bg open vis" style={{ zIndex: 960 }} {...backdropClose(close)}>
      <div className="modal mw-md mcnews" role="dialog" aria-modal="true" aria-label={t('Новости Minecraft')}>
        <h3>{t('Новости Minecraft')}</h3>
        {!hasTauri() ? (
          <div className="mcnews-state">{t('Доступно в приложении')}</div>
        ) : load.state === 'loading' ? (
          <div className="mcnews-list" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="mcnews-card skel" />
            ))}
          </div>
        ) : load.state === 'error' ? (
          <div className="mcnews-state">
            <span>{t('Новости не загрузились: {error}', { error: load.text })}</span>
            <button className="btn sm secondary" onClick={fetchNews}>
              {t('Повторить')}
            </button>
          </div>
        ) : load.items.length ? (
          <div className="mcnews-list">
            {load.items.map((n) => (
              <article key={n.id} className="mcnews-card">
                {n.image ? <img className="mcnews-img" src={n.image} alt="" loading="lazy" /> : null}
                <div className="mcnews-body">
                  <div className="mcnews-date">{newsDate(n.date, locale)}</div>
                  <b className="mcnews-title">{n.title}</b>
                  {n.text ? <p className="mcnews-text">{n.text}</p> : null}
                  {n.link ? (
                    <button className="btn sm secondary" onClick={() => void openUrl(n.link!)}>
                      {t('Читать')}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mcnews-state">{t('Новостей пока нет')}</div>
        )}
      </div>
    </div>
  )
}
