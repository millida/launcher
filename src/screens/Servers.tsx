import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { FilterPill } from '../components/FilterPill'
import { ServerRow } from '../components/ServerRow'
import { openExt } from '../lib/api'
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
              placeholder="Поиск серверов…"
              value={q}
              onChange={(e) => {
                typed.current = true
                setQ(e.target.value)
              }}
            />
          </div>
          <button
            className="btn sm primary"
            data-sound="open"
            title="Добавить свой сервер в рейтинг на сайте"
            onClick={() => openExt(RATING_ADD_URL)}
          >
            <Icon id="i-plus" />
            Добавить свой сервер
          </button>
        </div>
      </div>

      <div className="mods-filters">
        <FilterPill
          icon="i-grid"
          label="Категория"
          defaultValue=""
          value={category}
          width={200}
          options={SERVER_TABS.map(([label, code]) => ({ value: code, label }))}
          onPick={(v) => void loadLiveRating({ category: v })}
        />
        <FilterPill
          icon="i-filter"
          label="Сортировка"
          defaultValue={DEFAULT_FILTERS.sort}
          value={sort}
          width={180}
          options={SORTS.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => void loadLiveRating({ sort: v })}
        />
        <FilterPill
          icon="i-key"
          label="Лицензия"
          defaultValue=""
          value={license}
          width={190}
          options={LICENSES.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => void loadLiveRating({ license: v })}
        />
        <FilterPill
          icon="i-users"
          label="Онлайн"
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
          <button type="button" className="mk-pill" onClick={reset}>
            <Icon id="i-x" />
            <span>Сбросить</span>
          </button>
        ) : null}
      </div>

      {status === 'error' ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '6px' }}>Рейтинг серверов недоступен</div>
          <p className="faint-note" style={{ maxWidth: '440px', margin: '0 auto 14px', lineHeight: 1.55 }}>
            Не удалось получить данные Millida Rating{error ? ' (' + error + ')' : ''}. Старый список показывать не
            будем — он был бы неактуальным.
          </p>
          <button className="btn sm secondary" onClick={() => void loadLiveRating()}>
            <Icon id="i-restart" />
            Попробовать снова
          </button>
        </div>
      ) : list.length ? (
        <>
          <div className="stack" id="srvList">
            {list.map((sv, i) => (
              <ServerRow key={sv.slug + i} sv={sv} />
            ))}
          </div>
          {hasMore ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
              <button className="btn md secondary" disabled={loadingMore} onClick={() => void loadMoreServers()}>
                {loadingMore ? 'Загружаем…' : 'Показать ещё ' + Math.min(PAGE_SIZE, total - list.length)}
              </button>
            </div>
          ) : null}
          <p className="faint-note">
            {'Показано ' +
              list.length +
              ' из ' +
              total +
              (filtered ? ' подходящих серверов' : ' серверов Millida Rating') +
              '. Лаунчер сам подберёт версию и моды под сервер — жми «Играть».'}
          </p>
        </>
      ) : status === 'ok' ? (
        <p className="faint-note">
          {filtered
            ? search.trim()
              ? 'По запросу «' + search.trim() + '» в каталоге ничего нет.'
              : 'Под выбранные фильтры серверов нет — сбрось часть условий.'
            : 'В этой категории серверов пока нет.'}
        </p>
      ) : (
        <div className="stack">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card skel-card" style={{ padding: '16px' }}>
              <div className="skel-row">
                <span className="skel" style={{ width: '44px', height: '44px', borderRadius: '10px' }}></span>
                <span className="skel skel-line" style={{ width: '220px' }}></span>
                <span style={{ marginLeft: 'auto' }}></span>
                <span
                  className="skel skel-line"
                  style={{ width: '110px', height: '32px', borderRadius: '999px' }}
                ></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
