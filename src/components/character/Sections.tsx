import { PxIcon } from '../PxIcon'

/**
 * Навигация гардероба — два уровня, не больше (Roblox, Essential, Fortnite:
 * 2026-09-23_wardrobe-research.md). Сверху крупные разделы с одноцветным
 * пиксельным значком, как в Essential Mod, под ними подкатегории чипами.
 * Раньше было девятнадцать вкладок по местам на теле, и понять, где что, было
 * нельзя (владелец 23.09.2026).
 */
export interface Section {
  key: string
  name: string
  /** Пиксельный значок раздела из `pxArt.ts` (`ws-*`). */
  icon: string
  /** В разделе ждёт действие: награда, которую можно забрать. */
  alert?: boolean
}

export function SectionBar({
  sections,
  active,
  onPick,
}: {
  sections: Section[]
  active: string
  onPick: (key: string) => void
}) {
  return (
    <div className="ch-secs" role="tablist" aria-label="Разделы гардероба">
      {sections.map((s) => (
        <button
          key={s.key}
          role="tab"
          aria-selected={s.key === active}
          className={'ch-slot' + (s.key === active ? ' on' : '')}
          data-track={'wardrobe_tab_' + s.key}
          onClick={() => onPick(s.key)}
        >
          <span className="ch-slot-art">
            <PxIcon name={s.icon} className="ch-slot-px" />
            {s.alert ? <i className="ch-slot-alert" aria-label="Есть награда" /> : null}
          </span>
          <span className="ch-slot-name">{s.name}</span>
        </button>
      ))}
    </div>
  )
}

export interface Chip {
  key: string
  name: string
  count?: number
}

export function ChipRow({
  chips,
  active,
  onPick,
}: {
  chips: Chip[]
  active: string
  onPick: (key: string) => void
}) {
  if (chips.length < 2) return null
  return (
    <div className="segs ch-chips" role="tablist">
      {chips.map((c) => (
        <button
          key={c.key}
          role="tab"
          aria-selected={c.key === active}
          className={'seg' + (c.key === active ? ' on' : '')}
          data-track={'wardrobe_chip_' + c.key}
          onClick={() => onPick(c.key)}
        >
          {c.name}
          {c.count ? <small>{c.count}</small> : null}
        </button>
      ))}
    </div>
  )
}
