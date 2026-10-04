import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { CatalogFor } from './CatalogTop'
import { CatalogNotice } from './CatalogShell'
import { FilterGroup, SiteFilters } from './SiteFilters'
import { HitRow, MapRow, RowSkeleton, SiteGalleryCard, SiteRow } from './SiteRow'
import type { MapHit } from './SiteRow'
import { SERVER_SECTIONS, SITE_SECTIONS, fmtNum, loadCurated, loadSkins, materials, peekHit, sectionBySlug, sectionByKind } from './site'
import type { CuratedItem, SkinTile } from './site'
import { CATALOG_GROUPS, SECTION_VISUAL, curatedTitle, groupOf, groupVisual, siteSectionPath } from './sections'
import type { NavGroup } from './sections'
import { PxIcon } from '../PxIcon'
import { Fallback, MrIcon, TagGlyph } from './SiteRow'
import { CHEAT_SOURCE_NOTE, installFromCatalog } from '../../lib/catalogInstall'
import { openExt } from '../../lib/api'
import { setScreen } from '../../state/ui'
import { capFirst, loaderIconSrc, loaderLabel, loaderTone, plural } from './site'
import type { SiteSection } from './site'
import { activeFilters, useServerSite, useSite } from './siteStore'
import { cfTail, mrTail, nextLoad } from './mrTail'
import { CatalogCtx, useCatalogCtx } from './target'
import { PurchasesPane } from './Purchases'
import type { CatalogTarget } from './target'
import { host } from '../../screens/hosting/api'
import { useHubTab } from '../playhub/hubTab'
import { hasTauri } from '../../ipc/tauri'
import { listVersions } from '../../ipc/commands'
import { loaderId } from '../../lib/format'
import { pickTargetName } from '../../lib/installKeys'
import { pickBuild } from '../../state/buildPicker'
import { F_VERS, WORLD_CATS, useMods } from '../../state/mods'
import { useProfiles } from '../../state/profiles'
import { track } from '../../lib/telemetry'
import { ItemPage } from './ItemPage'
import { closeItem, openItem, useItem } from './itemStore'
import { CHEATS, cheatName } from './itemView'
import '../../styles/pixel/catalog2.css'

/*
 * Каталог Millida в лаунчере — страница раздела millida.net один в один
 * (`mr-section-frame.tsx`): вкладки разделов сверху; слева колонка фильтров;
 * справа заголовок раздела, поиск по разделу, «N материалов», «Популярные |
 * Новые» и лента. У шейдеров и ресурс-паков лента карточками с обложкой, у
 * остальных — строками, как на сайте. В узком окне фильтры уходят в кнопку
 * «Фильтры», как на сайте ниже 1024px.
 *
 * Лаунчерное — только то, что сайт сделать не может: «Для: сборка» (куда
 * ставить) и кнопки строки («В сборку», «Новая сборка», «Установить»).
 */

