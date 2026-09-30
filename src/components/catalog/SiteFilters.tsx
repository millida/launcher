import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon'
import { MrIcon } from './SiteRow'
import { capFirst, categoryIconSrc, fmtNum, loaderIconSrc, loaderLabel, loaderTone } from './site'
import type { SiteFacets, SiteSection } from './site'
import type { SiteAccess } from './siteStore'
import type { EditionFilter, PriceFilter } from './sections'

/*
 * Колонка фильтров — как на сайте (`mr-filters.tsx`): группы «Версия игры»,
 * «Загрузчик», «Категории» со сворачиванием, пиксельной галочкой и числом
 * материалов; у версий сперва видны наполненные (от 12 материалов), «Показать
 * все · N» раскрывает весь список в порядке версий. Версия и загрузчик
 * выбираются по одному, повторное нажатие снимает выбор — поведение галочки
 * на сайте.
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
  lead,
  name,
}: {
  title: string
  opts: FilterOpt[]
  lead?: (o: FilterOpt) => boolean
  /** Машинное имя фильтра для аналитики: filter_<name>. */
  name?: string
}) {
  const [open, setOpen] = useState(true)
  const head = (lead ? opts.filter(lead) : opts).slice(0, VISIBLE)
  const shown = head.length ? head : opts.slice(0, 1)
  const hidden = opts.length - shown.length
  const [more, setMore] = useState(() => opts.some((o) => o.active && !shown.includes(o)))
  if (!opts.length) return null
  return (
    <div className={'card mr-group' + (open ? ' is-open' : '')}>
      <button type="button" className="mr-group-head" aria-expanded={open} data-track={name ? 'filter_' + name + '_group' : undefined} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <Icon id="i-chev-d" />
      </button>
      {open ? (
        <div className="mr-opts">
          {(more ? opts : shown).map((o) => (
            <Opt key={o.key} o={o} name={name} />
          ))}
          {hidden && !more ? (
            <button type="button" className="mr-more-btn" data-track={name ? 'filter_' + name + '_more' : undefined} onClick={() => setMore(true)}>
              Показать все · {hidden}
            </button>
          ) : null}
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

const EDITIONS: [EditionFilter, string][] = [
  ['JAVA', 'Java'],
]

const PRICES: [PriceFilter, string][] = [
  ['free', 'Бесплатно'],
  ['paid', 'Платно'],
]

const ACCESS: [Exclude<SiteAccess, 'all'>, string][] = [
  ['premium', 'Премиум'],
  ['free', 'Обычные'],
]

export function SiteFilters({
  sec,
  facets,
  version,
  loader,
  category,
  access,
  edition = null,
  use = null,
  price = null,
  onPatch,
  onReset,
}: {
  sec: SiteSection
  facets: SiteFacets | null
  version: string | null
  loader: string | null
  category: string | null
  /** Только у сборок: премиум-сборки Millida или обычные. Фильтр, а не полоса над карточками (владелец 29.09.2026). */
  access?: SiteAccess
  /** Издание, «Для чего», цена — колонки фильтров сайта (30.09.2026). */
  edition?: EditionFilter | null
  use?: string | null
  price?: PriceFilter | null
  onPatch: (p: {
    version?: string | null
    loader?: string | null
    category?: string | null
    access?: SiteAccess
    edition?: EditionFilter | null
    use?: string | null
    price?: PriceFilter | null
  }) => void
  onReset: () => void
}) {
  if (!facets) return <FiltersSkeleton />
  const filled = new Set(facets.versions.filter((v) => v.count >= 12 || v.value === version).map((v) => v.value))
  const versions: FilterOpt[] = facets.versions.map((v) => ({
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
  const accessOpts: FilterOpt[] = access
    ? ACCESS.map(([id, label]) => ({
        key: id,
        label,
        active: access === id,
        onPick: () => onPatch({ access: access === id ? 'all' : id }),
      }))
    : []
  // Издание — как на сайте: группа есть, когда в разделе встречаются оба (или
  const edCount = (v: string) => (facets.editions || []).find((e) => e.value.toLowerCase() === v)?.count ?? 0
  const editions: FilterOpt[] =
      ? EDITIONS.map(([id, label]) => ({
          key: id,
          label,
          count: edCount(id.toLowerCase()),
          active: edition === id,
          onPick: () => onPatch({ edition: edition === id ? null : id }),
        }))
      : []
  const uses: FilterOpt[] = (facets.uses || []).map((u) => ({
    key: u.value,
    label: u.label,
    count: u.count,
    active: use === u.value,
    onPick: () => onPatch({ use: use === u.value ? null : u.value }),
  }))
  const prices: FilterOpt[] = PRICES.map(([id, label]) => ({
    key: id,
    label,
    active: price === id,
    onPick: () => onPatch({ price: price === id ? null : id }),
  }))
  return (
    <div className="mr-filters">
      {version || loader || category || edition || use || price || (access && access !== 'all') ? (
        <button type="button" className="mr-reset" data-track="filter_reset" onClick={onReset}>
          Сбросить фильтры
        </button>
      ) : null}
      <FilterGroup title="Издание" name="edition" opts={editions} />
      <FilterGroup title="Для чего" name="use" opts={uses} />
      <FilterGroup title="Доступ" name="access" opts={accessOpts} />
      <FilterGroup title="Версия игры" name="version" opts={versions} lead={(o) => filled.has(o.key)} />
      <FilterGroup title="Загрузчик" name="loader" opts={loaders} />
      <FilterGroup title="Категории" name="category" opts={cats} />
      {access ? null : <FilterGroup title="Цена" name="price" opts={prices} />}
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
