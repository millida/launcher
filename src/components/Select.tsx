import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { usePopover } from '../lib/popover'

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
      {pop.mounted ? (
        <div className={'m-select-pop' + (align === 'right' ? ' right' : '') + (pop.closing ? ' closing' : '')}>
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
      ) : null}
    </div>
  )
}