function useNarrow(): boolean {
  const q = '(max-width: 1023px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

/**
 * Аналитика поиска каталога: длина запроса и число найденных — сам текст не
 * уходит. Пишем, когда набор стих (~800 мс) и выдача пришла; один раз на запрос.
 */
function useSearchTrack(section: string, q: string, results: number | null) {
  const sent = useRef('')
  useEffect(() => {
    const key = section + '|' + q
    if (q.length < 2 || results === null || sent.current === key) return
    const t = setTimeout(() => {
      sent.current = key
      track('catalog_search', { section, len: q.length, results })
    }, 800)
    return () => clearTimeout(t)
  }, [section, q, results])
}

/** Поиск по разделу: выдача меняется по мере набора (пауза 450 мс, от двух букв). */
function SearchField({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  const last = useRef(value)
  useEffect(() => {
    setV(value)
    last.current = value
  }, [value])
  useEffect(() => {
    const q = v.trim()
    if (q === last.current.trim() || q.length === 1) return
    const t = setTimeout(() => {
      last.current = q
      onCommit(q)
    }, 450)
    return () => clearTimeout(t)
  }, [v])
  return (
    <form
      role="search"
      className="input mr-search"
      onSubmit={(e) => {
        e.preventDefault()
        last.current = v.trim()
        onCommit(v.trim())
      }}
    >
      <Icon id="i-search" />
      <input type="search" value={v} placeholder={label} aria-label={label} onChange={(e) => setV(e.target.value)} />
      {v ? (
        <button
          type="button"
          className="mr-search-clear"
          aria-label="Очистить поиск"
          data-track="search_clear"
          onClick={() => {
            setV('')
            last.current = ''
            onCommit('')
          }}
        >
          <Icon id="i-x" />
        </button>
      ) : null}
    </form>
  )
}

function Sort({ value, onPick }: { value: 'popular' | 'new'; onPick: (v: 'popular' | 'new') => void }) {
  return (
    <div className="segs mr-sort" role="group" aria-label="Сортировка">
      <button className={'seg' + (value === 'popular' ? ' on' : '')} aria-pressed={value === 'popular'} data-track="sort_popular" onClick={() => onPick('popular')}>
        Популярные
      </button>
      <button className={'seg' + (value === 'new' ? ' on' : '')} aria-pressed={value === 'new'} data-track="sort_new" onClick={() => onPick('new')}>
        Новые
      </button>
    </div>
  )
}

/** Подгрузка следующей страницы при прокрутке — как `MrAutoMore` сайта. */
function AutoMore({ onMore, busy }: { onMore: () => void; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const fn = useRef(onMore)
  fn.current = onMore
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && fn.current(), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className="mr-more">
      <button className={'btn md secondary' + (busy ? ' cat-busy' : '')} disabled={busy} data-track="load_more" onClick={onMore}>
        Показать ещё
      </button>
    </div>
  )
}

/** «Для: сборка» — куда ставит «В сборку»; «Только подходящее» сужает выдачу под неё. */
function ForBuild({ sec }: { sec: SiteSection }) {
  const { target } = useCatalogCtx()
  if (target.kind === 'server') return null
  return <ForBuildInner sec={sec} />
}

function ForBuildInner({ sec }: { sec: SiteSection }) {
  const profiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const targetBuild = useMods((s) => s.targetBuild)
  const version = useSite((s) => s.version)
  const loader = useSite((s) => s.loader)
  if (!profiles.length || sec.kind === 'modpack' || sec.kind === 'world') return null
  const name = pickTargetName(targetBuild, profiles.map((p) => p.name), selected || '')
  const target = profiles.find((p) => p.name === name) || null
  const withLoader = sec.kind === 'mod'
  const scoped = !!target && version === target.version && (!withLoader || loader === loaderId(target))
  const toggle = () => {
    if (!target) return
    if (scoped) useSite.getState().patch({ version: null, loader: null })
    else useSite.getState().patch({ version: target.version, loader: withLoader ? loaderId(target) : null })
  }
  return (
    <CatalogFor
      build={target}
      scoped={scoped}
      onPick={() =>
        void pickBuild('контент').then((n) => {
          if (!n) return
          useMods.getState().scopeTo(n)
          const p = useProfiles.getState().profiles.find((x) => x.name === n)
          if (p) useSite.getState().patch({ version: p.version, loader: withLoader ? loaderId(p) : null })
        })
      }
      onToggle={toggle}
    />
  )
}

/** Карты — на сайте раздел ещё наполняется, поэтому в лаунчере они из CurseForge (как и раньше). */
function MapsPane({ narrow }: { narrow: boolean }) {
  const mods = useMods()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void mods.load()
    ;(hasTauri() ? listVersions() : Promise.resolve(F_VERS.slice(1)))
      .then((vs) => useMods.getState().setVers(vs))
      .catch(() => useMods.getState().setVers(F_VERS.slice(1)))
  }, [])
  const reload = () => void useMods.getState().load()
  useSearchTrack('maps', mods.mq.trim(), mods.hits.length ? mods.hits.length : mods.notice ? 0 : null)
  const filters = (
    <div className="mr-filters">
      <FilterGroup
        title="Версия игры"
        name="version"
        opts={mods.vers.map((v) => ({
          key: v,
          label: v,
          active: mods.fVer === v,
          onPick: () => (mods.set({ fVer: mods.fVer === v ? 'любая' : v }), reload()),
        }))}
      />
      <FilterGroup
        title="Категории"
        name="category"
        opts={WORLD_CATS.filter(([id]) => id).map(([id, label]) => ({
          key: String(id),
          label,
          active: mods.fWorldCat === id,
          onPick: () => (mods.set({ fWorldCat: mods.fWorldCat === id ? 0 : id }), reload()),
        }))}
      />
    </div>
  )
  const sec = sectionBySlug('maps')
  return (
    <Frame
      sec={sec}
      narrow={narrow}
      filters={filters}
      active={(mods.fVer !== 'любая' ? 1 : 0) + (mods.fWorldCat ? 1 : 0)}
      open={open}
      onOpen={() => setOpen((v) => !v)}
      search={<SearchField value={mods.mq} label={'Поиск по разделу «' + sec.title + '»'} onCommit={(q) => (mods.set({ mq: q }), reload())} />}
      count={mods.hits.length ? mods.count : null}
      sort={<Sort value={mods.fSort === 'Новые' ? 'new' : 'popular'} onPick={(v) => (mods.set({ fSort: v === 'new' ? 'Новые' : 'Популярные' }), reload())} />}
    >
      {mods.notice && !mods.hits.length ? (
        <CatalogNotice note={{ icon: /в приложени/.test(mods.notice) ? 'i-download' : 'i-search', title: /в приложени/.test(mods.notice) ? 'Карты — в приложении' : 'Ничего не нашлось' }} />
      ) : !mods.hits.length ? (
        <div className="mr-list">
          <RowSkeleton />
        </div>
      ) : (
        <>
          <div className="mr-list">
            {mods.hits.map((h, i) => (
              <HitRow key={(h.cfid || h.slug || '') + ':' + i} h={h} pos={i} />
            ))}
          </div>
          {mods.showMore ? <AutoMore busy={false} onMore={() => void useMods.getState().load(true)} /> : null}
        </>
      )}
    </Frame>
  )
}

