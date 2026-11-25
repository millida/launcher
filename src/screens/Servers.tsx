import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { RatingRow, RatingRowSkel } from '../components/RatingRow'
import { RemoteScreen } from '../components/RemoteScreen'
import { api, openExt } from '../lib/api'
import { quickJoin } from '../lib/joinServer'
import { joinAddr } from '../lib/ownServer'
import { prefetchRemoteScreen, remoteUiEnabled } from '../lib/remoteUi'
import { makeRemoteBridge } from '../lib/remoteUiBridge'
import { sitePath, type RemoteJoinServer } from '../lib/remoteUiRules'
import type { SnapshotServer } from '../lib/snapshot'
import { serverMode, useLobby } from '../state/lobbyMode'
import { openServerDetail } from '../state/serverDetail'
import { setScreen } from '../state/ui'
import { track } from '../lib/telemetry'
import { searchTerm } from '../components/playhub/data'
import { useRatingFeed, type FeedSortId } from '../state/ratingFeed'
import { t, useT } from '../i18n'
import { toRatingCard } from '../state/ratingCard'
import type { RatingServer } from '../state/servers'

const SORTS = (): [FeedSortId, string][] => [
  ['rating', t('По рейтингу')],
  ['online', t('По онлайну')],
  ['votes', t('По голосам')],
  ['new', t('Новые')],
]

export const RATING_ADD_URL = 'https://millida.net/rating/add'
export const RATING_BOOST_URL = 'https://millida.net/rating/boost'
const STEP = 20
/** The built-in list answers from the API at once, so the site's screen gets this long to load its code. */
export const REMOTE_DEADLINE_MS = 6000

const RATING_SERVER = /^(?:\/[a-z]{2}(?:-[A-Za-z]{2})?)?\/rating\/servers\/([\w.-]+)\/?$/
const HOSTING = /^(?:\/[a-z]{2}(?:-[A-Za-z]{2})?)?\/hosting\/?$/

/** A server from the website rating joins like a row of the built-in list: the lobby remembers it, then the game starts. */
export async function joinFromRating(srv: RemoteJoinServer): Promise<void> {
  const sv: SnapshotServer = {
    rank: 0,
    name: srv.name,
    slug: srv.slug || '',
    desc: '',
    ip: srv.address,
    online: 0,
    isOnline: true,
    banner: srv.banner || undefined,
    logo: srv.logo || undefined,
    versions: srv.version ? [srv.version] : [],
    cat: '',
    motd: '',
    lic: srv.licensed ? 'LICENSE' : '',
  }
  useLobby.getState().pick(serverMode(sv))
  await quickJoin(joinAddr(sv), sv.name || t('Сервер'), !!srv.licensed, sv.versions, sv.slug || undefined).catch(() => {})
}

/** The server card opens the launcher's own card with «Играть»; if the rating does not answer, the site page opens. */
async function openRatingServer(slug: string, path: string): Promise<void> {
  try {
    openServerDetail(toRatingCard(await api<RatingServer>('/rating/servers/' + encodeURIComponent(slug)), 0))
  } catch {
    const url = sitePath(path)
    if (url) openExt(url)
  }
}

/**
 * «Серверы» must open at once, so the site's screen is put on disk ahead of the click: this chunk is preloaded while
 * the lobby is idle. Spread out, so a site release is not fetched by every launcher in one second.
 */
if (typeof window !== 'undefined' && 'indexedDB' in window) window.setTimeout(() => void prefetchRemoteScreen('rating'), 3_000 + Math.random() * 12_000)

/** Страница сервера открывается на экране «Серверы»: блок библиотеки и плитки передают адрес через него. */
let startPath: string | undefined
function takeStartPath(): string | undefined {
  const p = startPath
  startPath = undefined
  return p
}

