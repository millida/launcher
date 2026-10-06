import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon'
import { MrIcon, TagGlyph } from './SiteRow'
import { capFirst, categoryIconSrc, fmtNum, loaderIconSrc, loaderLabel, loaderTone } from './site'
import type { SiteFacets, SiteSection } from './site'
import type { SiteAccess, SiteSort } from './siteStore'
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

/* ── Ключи: компактная панель как на сайте (`mr-filters.tsx`, 30.09.2026) ── */

const LOADERS_VISIBLE = 6
const CATS_VISIBLE = 12
const CATS_VISIBLE_TIGHT = 6
const USES_VISIBLE = 6

const SORTS: [SiteSort, string][] = [
  ['recommended', 'Рекомендуемые'],
  ['popular', 'Популярные'],
  ['new', 'Новые'],
]

function Key({ o, name, plain }: { o: FilterOpt; name?: string; plain?: boolean }) {
  const tone = o.tone ? ({ color: o.tone } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className={'seg mr-key' + (o.active ? ' on' : '')}
      aria-pressed={o.active}
      data-track={name ? 'filter_' + name : undefined}
      data-id={name ? o.key : undefined}
      onClick={o.onPick}
    >
      {!plain && o.icon ? (
        <span className="mr-key-ic" style={tone}>
          {o.icon}
        </span>
      ) : null}
      <span className="mr-key-t" style={tone}>
        {o.label}
      </span>
      {o.count !== undefined ? <span className="mr-key-n">{fmtNum(o.count)}</span> : null}
    </button>
  )
}