/**
 * Карты из каталога хостинга (`/hosting/catalog/curseforge?type=map`) — в
 * панели сервера и в браузерном просмотре, где у лаунчера нет CurseForge.
 * Те же рамка, поиск и строки, кнопка — «На сервер».
 */
function HostMapsPane({ narrow }: { narrow: boolean }) {
  const [q, setQ] = useState('')
  const [ver, setVer] = useState<string | null>(null)
  const [hits, setHits] = useState<MapHit[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const seq = useRef(0)
  const load = (offset?: number) => {
    const my = ++seq.current
    setBusy(true)
    setFailed(false)
    if (!offset) setHits(null)
    host
      .searchCurse({ type: 'map', query: q || undefined, version: ver || undefined, offset })
      .then((r) => {
        if (my !== seq.current) return
        const got = (r.hits || []) as MapHit[]
        setHits((old) => (offset ? [...(old || []), ...got] : got))
        setNext(r.hasMore ? r.nextOffset : null)
        if (!r.enabled) setFailed(true)
      })
      .catch(() => my === seq.current && (setFailed(true), setHits((h) => h || [])))
      .finally(() => my === seq.current && setBusy(false))
  }
  useEffect(() => load(), [q, ver])
  useSearchTrack('maps', q, hits ? hits.length : null)
  const sec = sectionBySlug('maps')
  const filters = (
    <div className="mr-filters">
      <FilterGroup
        title="Версия игры"
        name="version"
        opts={F_VERS.slice(1).map((v) => ({ key: v, label: v, active: ver === v, onPick: () => setVer(ver === v ? null : v) }))}
      />
    </div>
  )
  return (
    <Frame
      sec={sec}
      narrow={narrow}
      filters={filters}
      active={ver ? 1 : 0}
      open={open}
      onOpen={() => setOpen((v) => !v)}
      search={<SearchField value={q} label={'Поиск по разделу «' + sec.title + '»'} onCommit={setQ} />}
      count={null}
      sort={null}
    >
      {failed && !(hits && hits.length) ? (
        <CatalogNotice note={{ icon: 'i-alert', title: 'Каталог карт не ответил', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: () => load() } }} />
      ) : hits === null ? (
        <div className="mr-list">
          <RowSkeleton />
        </div>
      ) : !hits.length ? (
        <CatalogNotice note={{ icon: 'i-search', title: 'Ничего не нашлось' }} />
      ) : (
        <>
          <div className={'mr-list' + (busy ? ' cat-dim' : '')}>
            {hits.map((m, i) => (
              <MapRow key={m.id} m={m} pos={i} />
            ))}
          </div>
          {next !== null ? <AutoMore busy={busy} onMore={() => !busy && load(next)} /> : null}
        </>
      )}
    </Frame>
  )
}

function Frame({
  sec,
  narrow,
  filters,
  active,
  open,
  onOpen,
  search,
  count,
  sort,
  children,
}: {
  sec: SiteSection
  narrow: boolean
  filters: React.ReactNode
  active: number
  open: boolean
  onOpen: () => void
  search: React.ReactNode
  count: string | null
  sort: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mr-layout">
      {!narrow ? <aside className="mr-aside" aria-label="Фильтры">{filters}</aside> : null}
      <div className="mr-main">
        <header className="mr-head">
          <h1 className="mr-h1">
            {sec.h1}
            {count ? <span className="mr-h1-n">{count}</span> : null}
          </h1>
          <ForBuild sec={sec} />
        </header>
        <div className="mr-toolbar">
          {search}
          <div className="mr-toolbar-row">
            {narrow ? (
              <button className={'btn sm secondary mr-fbtn' + (open ? ' on' : '')} aria-expanded={open} data-track="filters" onClick={onOpen}>
                <Icon id="i-grid" />
                Фильтры
                {active ? <span className="mr-fbtn-n">{active}</span> : null}
              </button>
            ) : null}
            <span className="mr-count" />
            {sort}
          </div>
        </div>
        {narrow && open ? <div className="mr-sheet">{filters}</div> : null}
        {children}
      </div>
    </div>
  )
}

