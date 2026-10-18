import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { AVAILABLE_LOCALES, localeInfo, setLocale, useLocale, useT, type Locale } from '../i18n'

const GAP = 6
const EDGE = 8
const TYPEAHEAD_RESET_MS = 700

/// The sign-in form is cut by a pixel clip-path, so the list lives in a portal on body.
export function LangPicker({ className = '', variant = 'corner' }: { className?: string; variant?: 'corner' | 'field' }) {
  const t = useT()
  const locale = useLocale()
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(0)
  const headingId = useId()
  const popId = useId()

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setPos(null)
    if (refocus) button.current?.focus()
  }, [])

  const focusAt = useCallback((index: number) => {
    const count = AVAILABLE_LOCALES.length
    const next = ((index % count) + count) % count
    setActive(next)
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = button.current?.getBoundingClientRect()
      const box = pop.current?.getBoundingClientRect()
      if (!anchor || !box) return
      const below = window.innerHeight - anchor.bottom - GAP - EDGE
      const up = below < box.height && anchor.top - GAP - EDGE > below
      const top = up ? anchor.top - GAP - box.height : anchor.bottom + GAP
      setPos({
        left: Math.max(EDGE, Math.min(anchor.right - box.width, window.innerWidth - box.width - EDGE)),
        top: Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, { passive: true, capture: true })
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, { capture: true })
    }
  }, [open])

  const placed = pos !== null
  useEffect(() => {
    if (open && placed) focusAt(Math.max(0, AVAILABLE_LOCALES.findIndex((l) => l.code === locale)))
  }, [open, placed, locale, focusAt])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!pop.current?.contains(target) && !button.current?.contains(target)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, close])

  const pick = (code: Locale) => {
    close(true)
    if (code !== locale) void setLocale(code)
  }

  const onListKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusAt(active + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusAt(active - 1)
        return
      case 'Home':
      case 'PageUp':
        e.preventDefault()
        focusAt(0)
        return
      case 'End':
      case 'PageDown':
        e.preventDefault()
        focusAt(AVAILABLE_LOCALES.length - 1)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(AVAILABLE_LOCALES[active]?.code ?? locale)
        return
      case 'Escape':
        e.preventDefault()
        // Settings closes on Escape too; only the list should close here.
        e.nativeEvent.stopImmediatePropagation()
        e.stopPropagation()
        close(true)
        return
      case 'Tab':
        close(false)
        return
    }
    if (e.key.length !== 1 || e.altKey || e.ctrlKey || e.metaKey) return
    const now = Date.now()
    const text = (now - typed.current.at > TYPEAHEAD_RESET_MS ? '' : typed.current.text) + e.key.toLowerCase()
    typed.current = { text, at: now }
    const match = AVAILABLE_LOCALES.findIndex(
      (l) => l.native.toLowerCase().startsWith(text) || l.english.toLowerCase().startsWith(text),
    )
    if (match >= 0) focusAt(match)
  }

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    e.preventDefault()
    setOpen(true)
  }

  const current = localeInfo(locale)

  return (
    <>
      <button
        ref={button}
        type="button"
        className={(variant === 'field' ? 'm-select-btn' + (open ? ' open' : '') : 'btn sm ghost') + ' lang-pick lang-pick-' + variant + (className ? ' ' + className : '')}
        aria-label={t('Язык') + ': ' + current.native}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-track={variant === 'field' ? 'settings_lang' : 'login_lang'}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKey}
      >
        <Icon id="i-globe" />
        <span className="lang-pick-name" lang={current.code} dir={current.rtl ? 'rtl' : 'ltr'}>
          {current.native}
        </span>
        <Icon id="i-chev-d" className="icon lang-pick-chev" />
      </button>
      {open
        ? createPortal(
            <div
              ref={pop}
              id={popId}
              className="mk-menu lang-pop"
              style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
            >
              <div id={headingId} className="lang-pop-cap">
                {t('Язык интерфейса')}
              </div>
              <ul ref={list} role="listbox" aria-labelledby={headingId} className="lang-pop-list" onKeyDown={onListKey}>
                {AVAILABLE_LOCALES.map((l, index) => {
                  const selected = l.code === locale
                  return (
                    <li
                      key={l.code}
                      role="option"
                      aria-selected={selected}
                      tabIndex={index === active ? 0 : -1}
                      className="lang-pop-opt"
                      onClick={() => pick(l.code)}
                      onFocus={() => setActive(index)}
                    >
                      <span className="lang-pop-names">
                        <span className="lang-pop-native" lang={l.code} dir={l.rtl ? 'rtl' : 'ltr'}>
                          {l.native}
                        </span>
                        {l.english !== l.native ? <span className="lang-pop-english">{l.english}</span> : null}
                      </span>
                      <Icon id="i-check" className="icon lang-pop-check" />
                    </li>
                  )
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
