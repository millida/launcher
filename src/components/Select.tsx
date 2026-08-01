import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
  sub?: string
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
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  width?: number | string
  disabled?: boolean
  placeholder?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="m-select" ref={ref} style={{ width }}>
      <button
        type="button"
        className={'m-select-btn' + (open ? ' open' : '')}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="m-select-val">{cur ? cur.label : placeholder || '—'}</span>
        <Icon id="i-chev-d" />
      </button>
      {open ? (
        <div className={'m-select-pop' + (align === 'right' ? ' right' : '')}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={'m-select-opt' + (o.value === value ? ' on' : '')}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="m-select-opt-body">
                <span className="m-select-opt-lab">{o.label}</span>
                {o.sub ? <span className="m-select-opt-sub">{o.sub}</span> : null}
              </span>
              {o.value === value ? <Icon id="i-check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