function SectionPane({ sec, narrow, onOpenPack }: { sec: SiteSection; narrow: boolean; onOpenPack?: (slug: string) => boolean | void }) {
  const store = useCatalogCtx().store
  const s = store()
  const [open, setOpen] = useState(false)
  const q = s.q.trim()
  useSearchTrack(sec.slug, q, s.page && !s.busy ? s.total : s.failed ? 0 : null)
  const searching = q.length >= 2
  const tail = useMemo(() => mrTail(s.items, s.mr, s.page, s.pages, peekHit, searching), [s.items, s.mr, s.page, s.pages, searching])
  const cfRows = useMemo(() => cfTail(s.items, tail, s.cf, s.page, s.pages, peekHit, searching), [s.items, tail, s.cf, s.page, s.pages, searching])
  const count = s.page ? materials(s.total + s.mrTotal + cfRows.length) : null
  const filters = (
    <SiteFilters
      sec={sec}
      facets={s.facets}
      version={s.version}
      loader={s.loader}
      category={s.category}
      access={sec.slug === 'modpacks' && store === useSite ? s.access : undefined}
      edition={s.edition}
      use={s.use}
      price={s.price}
      sort={s.sort}
      onSort={(v) => s.patch({ sort: v })}
      onPatch={(p) => s.patch(p)}
      onReset={() => s.reset()}
    />
  )
  const loading = !s.page && !s.failed
  const Card = sec.gallery ? SiteGalleryCard : SiteRow
  return (
    <Frame
      sec={sec}
      narrow={narrow}
      filters={filters}
      active={activeFilters(s)}
      open={open}
      onOpen={() => setOpen((v) => !v)}
      search={<SearchField value={s.q} label={'Поиск по разделу «' + sec.title + '»'} onCommit={(v) => s.patch({ q: v })} />}
      count={count}
      sort={null}
    >
      {s.failed ? (
        <CatalogNotice note={{ icon: 'i-alert', title: 'Каталог не ответил', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: () => void s.load() } }} />
      ) : loading ? (
        <div className={sec.gallery ? 'mr-galgrid' : 'mr-list'}>
          <RowSkeleton gallery={sec.gallery} />
        </div>
      ) : !s.items.length && !tail.length && !cfRows.length ? (
        <CatalogNotice
          note={
            q || activeFilters(s)
              ? { icon: 'i-search', title: 'Ничего не нашлось', action: { label: 'Показать весь раздел', onClick: () => s.reset() } }
              : { icon: 'i-inbox', title: 'Здесь пока пусто' }
          }
        />
      ) : (
        <>
          {s.items.length ? (
            <div className={(sec.gallery ? 'mr-galgrid' : 'mr-list') + (s.busy && s.page === 1 ? ' cat-dim' : '')}>
              {s.items.map((c, i) => (
                // В «Все» строка ставится и открывается в своём настоящем разделе.
                <Card key={c.slug} card={c} sec={sec.slug === 'all' && c.section ? sectionBySlug(c.section) : sec} list={sec.slug} pos={i} onOpenPack={onOpenPack} />
              ))}
            </div>
          ) : null}
          {tail.length ? (
            <>
              <div className="mr-src-divider" role="separator">
                <span>Ещё с Modrinth</span>
              </div>
              <div className={(sec.gallery ? 'mr-galgrid' : 'mr-list') + (s.busy && s.page === 1 ? ' cat-dim' : '')}>
                {tail.map((c, i) => (
                  <Card key={'mr:' + c.slug} card={c} sec={sec} pos={s.items.length + i} onOpenPack={onOpenPack} />
                ))}
              </div>
            </>
          ) : null}
          {cfRows.length ? (
            <>
              <div className="mr-src-divider" role="separator">
                <span>Ещё с CurseForge</span>
              </div>
              <div className={(sec.gallery ? 'mr-galgrid' : 'mr-list') + (s.busy && s.page === 1 ? ' cat-dim' : '')}>
                {cfRows.map((c, i) => (
                  <Card key={'cf:' + c.slug} card={c} sec={sec} pos={s.items.length + tail.length + i} onOpenPack={onOpenPack} />
                ))}
              </div>
            </>
          ) : null}
          {nextLoad(s) ? <AutoMore busy={s.busy} onMore={() => !s.busy && void s.load(true)} /> : null}
        </>
      )}
    </Frame>
  )
}

/*
 * Читы — кураторский раздел сайта: файлы лежат на нашем хранилище, список —
 * `/catalog/curated/cheats`. Карточка того же вида, что у каталога; «В сборку»
 * ставит тот же файл, что «Скачать в лаунчере» на сайте (millida://install/cheats/…).
 */