/** Закрывает раскрытый список по клику мимо и по Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])
  return ref
}

function PickBtn({ open, onClick, children, label }: { open: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button type="button" className={'seg mr-pick-btn' + (open ? ' is-open' : '')} aria-expanded={open} aria-label={label} onClick={onClick}>
      {children}
      <Icon id="i-chev-d" />
    </button>
  )
}

function SortPicker({ value, onPick }: { value: SiteSort; onPick: (v: SiteSort) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const cur = SORTS.find(([id]) => id === value) ?? SORTS[0]!
  return (
    <div className="mr-pick" ref={ref}>
      <PickBtn open={open} onClick={() => setOpen((v) => !v)} label="Сортировка">
        <span className="mr-pick-v">
          <span className="mr-pick-l">Сорт.:</span> {cur[1]}
        </span>
      </PickBtn>
      {open ? (
        <div className="mr-pick-pop">
          {SORTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={'seg mr-key mr-key-wide' + (id === value ? ' on' : '')}
              data-track={'sort_' + id}
              onClick={() => {
                onPick(id)
                setOpen(false)
              }}
            >
              <span className="mr-key-t">{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function VersionPicker({ opts, current, quick }: { opts: FilterOpt[]; current: string | null; quick: FilterOpt[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useDismiss(open, () => setOpen(false))
  const needle = q.trim().toLowerCase()
  const list = needle ? opts.filter((o) => o.label.toLowerCase().includes(needle)) : opts
  return (
    <div className="mr-pick" ref={ref}>
      <PickBtn open={open} onClick={() => setOpen((v) => !v)} label="Версия игры">
        <span className={'mr-pick-v' + (current ? '' : ' is-empty')}>{current ?? 'Все версии'}</span>
      </PickBtn>
      {open ? (
        <div className="mr-pick-pop">
          <label className="mr-pick-q">
            <Icon id="i-search" />
            <input type="search" inputMode="decimal" autoFocus value={q} placeholder="Найти версию" aria-label="Найти версию" onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="mr-pick-list">
            {list.map((o) => (
              <button
                key={o.key}
                type="button"
                className={'seg mr-key' + (o.active ? ' on' : '')}
                aria-pressed={o.active}
                data-track="filter_version"
                data-id={o.key}
                onClick={() => {
                  o.onPick()
                  setOpen(false)
                }}
              >
                <span className="mr-key-t">{o.label}</span>
                {o.count !== undefined ? <span className="mr-key-n">{fmtNum(o.count)}</span> : null}
              </button>
            ))}
            {list.length === 0 ? <div className="mr-pick-none">Нет такой версии</div> : null}
          </div>
        </div>
      ) : null}
      {!open && quick.length > 1 ? (
        <div className="mr-quick">
          {quick.map((o) => (
            <button key={o.key} type="button" className={'seg mr-key' + (o.active ? ' on' : '')} aria-pressed={o.active} data-track="filter_version" data-id={o.key} onClick={o.onPick}>
              <span className="mr-key-t">{o.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function KeySection({
  title,
  opts,
  split = VISIBLE,
  name,
  plain,
  moreLabel = 'Ещё',
}: {
  title: string
  opts: FilterOpt[]
  split?: number
  name: string
  plain?: boolean
  moreLabel?: string
}) {
  const cut = Math.max(1, Math.min(opts.length, split))
  // Хвост из одного ключа не прячем: «Ещё 1» занимает столько же места.
  const head = opts.length - cut <= 1 ? opts : opts.slice(0, cut)
  const rest = opts.slice(head.length)
  const [more, setMore] = useState(() => rest.some((o) => o.active))
  if (!opts.length) return null
  return (
    <section className="mr-fsec">
      <div className="mr-fsec-t">{title}</div>
      <div className="mr-keys">
        {head.map((o) => (
          <Key key={o.key} o={o} name={name} plain={plain} />
        ))}
        {rest.length && !more ? (
          <button type="button" className="seg mr-key mr-more" data-track={'filter_' + name + '_more'} onClick={() => setMore(true)}>
            <span className="mr-key-t">{moreLabel}</span>
            <span className="mr-key-n">{rest.length}</span>
            <Icon id="i-chev-d" />
          </button>
        ) : null}
        {more ? rest.map((o) => <Key key={o.key} o={o} name={name} plain={plain} />) : null}
        {rest.length && more ? (
          <button type="button" className="seg mr-key mr-more mr-more-close" data-track={'filter_' + name + '_less'} onClick={() => setMore(false)}>
            <span className="mr-key-t">Свернуть</span>
            <Icon id="i-chev-d" />
          </button>
        ) : null}
      </div>
    </section>
  )
}

const EDITIONS: [EditionFilter, string][] = [
  ['JAVA', 'Java'],
  ['BEDROCK', 'Bedrock'],
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
  sort,
  onSort,
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
  /** Сортировка — выпадающий список вверху панели, как на сайте. */
  sort?: SiteSort
  onSort?: (v: SiteSort) => void
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
    ? facets.loaders
        // Хвост из единиц («canvas 2», «Fabric 1» у шейдеров) — шум: прячем, пока не выбран.
        .filter((l) => l.count >= 10 || loader === l.value)
        .slice(0, 14)
        .map((l) => {
        const src = loaderIconSrc(l.value)
        return {
          key: l.value,
          label: capFirst(loaderLabel(l.value)),
          count: l.count,
          tone: loaderTone(l.value),
          icon: src ? <TagGlyph node={<MrIcon src={src} size={12} />} tone={loaderTone(l.value)} /> : null,
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
      icon: src ? <TagGlyph node={<MrIcon src={src} size={12} />} /> : null,
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
  // выбран Bedrock). Счётчик приходит строчными `java`/`bedrock`.
  const edCount = (v: string) => (facets.editions || []).find((e) => e.value.toLowerCase() === v)?.count ?? 0
  const editions: FilterOpt[] =
    facets.editions && (edCount('bedrock') > 0 || edition)
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
  // Быстрые ключи под списком — четыре самые наполненные версии.
  const quick = versions
    .filter((o) => filled.has(o.key))
    .slice()
    .sort((x, y) => (y.count ?? 0) - (x.count ?? 0))
    .slice(0, 4)
  const anyActive = !!(version || loader || category || edition || use || price || (access && access !== 'all'))
  const tight = uses.length > 0
  return (
    <div className="card mr-filters mr-fbox">
      {sort && onSort ? <SortPicker value={sort} onPick={onSort} /> : null}
      {anyActive ? (
        <button type="button" className="mr-reset" data-track="filter_reset" onClick={onReset}>
          Сбросить
        </button>
      ) : null}
      {versions.length ? (
        <section className="mr-fsec">
          <div className="mr-fsec-t">Версия</div>
          <VersionPicker opts={versions} current={version} quick={quick} />
        </section>
      ) : null}
      {/* «Доступ» — только когда выбран: платных единицы (владелец 30.09.2026, 20:39). */}
      {access && access !== 'all' ? <KeySection title="Доступ" name="access" opts={accessOpts} plain /> : null}
      <KeySection title="Издание" name="edition" opts={editions} plain />
      <KeySection title="Загрузчик" name="loader" opts={loaders} split={LOADERS_VISIBLE} />
      <KeySection title="Для чего" name="use" opts={uses} split={USES_VISIBLE} plain />
      <KeySection title="Категории" name="category" opts={cats} split={tight ? CATS_VISIBLE_TIGHT : CATS_VISIBLE} plain moreLabel="Все категории" />
      {access ? null : <KeySection title="Цена" name="price" opts={prices} plain />}
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
