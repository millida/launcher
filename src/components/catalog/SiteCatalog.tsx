import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { CatalogFor } from './CatalogTop'
import { CatalogNotice } from './CatalogShell'
import { FilterGroup, SiteFilters } from './SiteFilters'
import { HitRow, MapRow, RowSkeleton, SiteGalleryCard, SiteRow } from './SiteRow'
import type { MapHit } from './SiteRow'
import { SERVER_SECTIONS, SITE_SECTIONS, materials, peekHit, sectionBySlug, sectionByKind } from './site'
import type { SiteSection } from './site'
import { activeFilters, useServerSite, useSite } from './siteStore'
import { mrTail, nextLoad } from './mrTail'
import { CatalogCtx, useCatalogCtx } from './target'
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
          <h1 className="mr-h1">{sec.h1}</h1>
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
            {count ? <span className="mr-count">{count}</span> : <span className="mr-count" />}
            {sort}
          </div>
        </div>
        {narrow && open ? <div className="mr-sheet">{filters}</div> : null}
        {children}
      </div>
    </div>
  )
}

function SectionPane({ sec, narrow, onOpenPack }: { sec: SiteSection; narrow: boolean; onOpenPack?: (slug: string) => void }) {
  const s = useCatalogCtx().store()
  const [open, setOpen] = useState(false)
  const q = s.q.trim()
  useSearchTrack(sec.slug, q, s.page && !s.busy ? s.total : s.failed ? 0 : null)
  const count = s.page ? (q || s.category ? 'Найдено: ' : '') + materials(s.total + s.mrTotal) : null
  const tail = useMemo(() => mrTail(s.items, s.mr, s.page, s.pages, peekHit), [s.items, s.mr, s.page, s.pages])
  const filters = (
    <SiteFilters
      sec={sec}
      facets={s.facets}
      version={s.version}
      loader={s.loader}
      category={s.category}
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
      sort={<Sort value={s.sort} onPick={(v) => s.patch({ sort: v })} />}
    >
      {s.failed ? (
        <CatalogNotice note={{ icon: 'i-alert', title: 'Каталог не ответил', action: { label: 'Повторить', primary: true, icon: 'i-restart', onClick: () => void s.load() } }} />
      ) : loading ? (
        <div className={sec.gallery ? 'mr-galgrid' : 'mr-list'}>
          <RowSkeleton gallery={sec.gallery} />
        </div>
      ) : !s.items.length && !tail.length ? (
        <CatalogNotice
          note={
            q || s.category || s.version || s.loader
              ? { icon: 'i-search', title: 'Ничего не нашлось', action: { label: 'Показать весь раздел', onClick: () => s.reset() } }
              : { icon: 'i-inbox', title: 'Здесь пока пусто' }
          }
        />
      ) : (
        <>
          {s.items.length ? (
            <div className={(sec.gallery ? 'mr-galgrid' : 'mr-list') + (s.busy && s.page === 1 ? ' cat-dim' : '')}>
              {s.items.map((c, i) => (
                <Card key={c.slug} card={c} sec={sec} pos={i} onOpenPack={onOpenPack} />
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
          {nextLoad(s) ? <AutoMore busy={s.busy} onMore={() => !s.busy && void s.load(true)} /> : null}
        </>
      )}
    </Frame>
  )
}

/** Свой раздел рядом с разделами каталога: «Серверы» в «Ресурсах», «Ядра» в панели сервера. */
export interface ExtraTab {
  id: string
  label: string
  node: ReactNode
  /** Встать перед разделами каталога, а не после. */
  first?: boolean
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
  onOpenPack?: (slug: string) => void
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
  const extras: ExtraTab[] = [...(extra || []), ...(servers ? [{ id: 'servers', label: 'Серверы', node: servers }] : [])]
  const ctx = useMemo(() => ({ store, target }), [store, target])

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
      onClick={() => setOwn(x.id)}
    >
      {x.label}
    </button>
  )
  return (
    <CatalogCtx.Provider value={ctx}>
      <div className={'mr-cat' + (server ? ' is-server' : '')} id={server ? undefined : 's-mods'} data-section={section} data-src={server ? 'hosting_catalog' : 'catalog'}>
        <nav className="segs mr-types" aria-label="Разделы каталога">
          {extras.filter((x) => x.first).map(extraBtn)}
          {tabs.map((t) => (
            <button
              key={t.slug}
              className={'seg' + (!own && t.slug === section ? ' on' : '')}
              aria-current={!own && t.slug === section ? 'page' : undefined}
              data-track={'cat_' + t.slug}
              onClick={() => {
                setOwn(null)
                if (t.slug !== section) store.getState().setSection(t.slug)
              }}
            >
              {t.title}
            </button>
          ))}
          {extras.filter((x) => !x.first).map(extraBtn)}
        </nav>
        {ownTab ? (
          ownTab.node
        ) : sec.kind === 'world' ? (
          server || !hasTauri() ? (
            <HostMapsPane narrow={narrow} />
          ) : (
            <MapsPane narrow={narrow} />
          )
        ) : (
          <SectionPane key={sec.slug} sec={sec} narrow={narrow} onOpenPack={onOpenPack} />
        )}
      </div>
    </CatalogCtx.Provider>
  )
}

const BUILD: CatalogTarget = { kind: 'build' }