function CuratedPane({ narrow }: { narrow: boolean }) {
  const sec = sectionBySlug('cheats')
  const [items, setItems] = useState<CuratedItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [ver, setVer] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const load = () => {
    setFailed(false)
    loadCurated('cheats')
      .then((l) => setItems(l))
      .catch(() => (setFailed(true), setItems([])))
  }
  useEffect(load, [])
  const all = items || []
  const versions = [...new Set(all.flatMap((i) => i.files.flatMap((f) => f.gameVersions)))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const needle = q.trim().toLowerCase()
  const shown = all.filter(
    (i) => (!needle || cheatName(i.slug).toLowerCase().includes(needle) || curatedTitle(i.slug).toLowerCase().includes(needle)) && (!ver || i.files.some((f) => f.gameVersions.includes(ver))),
  )
  useSearchTrack('cheats', needle, items ? shown.length : null)
  const filters = (
    <div className="mr-filters">
      <FilterGroup
        title="Версия игры"
        name="version"
        opts={versions.map((v) => ({ key: v, label: v, active: ver === v, onPick: () => setVer(ver === v ? null : v) }))}
      />
    </div>
  )
  return (
    <Frame
      sec={sec}
      narrow={narrow}
      filters={filters}
      active={ver ? 1 : 0}
      open={open}
      onOpen={() => setOpen((v) => !v)}
      search={<SearchField value={q} label={'Поиск по разделу «' + sec.title + '»'} onCommit={setQ} />}
      count={items ? materials(shown.length) : null}
      sort={null}
    >
      <p role="note" className="mr-cheat-note">
        <Icon id="i-alert" />
        {CHEAT_SOURCE_NOTE}
      </p>
      {failed ? (
        <CatalogNotice note={{ icon: 'i-alert', title: 'Каталог не ответил', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: load } }} />
      ) : items === null ? (
        <div className="mr-galgrid">
          <RowSkeleton gallery />
        </div>
      ) : !shown.length ? (
        <CatalogNotice note={{ icon: 'i-search', title: 'Ничего не нашлось' }} />
      ) : (
        <div className="mr-galgrid">
          {shown.map((it, i) => (
            <CheatCard key={it.slug} it={it} pos={i} />
          ))}
        </div>
      )}
    </Frame>
  )
}

/**
 * Плитка чита — та же плитка ленты, что у модов: обложка, значок, название,
 * вид клиента, строка описания, загрузчик и версии, «В сборку». Картинок у
 * кураторского раздела нет — вместо них блок Minecraft на цвете раздела.
 */
