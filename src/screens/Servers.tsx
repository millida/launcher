import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { FilterPill } from '../components/FilterPill'
import { ServerRow } from '../components/ServerRow'
import { openExt } from '../lib/api'
import { track } from '../lib/telemetry'
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  SERVER_TABS,
  currentFilters,
  isFiltered,
  loadLiveRating,
  loadMoreServers,
  useServers,
} from '../state/servers'

const SORTS: [string, string][] = [
  ['rating', 'По рейтингу'],
  ['online', 'По онлайну'],
  ['name', 'По названию'],
  ['new', 'Сначала новые'],
]

const LICENSES: [string, string][] = [
  ['', 'Любая лицензия'],
  ['CRACKED', 'Без лицензии'],
  ['LICENSE', 'Только лицензия'],
]

const RATING_ADD_URL = 'https://millida.net/rating/add'

const ONLINE_FILTERS: [string, string][] = [
  ['', 'Любой онлайн'],
  ['live', 'Сейчас есть игроки'],
  ['20', 'От 20 игроков'],
  ['100', 'От 100 игроков'],
]

const SEARCH_DELAY = 400

export function Servers({ on }: { on: boolean }) {
  const { list, total, status, error, loadingMore, category, sort, license, online, version, versions, search } =
    useServers()
  const [q, setQ] = useState(search)
  const typed = useRef(false)

  // The pills hold what the catalogue was asked for, the input holds what is
  // being typed: they diverge only while the debounce is pending, and a reset
  // from elsewhere has to win over a stale draft.
  useEffect(() => {
    if (!typed.current) setQ(search)
  }, [search])

  useEffect(() => {
    if (!typed.current || q.trim() === search.trim()) return
    const t = setTimeout(() => {
      typed.current = false
      void loadLiveRating({ search: q })
    }, SEARCH_DELAY)
    return () => clearTimeout(t)
  }, [q, search])

  // Аналитика поиска серверов: длина запроса и число найденных, без текста.
  const searched = useRef('')
  useEffect(() => {
    const s = search.trim()
    if (s.length < 2 || status !== 'ok' || searched.current === s) return
    const t = setTimeout(() => {
      searched.current = s
      track('catalog_search', { section: 'servers', len: s.length, results: total })
    }, 800)
    return () => clearTimeout(t)
  }, [search, status, total])

  useEffect(() => {
    if (status === 'error' && error) console.warn('[servers] rating load failed:', error)
  }, [status, error])

  const filtered = isFiltered(currentFilters())
  const hasMore = list.length < total
  const versionOptions = versions
    .slice()
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))

  const reset = () => {
    typed.current = false
    setQ('')
    void loadLiveRating(DEFAULT_FILTERS)
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-servers">
      <div className="page-head">
        <h1>Серверы</h1>
        <div className="right">
          <div className="input sm" style={{ width: '240px' }}>
            <Icon id="i-search" />
            <input
              placeholder="Поиск"
              value={q}
              onChange={(e) => {
                typed.current = true
                setQ(e.target.value)
              }}
            />
          </div>
          {/* Для владельцев серверов, не для игрока: главное на экране — «Играть» в строке. */}
          <button className="btn sm secondary" data-sound="open" data-track="rating_add_server" onClick={() => openExt(RATING_ADD_URL)}>
            <Icon id="i-plus" />
            Свой сервер
          </button>
        </div>
      </div>

      <div className="mods-filters">
        <FilterPill
          icon="i-grid"
          label="Категория"
          track="category"
          defaultValue=""
          value={category}
          width={200}
          options={SERVER_TABS.map(([label, code]) => ({ value: code, label }))}
          onPick={(v) => void loadLiveRating({ category: v })}
        />
        <FilterPill
          icon="i-filter"
          label="Сортировка"
          track="sort"
          defaultValue={DEFAULT_FILTERS.sort}
          value={sort}
          width={180}
          options={SORTS.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => void loadLiveRating({ sort: v })}
        />
        <FilterPill
          icon="i-key"
          label="Лицензия"
          track="license"
          defaultValue=""
          value={license}
          width={190}
          options={LICENSES.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => void loadLiveRating({ license: v })}
        />
        <FilterPill
          icon="i-users"
          label="Онлайн"
          track="online"
          defaultValue=""
          value={online}
          width={190}
          options={ONLINE_FILTERS.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => void loadLiveRating({ online: v })}
        />
        {versionOptions.length ? (
          <FilterPill
            icon="i-box2"
            label="Версия"
            track="version"
            defaultValue=""
            value={version}
            width={190}
            options={[{ value: '', label: 'Любая версия' }].concat(
              versionOptions.map((v) => ({ value: v.version, label: v.version + ' · ' + v.servers })),
            )}
            onPick={(v) => void loadLiveRating({ version: v })}
          />
        ) : null}
        {filtered ? (
          <button type="button" className="mk-pill" data-track="filter_reset" onClick={reset}>
            <Icon id="i-x" />
            <span>Сбросить</span>
          </button>
        ) : null}
      </div>

      {status === 'error' ? (
        // Причина (код ответа, текст исключения) — в консоль, не игроку.
        <div className="cat-empty">
          <span className="cat-empty-ic">
            <Icon id="i-alert" />
          </span>
          <b>Серверы не загрузились</b>
          <button className="btn md primary" data-track="retry" onClick={() => void loadLiveRating()}>
            <Icon id="i-restart" />
            Повторить
          </button>
        </div>
      ) : list.length ? (
        <>
          <div className="stack" id="srvList" data-section="servers" data-src={search.trim() ? 'server_search' : 'hub_card'}>
            {list.map((sv, i) => (
              <ServerRow key={sv.slug + i} sv={sv} pos={i} />
            ))}
          </div>
          {hasMore ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
              <button
                className={'btn md secondary' + (loadingMore ? ' cat-busy' : '')}
                disabled={loadingMore}
                data-track="load_more"
                onClick={() => void loadMoreServers()}
              >
                Показать ещё {Math.min(PAGE_SIZE, total - list.length)}
              </button>
            </div>
          ) : null}
        </>
      ) : status === 'ok' ? (
        <div className="cat-empty">
          <span className="cat-empty-ic">
            <Icon id={filtered ? 'i-search' : 'i-server'} />
          </span>
          <b>{filtered ? 'Ничего не нашли' : 'Здесь пока пусто'}</b>
          {filtered ? (
            <button className="btn md secondary" data-track="filter_reset" onClick={reset}>
              Сбросить
            </button>
          ) : null}
        </div>
      ) : (
        <div className="stack">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card skel-card" style={{ padding: '16px' }}>
              <div className="skel-row">
                <span className="skel cat-skel-icon"></span>
                <span className="skel" style={{ width: '240px', height: '60px' }}></span>
                <span className="skel skel-line" style={{ width: '220px' }}></span>
                <span style={{ marginLeft: 'auto' }}></span>
                <span className="skel cat-skel-btn"></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
