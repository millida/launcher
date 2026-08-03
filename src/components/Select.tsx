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
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  width?: number | string
  disabled?: boolean
  placeholder?: string
  align?: 'left' | 'right'
}) {
  const pop = usePopover<HTMLDivElement>()
  const cur = options.find((o) => o.value === value)

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
          {options.map((o) => (
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
        </div>
      ) : null}
    </div>
  )
}