function CheatCard({ it, pos }: { it: CuratedItem; pos: number }) {
  const title = cheatName(it.slug)
  const info = CHEATS[it.slug]
  const loaders = [...new Set(it.files.flatMap((x) => x.loaders))].slice(0, 2)
  const vers = [...new Set(it.files.flatMap((x) => x.gameVersions))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  return (
    <article className="card mr-gal" data-track="row_open" data-kind="cheat" data-id={it.slug} data-pos={pos} onClick={() => openItem({ kind: 'cheat', item: it })}>
      <span className="mr-gal-cover" aria-hidden="true">
        <Fallback slug={it.slug} section="cheats" title={title} />
      </span>
      <span className="mr-gal-body">
        <span className="mr-gal-icon" aria-hidden="true">
          <Fallback slug={it.slug} section="cheats" title={title} />
        </span>
        <h3 className="mr-gal-title">{title}</h3>
        <span className="mr-gal-author">{info ? info.kind : 'Чит-клиент'}</span>
        {info ? <span className="mr-gal-summary">{info.features.slice(0, 3).join(' · ')}</span> : null}
        <ul className="mr-tags mr-gal-tags" aria-label="Метки">
          {loaders.map((l) => {
            const src = loaderIconSrc(l)
            return (
              <li key={l} className="mr-tag has-tone" style={{ '--mk-tone': loaderTone(l) || undefined } as React.CSSProperties}>
                {src ? <TagGlyph node={<MrIcon src={src} size={12} />} tone={loaderTone(l)} /> : null}
                <span>{loaderLabel(l)}</span>
              </li>
            )
          })}
          {vers.length ? (
            <li className="mr-tag">
              <span>{vers.length > 1 ? vers[vers.length - 1] + ' — ' + vers[0] : vers[0]}</span>
            </li>
          ) : null}
        </ul>
        <span className="mr-gal-foot">
          <span className="mr-gal-stat">
            {it.downloads > 0 ? (
              <>
                <Icon id="i-download" />
                <b>{fmtNum(it.downloads)}</b>
              </>
            ) : null}
          </span>
          <div className="mr-actions">
            <button
              className="btn sm primary"
              data-track="add_to_build"
              onClick={(e) => {
                e.stopPropagation()
                void installFromCatalog('cheats', it.slug)
              }}
            >
              <Icon id="i-plus" />В сборку
            </button>
          </div>
        </span>
      </span>
    </article>
  )
}

/*
 * Скины — сетка `/skins/katalog` сайта (`/v2/skins`): рендер во весь рост, имя,
 * сколько носят. «В гардероб» — то же, что «Скачать в лаунчере» на сайте
 * (millida://install/skins/<id>): скин ложится в гардероб аккаунта и надевается.
 */
function SkinsPane() {
  const sec = sectionBySlug('skins')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'popular' | 'new'>('popular')
  const [items, setItems] = useState<SkinTile[] | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)
  const load = (p = 1) => {
    const my = ++seq.current
    setBusy(true)
    setFailed(false)
    if (p === 1) setItems(null)
    loadSkins({ q, sort, page: p })
      .then((r) => {
        if (my !== seq.current) return
        setItems((old) => (p > 1 ? [...(old || []), ...r.items.filter((x) => !(old || []).some((o) => o.id === x.id))] : r.items))
        setPage(r.page)
        setPages(r.pages)
        setTotal(r.total)
      })
      .catch(() => my === seq.current && (setFailed(true), setItems((i) => i || [])))
      .finally(() => my === seq.current && setBusy(false))
  }
  useEffect(() => load(1), [q, sort])
  useSearchTrack('skins', q.trim(), items ? total : null)
  return (
    <div className="mr-main mr-skins">
      <header className="mr-head">
        <h1 className="mr-h1">{sec.h1}</h1>
      </header>
      <div className="mr-toolbar">
        <SearchField value={q} label="Поиск скинов" onCommit={setQ} />
        <div className="mr-toolbar-row">
          <span className="mr-count">{items ? total.toLocaleString('ru-RU') + ' ' + plural(total, 'скин', 'скина', 'скинов') : ''}</span>
          <Sort value={sort} onPick={setSort} />
        </div>
      </div>
      {failed && !(items && items.length) ? (
        <CatalogNotice note={{ icon: 'i-alert', title: 'Каталог скинов не ответил', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: () => load(1) } }} />
      ) : items === null ? (
        <div className="mr-skingrid">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="card mr-skin cat-skel" aria-hidden="true">
              <span className="mr-skin-art skel"></span>
            </div>
          ))}
        </div>
      ) : !items.length ? (
        <CatalogNotice note={{ icon: 'i-search', title: 'Ничего не нашлось' }} />
      ) : (
        <>
          <div className={'mr-skingrid' + (busy && page === 1 ? ' cat-dim' : '')}>
            {items.map((k, i) => (
              <SkinCard key={k.id} k={k} pos={i} />
            ))}
          </div>
          {page < pages ? <AutoMore busy={busy} onMore={() => !busy && load(page + 1)} /> : null}
        </>
      )}
    </div>
  )
}

function SkinCard({ k, pos }: { k: SkinTile; pos: number }) {
  const name = capFirst(k.title.replace(/^Скин:\s*/i, ''))
  return (
    <article className="card mr-skin" data-track="row_open" data-kind="skin" data-id={k.id} data-pos={pos} onClick={() => openItem({ kind: 'skin', skin: k })}>
      <span className="mr-skin-art" aria-hidden="true">
        <img src={k.renderUrl} alt="" loading={pos < 8 ? 'eager' : 'lazy'} draggable={false} />
        {k.wearers > 0 ? (
          <span className="mr-skin-wear">
            <Icon id="i-users" />
            {fmtNum(k.wearers)}
          </span>
        ) : null}
      </span>
      <span className="mr-skin-name">{name}</span>
      <button
        className="btn sm primary"
        data-track="skin_wear"
        onClick={(e) => {
          e.stopPropagation()
          void installFromCatalog('skins', k.id, { name, slim: k.model === 'slim' })
        }}
      >
        В гардероб
      </button>
    </article>
  )
}

/*
 * Сиды, головы, плащи — разделы сайта без файла для папки игры: сид — строка
 * для поля «Сид», голова — команда /give, плащи Mojang и OptiFine выдаёт не
 * лаунчер. Лента у них на сайте; плащ Millida надевается в гардеробе.
 */
