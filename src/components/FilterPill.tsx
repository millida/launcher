import { Icon } from './Icon'
import { cap } from '../lib/format'
import { usePopover } from '../lib/popover'

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
  track,
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
  /** Машинное имя фильтра для аналитики кликов: filter_<track>. */
  track?: string
}) {
  const pop = usePopover<HTMLDivElement>()

  const cur = options.find((o) => o.value === value)
  const nSel = values ? values.length : 0
  const active = multi ? nSel > 0 : defaultValue !== undefined && value !== defaultValue
  // Untouched filters name the facet ("Загрузчик"), not their catch-all value
  // ("любой"), which said nothing about what the pill even filters.
  const showsValue = !!cur && (defaultValue === undefined || active)
  const trigger = multi ? label : showsValue ? cap(cur!.label) : label

  return (
    <div className="mk-pill-wrap" ref={pop.ref}>
      <button
        type="button"
        className={'mk-pill' + (active ? ' is-active' : '') + (pop.open ? ' open' : '')}
        aria-expanded={pop.open}
        aria-label={label}
        data-track={track ? 'filter_' + track : undefined}
        onClick={pop.toggle}
      >
        {icon ? <Icon id={icon} /> : null}
        <span>{trigger}</span>
        {multi && nSel ? <span className="cat-pill-n">{nSel}</span> : null}
        <Icon id="i-chev-d" className="mk-chev-inline" />
      </button>
      {pop.mounted ? (
        <div
          className={'mk-menu' + (align === 'right' ? ' end' : '') + (pop.closing ? ' closing' : '')}
          style={{ minWidth: width + 'px' }}
        >
          {options.map((o) => {
            const on = multi ? (values || []).includes(o.value) : o.value === value
            return (
              <button
                key={o.value}
                type="button"
                className={'mk-menu-opt' + (on ? ' on' : '')}
                data-track={track ? 'filter_' + track + '_opt' : undefined}
                data-id={track ? o.value : undefined}
                onClick={() => {
                  if (multi) onToggle && onToggle(o.value)
                  else {
                    onPick && onPick(o.value)
                    pop.close()
                  }
                }}
              >
                {multi ? <span className={'mk-check' + (on ? ' on' : '')}>{on ? <Icon id="i-check" /> : null}</span> : null}
                <span className="mk-menu-lab">{cap(o.label)}</span>
                {!multi && on ? <Icon id="i-check" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
