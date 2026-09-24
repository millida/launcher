import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon'
import { MrIcon } from './SiteRow'
import { capFirst, categoryIconSrc, fmtNum, loaderIconSrc, loaderLabel, loaderTone } from './site'
import type { SiteFacets, SiteSection } from './site'

/*
 * Колонка фильтров — как на сайте (`mr-filters.tsx`): группы «Версия игры»,
 * «Загрузчик», «Категории» со сворачиванием, пиксельной галочкой и числом
 * материалов; у версий сперва наполненные (от 12 материалов), остальные под
 * «Показать все · N». Версия и загрузчик выбираются по одному, повторное
 * нажатие снимает выбор — поведение галочки на сайте.
 */

const VISIBLE = 10

export interface FilterOpt {
  key: string
  label: string
  count?: number
  active: boolean
  onPick: () => void
  icon?: ReactNode
  tone?: string | null
}

export function FilterGroup({
  title,
  opts,
  split,
  name,
}: {
  title: string
  opts: FilterOpt[]
  split?: number
  /** Машинное имя фильтра для аналитики: filter_<name>. */
  name?: string
}) {
  const [open, setOpen] = useState(true)
  const cut = Math.max(1, Math.min(VISIBLE, split ?? VISIBLE))
  const head = opts.slice(0, cut)
  const tail = opts.slice(cut)
  const [more, setMore] = useState(() => tail.some((o) => o.active))
  if (!opts.length) return null
  return (
    <div className={'card mr-group' + (open ? ' is-open' : '')}>
      <button type="button" className="mr-group-head" aria-expanded={open} data-track={name ? 'filter_' + name + '_group' : undefined} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <Icon id="i-chev-d" />
      </button>
      {open ? (
        <div className="mr-opts">
          {head.map((o) => (
            <Opt key={o.key} o={o} name={name} />
          ))}
          {tail.length && !more ? (
            <button type="button" className="mr-more-btn" data-track={name ? 'filter_' + name + '_more' : undefined} onClick={() => setMore(true)}>
              Показать все · {tail.length}
            </button>
          ) : null}
          {more ? tail.map((o) => <Opt key={o.key} o={o} name={name} />) : null}
        </div>
      ) : null}
    </div>
  )
}

function Opt({ o, name }: { o: FilterOpt; name?: string }) {
  const tone = o.tone ? ({ color: o.tone } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className={'mr-opt' + (o.active ? ' is-on' : '')}
      aria-pressed={o.active}
      data-track={name ? 'filter_' + name : undefined}
      data-id={name ? o.key : undefined}
      onClick={o.onPick}
    >
      <span className={'mr-check' + (o.active ? ' is-on' : '')} aria-hidden="true" />
      <span className="mr-opt-label">
        {o.icon ? (
          <span className="mr-opt-ic" style={tone}>
            {o.icon}
          </span>
        ) : null}
        <span className="mr-opt-name" style={tone}>
          {o.label}
        </span>
      </span>
      {o.count !== undefined ? <span className="mr-opt-cnt">{fmtNum(o.count)}</span> : null}
    </button>
  )
}

export function SiteFilters({
  sec,
  facets,
  version,
  loader,
  category,
  onPatch,
  onReset,
}: {
  sec: SiteSection
  facets: SiteFacets | null
  version: string | null
  loader: string | null
  category: string | null
  onPatch: (p: { version?: string | null; loader?: string | null; category?: string | null }) => void
  onReset: () => void
}) {
  if (!facets) return <FiltersSkeleton />
  const filled = facets.versions.filter((v) => v.count >= 12 || v.value === version)
  const rest = facets.versions.filter((v) => !(v.count >= 12 || v.value === version))
  const versions: FilterOpt[] = [...filled, ...rest].map((v) => ({
    key: v.value,
    label: v.value,
    count: v.count,
    active: version === v.value,
    onPick: () => onPatch({ version: version === v.value ? null : v.value }),
  }))
  const loaders: FilterOpt[] = sec.loaderAxis
    ? facets.loaders.slice(0, 14).map((l) => {
        const src = loaderIconSrc(l.value)
        return {
          key: l.value,
          label: loaderLabel(l.value),
          count: l.count,
          tone: loaderTone(l.value),
          icon: src ? <MrIcon src={src} size={16} /> : null,
          active: loader === l.value,
          onPick: () => onPatch({ loader: loader === l.value ? null : l.value }),
        }
      })
    : []
  const cats: FilterOpt[] = (facets.categories || []).map((c) => {
    const src = categoryIconSrc(c.value)
    return {
      key: c.value,
      label: capFirst(c.value),
      count: c.count,
      icon: src ? <MrIcon src={src} size={16} /> : null,
      active: category === c.value,
      onPick: () => onPatch({ category: category === c.value ? null : c.value }),
    }
  })
  return (
    <div className="mr-filters">
      {version || loader || category ? (
        <button type="button" className="mr-reset" data-track="filter_reset" onClick={onReset}>
          Сбросить фильтры
        </button>
      ) : null}
      <FilterGroup title="Версия игры" name="version" opts={versions} split={filled.length} />
      <FilterGroup title="Загрузчик" name="loader" opts={loaders} />
      <FilterGroup title="Категории" name="category" opts={cats} />
    </div>
  )
}

function FiltersSkeleton() {
  return (
    <div className="mr-filters" aria-hidden="true">
      {[8, 4].map((n, g) => (
        <div key={g} className="card mr-group cat-skel">
          <span className="skel skel-line" style={{ width: '50%', margin: '14px 8px' }}></span>
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className="skel skel-line" style={{ width: 60 + ((i * 29) % 30) + '%', margin: '12px 8px' }}></span>
          ))}
        </div>
      ))}
    </div>
  )
}