function SitePane({ slug }: { slug: 'seeds' | 'heads' | 'capes' }) {
  const sec = sectionBySlug(slug)
  const vis = SECTION_VISUAL[slug]
  return (
    <div className="mr-main mr-sitepane">
      <header className="mr-head">
        <h1 className="mr-h1">{sec.h1}</h1>
      </header>
      <div className="card mr-sitecard">
        <span className="mr-sitecard-ic" style={{ color: vis.tint }}>
          <PxIcon name={vis.px} size={40} />
        </span>
        <div className="mr-sitecard-acts">
          {slug === 'capes' ? (
            <button className="btn md primary" data-track="capes_wardrobe" onClick={() => setScreen('skins')}>
              <PxIcon name="cape" size={16} /> Гардероб
            </button>
          ) : null}
          <button className={'btn md ' + (slug === 'capes' ? 'secondary' : 'primary')} data-track={'site_' + slug} onClick={() => openExt('https://millida.net' + siteSectionPath(slug))}>
            <Icon id="i-ext" /> На сайте
          </button>
        </div>
      </div>
    </div>
  )
}

/** Ряд групп разделов — шапка каталога сайта: значок и цвет раздела, группа открывает свой первый раздел. */
function GroupNav({
  section,
  own,
  onPick,
  extras,
}: {
  section: string
  own: boolean
  onPick: (slug: string) => void
  extras: ReactNode
}) {
  const current = groupOf(section)
  return (
    <>
      <nav className="segs mr-types mr-groups" aria-label="Разделы каталога">
        {CATALOG_GROUPS.map((g: NavGroup) => {
          const on = !own && g.key === current.key
          const vis = groupVisual(g)
          return (
            <button
              key={g.key}
              className={'seg' + (on ? ' on' : '')}
              aria-current={on ? 'page' : undefined}
              data-track={'cat_group_' + g.key}
              onClick={() => onPick(on ? section : g.tabs[0]!.slug)}
            >
              <span className="mr-sec-ic" style={{ color: vis.tint }}>
                <PxIcon name={vis.px} size={16} />
              </span>
              {g.label}
            </button>
          )
        })}
        {extras}
      </nav>
      {!own && current.tabs.length > 1 ? (
        <nav className="segs mr-subtypes" aria-label={'Разделы группы «' + current.label + '»'}>
          {current.tabs.map((t) => {
            const on = t.slug === section
            const vis = SECTION_VISUAL[t.slug]
            return (
              <button key={t.slug} className={'seg' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined} data-track={'cat_' + t.slug} onClick={() => onPick(t.slug)}>
                <span className="mr-sec-ic" style={{ color: vis.tint }}>
                  <PxIcon name={vis.px} size={14} />
                </span>
                {t.label}
              </button>
            )
          })}
        </nav>
      ) : (
        // Ряд подвкладок держит место и там, где их нет (владелец 30.09.2026,
        // 21:04: «меню скачет»): лента не прыгает при смене раздела.
        <div className="mr-subtypes-gap" aria-hidden="true" />
      )}
    </>
  )
}

/** Свой раздел рядом с разделами каталога: «Серверы» в «Ресурсах», «Ядра» в панели сервера. */
export interface ExtraTab {
  id: string
  label: string
  node: ReactNode
  /** Встать перед разделами каталога, а не после. */
  first?: boolean
  /** Пиксельный значок и его цвет — как у групп каталога. */
  px?: string
  tint?: string
}

/**
 * Каталог целиком. `content` — вкладка «Мои сборки»: только то, что ставят в
 * свою сборку, без раздела «Сборки». `target` — куда ставит: в сборку
 * («Ресурсы») или на сервер (вкладка контента панели хостинга) — компонент
 * один, поэтому кнопка, добавленная в строку, появляется в обоих местах
 * (приказ владельца 24.09.2026, 18:35).
 */