export function openServerPage(path: string): boolean {
  if (!RATING_SERVER.test(path.split(/[?#]/)[0]!)) return openRatingPath(path)
  startPath = path
  setScreen('servers')
  return true
}

export function openRatingPath(path: string): boolean {
  const route = path.split(/[?#]/)[0]!
  const server = RATING_SERVER.exec(route)
  if (server) {
    void openRatingServer(server[1]!, path)
    return true
  }
  if (HOSTING.test(route)) {
    setScreen('hosting')
    return true
  }
  return false
}

/**
 * The rating is the website's /rating screen (catalog, modes, versions, new servers) from the site bundle; the
 * built-in list stays for launchers whose bundle is missing, unsigned or older than the rating screen.
 */
export function Servers({ on }: { on: boolean }) {
  const [remoteFailed, setRemoteFailed] = useState(false)
  if (remoteUiEnabled() && !remoteFailed)
    return (
      <section className={'screen' + (on ? ' on' : '')} id="s-servers">
        <RemoteScreen
          screen="rating"
          deadlineMs={REMOTE_DEADLINE_MS}
          onFail={() => setRemoteFailed(true)}
          bridge={() => makeRemoteBridge({ join: joinFromRating, navigate: openRatingPath, startPath: takeStartPath() })}
        />
      </section>
    )
  return <NativeServers on={on} />
}

/**
 * «Серверы»: весь рейтинг millida.net/rating строками — тот же запрос и порядок мест,
 * поиск, четыре сортировки, подгрузка по 20. Обновляется при открытии и возврате в окно.
 */
function NativeServers({ on }: { on: boolean }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<FeedSortId>('rating')
  useEffect(() => {
    const h = window.setTimeout(() => setSearch(q.trim().length >= 2 ? searchTerm(q) : ''), 350)
    return () => window.clearTimeout(h)
  }, [q])
  const feed = useRatingFeed({ sort, search, step: STEP, on })

  // Аналитика поиска: длина запроса и число найденных, без текста.
  const sent = useRef('')
  useEffect(() => {
    if (!search || feed.state !== 'ok' || sent.current === search) return
    const h = window.setTimeout(() => {
      sent.current = search
      track('catalog_search', { section: 'servers', len: search.length, results: feed.total })
    }, 800)
    return () => window.clearTimeout(h)
  }, [search, feed.state, feed.total])

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-servers">
      <div className="page-head">
        <h1>{t('Серверы')}</h1>
        <div className="right">
          <button className="btn sm secondary" data-sound="open" data-track="rating_add_server" onClick={() => openExt(RATING_ADD_URL)}>
            <Icon id="i-plus" />
            {t('Свой сервер')}
          </button>
        </div>
      </div>

      <div className="rt-tools">
        <label className="input rt-find">
          <Icon id="i-search" />
          <input value={q} placeholder={t('Имя или адрес')} maxLength={60} onChange={(e) => setQ(e.target.value)} />
          {q ? (
            <button type="button" className="hs-clear" aria-label={t('Очистить')} onClick={() => setQ('')}>
              <Icon id="i-x" />
            </button>
          ) : null}
        </label>
        <div className="segs" role="group" aria-label={t('Сортировка')}>
          {SORTS().map(([id, label]) => (
            <button key={id} type="button" className={'seg' + (sort === id ? ' on' : '')} aria-pressed={sort === id} data-track={'servers_sort_' + id} onClick={() => setSort(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {feed.state === 'error' ? (
        <div className="cat-empty">
          <span className="cat-empty-ic">
            <Icon id="i-alert" />
          </span>
          <b>{t('Серверы не загрузились')}</b>
          <button className="btn md primary" data-track="retry" onClick={feed.retry}>
            <Icon id="i-restart" />
            {t('Повторить')}
          </button>
        </div>
      ) : feed.state === 'loading' ? (
        <div className="rt-list">
          <RatingRowSkel n={8} />
        </div>
      ) : feed.list.length ? (
        <>
          <div className="rt-list" data-section="servers" data-src={search ? 'server_search' : 'servers_screen'}>
            {feed.list.map((sv, i) => (
              <RatingRow key={sv.slug + ':' + i} sv={sv} place={i + 1} src="servers_screen" />
            ))}
          </div>
          {feed.hasMore ? (
            <div className="rt-foot">
              <button className={'btn md secondary' + (feed.busy ? ' cat-busy' : '')} disabled={feed.busy} data-track="load_more" onClick={feed.more}>
                {t('Показать ещё {n}', { n: Math.min(STEP, feed.total - feed.list.length) })}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="cat-empty">
          <span className="cat-empty-ic">
            <Icon id="i-search" />
          </span>
          <b>{t('Ничего не нашли')}</b>
        </div>
      )}
    </section>
  )
}
