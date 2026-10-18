import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { AVAILABLE_LOCALES, setLocale, useLocale, useT } from '../i18n'

const MENU_GAP = 6
const EDGE = 8

/// The sign-in form is cut by a pixel clip-path, so the menu lives in a portal on body.
export function LangPicker({ className = '' }: { className?: string }) {
  const t = useT()
  const locale = useLocale()
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    if (!open) return
    const anchor = button.current?.getBoundingClientRect()
    const box = menu.current?.getBoundingClientRect()
    if (!anchor || !box) return
    setPos({
      left: Math.max(EDGE, Math.min(anchor.right - box.width, window.innerWidth - box.width - EDGE)),
      top: Math.min(anchor.bottom + MENU_GAP, window.innerHeight - box.height - EDGE),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        type="button"
        className={'btn sm ghost lang-pick ' + className}
        aria-label={t('Язык')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-track="login_lang"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon id="i-globe" />
        <span>{locale.toUpperCase()}</span>
      </button>
      {open
        ? createPortal(
            <div ref={menu} className="ctx-menu lang-menu" role="menu" aria-label={t('Язык')} style={pos}>
              {AVAILABLE_LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.code === locale}
                  lang={l.code}
                  dir={l.rtl ? 'rtl' : 'ltr'}
                  className={'msg-menu-item' + (l.code === locale ? ' on' : '')}
                  onClick={() => {
                    setOpen(false)
                    void setLocale(l.code)
                  }}
                >
                  <span className="lang-menu-name">{l.native}</span>
                  {l.code === locale ? <Icon id="i-check" /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