export function SiteCatalog({
  content,
  onOpenPack,
  servers,
  target = BUILD,
  extra,
}: {
  content?: boolean
  onOpenPack?: (slug: string) => boolean | void
  /** Раздел «Серверы» — лента мониторинга (владелец 24.09.2026, 18:29). */
  servers?: ReactNode
  target?: CatalogTarget
  extra?: ExtraTab[]
}) {
  const server = target.kind === 'server'
  const store = server ? useServerSite : useSite
  const section = store((s) => s.section)
  const [own, setOwn] = useState<string | null>(() => (extra && extra.find((x) => x.first) ? extra.find((x) => x.first)!.id : null))
  const narrow = useNarrow()
  const tabs = server ? SERVER_SECTIONS : content ? SITE_SECTIONS.filter((x) => x.kind !== 'modpack') : SITE_SECTIONS
  const seq = useHubTab((s) => s.seq)
  const extras: ExtraTab[] = [
    ...(extra || []),
    ...(servers ? [{ id: 'servers', label: 'Серверы', node: servers, px: 'server', tint: 'var(--m-sec-servers)' }] : []),
    // Купленное в каталоге — поставить заново в любую сборку. На сервер платное не ставится.
    ...(server ? [] : [{ id: 'purchases', label: 'Покупки', node: <PurchasesPane onOpenPack={onOpenPack} />, px: 'wallet', tint: 'var(--m-sec-purchases)' }]),
  ]
  const ctx = useMemo(() => ({ store, target }), [store, target])
  const item = useItem((s) => s.cur)
  // Ушли из каталога или вошли в него снаружи — страница материала закрывается.
  useEffect(() => () => useItem.setState({ cur: null }), [])
  useEffect(() => {
    if (useItem.getState().cur) useItem.setState({ cur: null })
  }, [seq, section])

  // Вход снаружи («Все» у полки, плитка категории, «Добавить» в сборке): раздел
  // и сужение под сборку берутся из `useMods`, как их выставил вход.
  useEffect(() => {
    if (server) {
      const st = useServerSite.getState()
      if (!tabs.some((t) => t.slug === st.section)) st.setSection(tabs[0]!.slug)
      else if (!st.page) void st.load()
      return
    }
    const m = useMods.getState()
    let sec = sectionByKind(m.modTab)
    if (content && sec.kind === 'modpack') sec = sectionBySlug('mods')
    const st = useSite.getState()
    const scope = {
      version: m.fVer !== 'любая' && m.fVer ? m.fVer : null,
      loader: sec.loaderAxis && sec.kind !== 'shader' && m.fLoader !== 'любой' && m.fLoader ? m.fLoader : null,
    }
    if (st.section !== sec.slug || !st.page) {
      st.setSection(sec.slug)
      if (scope.version || scope.loader) useSite.getState().patch(scope)
    } else if (scope.version || scope.loader) st.patch(scope)
    else void st.load()
  }, [seq, content, server])

  const sec = sectionBySlug(section)
  const ownTab = own ? extras.find((x) => x.id === own) || null : null
  const extraBtn = (x: ExtraTab) => (
    <button
      key={x.id}
      className={'seg' + (own === x.id ? ' on' : '')}
      aria-current={own === x.id ? 'page' : undefined}
      data-track={'cat_' + x.id}
      onClick={() => {
        closeItem()
        setOwn(x.id)
      }}
    >
      {x.px ? (
        <span className="mr-sec-ic" style={{ color: x.tint }}>
          <PxIcon name={x.px} size={16} />
        </span>
      ) : null}
      {x.label}
    </button>
  )
  const pick = (slug: string) => {
    closeItem()
    setOwn(null)
    if (slug !== section) store.getState().setSection(slug as SiteSection['slug'])
  }
  // Карт в каталоге Millida может не быть (раздел наполняется) — тогда, как и
  // раньше, лента CurseForge. Любой фильтр или поиск — уже ответ каталога.
  const mapsEmpty = store((s) => s.section === 'maps' && s.page > 0 && !s.items.length && !s.q.trim() && !activeFilters(s))
  const grouped = !server && !content
  const body = ownTab ? (
    ownTab.node
  ) : sec.kind === 'world' && (server || !hasTauri()) ? (
    <HostMapsPane narrow={narrow} />
  ) : sec.kind === 'world' && mapsEmpty ? (
    <MapsPane narrow={narrow} />
  ) : sec.source === 'curated' ? (
    <CuratedPane narrow={narrow} />
  ) : sec.source === 'skins' ? (
    <SkinsPane />
  ) : sec.source === 'site' ? (
    <SitePane slug={sec.slug as 'seeds' | 'heads' | 'capes'} />
  ) : (
    <SectionPane key={sec.slug} sec={sec} narrow={narrow} onOpenPack={onOpenPack} />
  )
  return (
    <CatalogCtx.Provider value={ctx}>
      <div className={'mr-cat' + (server ? ' is-server' : '')} id={server ? undefined : 's-mods'} data-section={section} data-src={server ? 'hosting_catalog' : 'catalog'}>
        {grouped ? (
          <GroupNav
            section={section}
            own={!!own}
            onPick={pick}
            extras={
              <>
                {extras.filter((x) => x.first).map(extraBtn)}
                {extras.filter((x) => !x.first).map(extraBtn)}
              </>
            }
          />
        ) : (
          <nav className="segs mr-types" aria-label="Разделы каталога">
            {extras.filter((x) => x.first).map(extraBtn)}
            {tabs.map((t) => (
              <button
                key={t.slug}
                className={'seg' + (!own && t.slug === section ? ' on' : '')}
                aria-current={!own && t.slug === section ? 'page' : undefined}
                data-track={'cat_' + t.slug}
                onClick={() => pick(t.slug)}
              >
                {t.title}
              </button>
            ))}
            {extras.filter((x) => !x.first).map(extraBtn)}
          </nav>
        )}
        {item ? <ItemPage it={item} /> : null}
        <div className="mr-cat-body" hidden={!!item}>
          {body}
        </div>
      </div>
    </CatalogCtx.Provider>
  )
}

const BUILD: CatalogTarget = { kind: 'build' }
