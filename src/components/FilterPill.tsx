import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface PillOption {
  value: string
  label: string
}

export function FilterPill({
  icon,
  label,
  options,
  value,
  values,
  onPick,
  onToggle,
  multi,
  defaultValue,
  align = 'left',
  width = 200,
}: {
  icon?: string
  label: string
  options: PillOption[]
  value?: string
  values?: string[]
  onPick?: (v: string) => void
  onToggle?: (v: string) => void
  multi?: boolean
  defaultValue?: string
  align?: 'left' | 'right'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = options.find((o) => o.value === value)
  const nSel = values ? values.length : 0
  const active = multi ? nSel > 0 : defaultValue !== undefined && value !== defaultValue
  const trigger = multi ? label + (nSel ? ' · ' + nSel : '') : cur ? cur.label : label

  return (
    <div className="mk-pill-wrap" ref={ref}>
      <button
        type="button"
        className={'mk-pill' + (active ? ' is-active' : '') + (open ? ' open' : '')}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ? <Icon id={icon} /> : null}
        <span>{trigger}</span>
        <Icon id="i-chev-d" className="mk-chev-inline" />
      </button>
      {open ? (
        <div className={'mk-menu' + (align === 'right' ? ' end' : '')} style={{ minWidth: width + 'px' }}>
          {options.map((o) => {
            const on = multi ? (values || []).includes(o.value) : o.value === value
            return (
              <button
                key={o.value}
                type="button"
                className={'mk-menu-opt' + (on ? ' on' : '')}
                onClick={() => {
                  if (multi) onToggle && onToggle(o.value)
                  else {
                    onPick && onPick(o.value)
                    setOpen(false)
                  }
                }}
              >
                {multi ? <span className={'mk-check' + (on ? ' on' : '')}>{on ? <Icon id="i-check" /> : null}</span> : null}
                <span className="mk-menu-lab">{o.label}</span>
                {!multi && on ? <Icon id="i-check" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
