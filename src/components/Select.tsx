import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { usePopover } from '../lib/popover'

export interface SelectOption {
  value: string
  label: string
  sub?: string
}

const GAP = 6
const EDGE = 12
const MAX_H = 320

interface PopPlace {
  top?: number
  bottom?: number
  left: number
  right: number
  minWidth: number
  maxHeight: number
}

function place(btn: HTMLElement, panel: HTMLElement | null): PopPlace {
  const r = btn.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  const wanted = Math.min(MAX_H, panel ? panel.scrollHeight : MAX_H)
  const up = below < wanted && above > below
  const maxHeight = Math.max(120, Math.min(MAX_H, up ? above : below))
  const width = Math.max(panel ? panel.offsetWidth : 0, r.width)
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - width))
  const right = Math.max(EDGE, Math.min(window.innerWidth - r.right, window.innerWidth - EDGE - width))
  return {
    top: up ? undefined : r.bottom + GAP,
    bottom: up ? window.innerHeight - r.top + GAP : undefined,
    left,
    right,
    minWidth: r.width,
    maxHeight,
  }
}

/// Custom dropdown instead of the native <select> OS picker.
export function Select({
  value,
  options,
  onChange,
  width,
  disabled,
  placeholder,
  align = 'left',
  search,
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  width?: number | string
  disabled?: boolean
  placeholder?: string
  align?: 'left' | 'right'
  /// Long lists (game versions, loader builds) are unusable by scrolling alone.
  search?: boolean
}) {
  const pop = usePopover<HTMLDivElement>()
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<PopPlace | null>(null)
  const cur = options.find((o) => o.value === value)
  const searchable = !!search && options.length > 8
  useEffect(() => {
    if (!pop.open) setQ('')
  }, [pop.open])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!searchable || !needle) return options
    return options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
  }, [options, q, searchable])

  // The panel lives in a portal: inside the card it was drawn under the cards
  // that follow and clipped by the scrolling content, so most of a long version
  // list could not be reached at all.
  useLayoutEffect(() => {
    if (!pop.open) return
    const btn = pop.ref.current
    if (!btn) return
    const measure = () => setPos(place(btn, pop.panelRef.current))
    measure()
    const onScroll = () => measure()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [pop.open, shown.length])

  const panel = pop.mounted ? (
    <div
      ref={pop.panelRef as React.RefObject<HTMLDivElement>}
      className={'m-select-pop' + (pop.closing ? ' closing' : '')}
      style={
        pos
          ? {
              top: pos.top,
              bottom: pos.bottom,
              left: align === 'right' ? undefined : pos.left,
              right: align === 'right' ? pos.right : undefined,
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }
          : { visibility: 'hidden' }
      }
    >
      {searchable ? (
        <div className="m-select-search">
          <Icon id="i-search" />
          <input
            autoFocus
            value={q}
            placeholder="Поиск"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !shown.length) return
              onChange(shown[0].value)
              pop.close()
            }}
          />
        </div>
      ) : null}
      {shown.map((o) => (
        <button
          key={o.value}
          type="button"
          className={'m-select-opt' + (o.value === value ? ' on' : '')}
          onClick={() => {
            onChange(o.value)
            pop.close()
          }}
        >
          <span className="m-select-opt-body">
            <span className="m-select-opt-lab">{o.label}</span>
            {o.sub ? <span className="m-select-opt-sub">{o.sub}</span> : null}
          </span>
          {o.value === value ? <Icon id="i-check" /> : null}
        </button>
      ))}
      {searchable && !shown.length ? <p className="m-select-empty">Ничего не нашлось</p> : null}
    </div>
  ) : null

  return (
    <div className="m-select" ref={pop.ref} style={{ width }}>
      <button
        type="button"
        className={'m-select-btn' + (pop.open ? ' open' : '')}
        disabled={disabled}
        onClick={pop.toggle}
      >
        <span className="m-select-val">{cur ? cur.label : placeholder || '—'}</span>
        <Icon id="i-chev-d" />
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
