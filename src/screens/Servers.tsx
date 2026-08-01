import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { FilterPill } from '../components/FilterPill'
import { ServerRow } from '../components/ServerRow'
import type { SnapshotServer } from '../lib/snapshot'
import { PAGE_SIZE, SERVER_TABS, loadLiveRating, loadMoreServers, useServers } from '../state/servers'

const SORTS: [string, string][] = [
  ['rating', 'По рейтингу'],
  ['online', 'По онлайну'],
  ['name', 'По названию'],
  ['fresh', 'Сначала новые'],
]

const LICENSES: [string, string][] = [
  ['', 'Любая лицензия'],
  ['CRACKED', 'Без лицензии'],
  ['LICENSE', 'Только лицензия'],
]

const ONLINE_FILTERS: [string, string][] = [
  ['', 'Любой онлайн'],
  ['live', 'Сейчас есть игроки'],
  ['20', 'От 20 игроков'],
  ['100', 'От 100 игроков'],
]

export function Servers({ on }: { on: boolean }) {
  const { list, promo, total, status, error, loadingMore, category } = useServers()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('rating')
  const [license, setLicense] = useState('')
  const [onlineF, setOnlineF] = useState('')
  const [version, setVersion] = useState('')

  const versions = Array.from(new Set(list.concat(promo).flatMap((sv) => sv.versions || []))).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )

  const term = q.trim().toLowerCase()
  const minOnline = onlineF === 'live' ? 1 : Number(onlineF || 0)
  const match = (sv: SnapshotServer) =>
    (!term ||
      sv.name.toLowerCase().includes(term) ||
      (sv.ip || '').toLowerCase().includes(term) ||
      (sv.desc || '').toLowerCase().includes(term)) &&
    (!license || sv.lic === license) &&
    (!minOnline || (sv.online || 0) >= minOnline) &&
    (!version || (sv.versions || []).includes(version))

  const sortFn = (a: SnapshotServer, b: SnapshotServer) =>
    sort === 'online'
      ? (b.online || 0) - (a.online || 0)
      : sort === 'name'
        ? a.name.localeCompare(b.name, 'ru')
        : sort === 'fresh'
          ? b.rank - a.rank
          : a.rank - b.rank

  const shownPromo = promo.filter(match)
  const shown = list.filter(match).sort(sortFn)
  const filtered = !!(term || license || onlineF || version)

  // Filters run over already loaded pages (30 per request), so keep pulling until one matches.
  useEffect(() => {
    if (!on || !filtered) return
    if (shown.length || shownPromo.length) return
    if (status !== 'ok' || loadingMore || list.length >= total) return
    void loadMoreServers()
  }, [on, filtered, shown.length, shownPromo.length, status, loadingMore, list.length, total])
  const hasMore = list.length < total

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-servers">
      <div className="page-head">
        <h1>Серверы</h1>
        <div className="right">
          <div className="input sm" style={{ width: '240px' }}>
            <Icon id="i-search" />
            <input placeholder="Поиск серверов…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mods-filters">
        <FilterPill
          icon="i-grid"
          label="Категория"
          defaultValue={SERVER_TABS[0] ? SERVER_TABS[0][1] : ''}
          value={category}
          width={200}
          options={SERVER_TABS.map(([label, code]) => ({ value: code, label }))}
          onPick={(v) => void loadLiveRating(v)}
        />
        <FilterPill
          icon="i-filter"
          label="Сортировка"
          defaultValue="rating"
          value={sort}
          width={180}
          options={SORTS.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => setSort(v)}
        />
        <FilterPill
          icon="i-key"
          label="Лицензия"
          defaultValue=""
          value={license}
          width={190}
          options={LICENSES.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => setLicense(v)}
        />
        <FilterPill
          icon="i-users"
          label="Онлайн"
          defaultValue=""
          value={onlineF}
          width={190}
          options={ONLINE_FILTERS.map(([v, label]) => ({ value: v, label }))}
          onPick={(v) => setOnlineF(v)}
        />
        {versions.length ? (
          <FilterPill
            icon="i-box2"
            label="Версия"
            defaultValue=""
            value={version}
            width={160}
            options={[{ value: '', label: 'Любая версия' }].concat(versions.map((v) => ({ value: v, label: v })))}
            onPick={(v) => setVersion(v)}
          />
        ) : null}
        {license || onlineF || version || sort !== 'rating' ? (
          <button
            type="button"
            className="mk-pill"
            onClick={() => {
              setQ('')
              setLicense('')
              setOnlineF('')
              setVersion('')
              setSort('rating')
            }}
          >
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
      ) : list.length || promo.length ? (
        <>
          <div className="stack" id="srvList">
            {shownPromo.map((sv) => (
              <ServerRow key={'promo-' + sv.slug} sv={sv} promo />
            ))}
            {shown.map((sv, i) => (
              <ServerRow key={sv.slug + i} sv={sv} />
            ))}
          </div>
          {filtered && !shown.length && !shownPromo.length ? (
            <p className="faint-note">
              {hasMore
                ? 'Ищем дальше по каталогу — фильтр применяется к уже загруженным страницам…'
                : term
                  ? 'По запросу «' + q + '» в каталоге ничего нет.'
                  : 'Под выбранные фильтры серверов нет — сбрось часть условий.'}
            </p>
          ) : null}
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
              ' серверов Millida Rating. Лаунчер сам подберёт версию и моды под сервер — жми «Играть».'}
          </p>
        </>
      ) : status === 'ok' ? (
        <p className="faint-note">В этой категории серверов пока нет.</p>
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
