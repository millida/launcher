import { useRef } from 'react'
import { PxIcon } from '../PxIcon'
import type { HubTab } from './hubTab'

/**
 * Переключатель вкладок хаба «Каталог / Мои сборки» — как выбор режима в Brawl Stars:
 * тёмный жёлоб, по нему ездит плотная зелёная плашка с подошвой. Переезд —
 * шагами (steps), значок выбранной вкладки подпрыгивает. Стрелки ←/→ на
 * клавиатуре тоже переключают.
 */
const DEFAULT_TABS: { id: HubTab; label: string; icon: string }[] = [
  { id: 'catalog', label: 'Каталог', icon: 'book' },
  { id: 'builds', label: 'Мои сборки', icon: 'chest' },
]

export function HubSwitch<T extends string = HubTab>({
  tab,
  onTab,
  tabs,
}: {
  tab: T
  onTab: (t: T) => void
  /** Свои вкладки; по умолчанию — прежние «Каталог / Мои сборки». */
  tabs?: { id: T; label: string; icon: string }[]
}) {
  const TABS = (tabs || DEFAULT_TABS) as { id: T; label: string; icon: string }[]
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const i = TABS.findIndex((t) => t.id === tab)
  return (
    <div className="hub-sw-wrap">
      <div className={'ph-card hub-sw n' + TABS.length + ' at-' + i} role="tablist" aria-label="Во что играем">
        <span className="btn primary hub-sw-thumb" aria-hidden="true"></span>
        {TABS.map((t, k) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[k] = el
            }}
            role="tab"
            id={'hub-tab-' + t.id}
            aria-selected={tab === t.id}
            aria-controls={'hub-pane-' + t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className={'hub-sw-btn' + (tab === t.id ? ' on' : '')}
            data-sound="nav"
            data-track={'hub_tab_' + t.id}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const n = (k + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
              onTab(TABS[n]!.id)
              refs.current[n]?.focus()
            }}
          >
            {/* key по вкладке: при каждом выборе значок заново подпрыгивает */}
            <PxIcon key={tab === t.id ? 'on' : 'off'} name={t.icon} size={24} className="px-icon hub-sw-ic" />
            <span className="hub-sw-lab">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
