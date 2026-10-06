import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../Icon'
import { api, mirrorAsset } from '../../lib/api'
import { hasTauri } from '../../ipc/tauri'
import { loadProfileSettings, millidaPacks } from '../../ipc/commands'
import type { MillidaPack } from '../../ipc/commands'
import { backdropClose } from '../../lib/dismiss'
import { RU_LOADER } from '../../lib/format'
import { useLobby } from '../../state/lobbyMode'
import { GENRES, downloadsShort, genresOf, shortPitch, shortTitle } from './premiumPackData'
import { realDownloads } from '../../lib/realDownloads'
import { useProfiles } from '../../state/profiles'

/*
 * Студия и эксклюзив премиум-сборки (PremiumPackPage):
 * - StudioModal — все сборки студии из нашего каталога (поле partner), клик
 *   ведёт на страницу сборки тем же путём, что «Рекомендуем» (hubTarget);
 * - useStudioCount — сколько премиум-сборок у студии (чип студии в герое).
 */

let listCache: Promise<MillidaPack[]> | null = null
function catalogPacks(): Promise<MillidaPack[]> {
  if (!listCache)
    listCache = (hasTauri() ? millidaPacks() : api<MillidaPack[]>('/catalog/packs'))
      .then((l) => (Array.isArray(l) ? l : []))
      .catch((e) => {
        listCache = null
        throw e
      })
  return listCache
}

/** Премиум-сборок у студии в каталоге; нет данных — null. */
export function useStudioCount(slug: string | null | undefined): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!slug) return
    let alive = true
    catalogPacks()
      .then((l) => alive && setN(l.filter((p) => p.partner?.slug === slug && p.accessRequired && !p.preview).length || null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [slug])
  return n
}

export { packWord }

/** Прокрутка экрана хаба наверх — новая сборка открывается с героя. */
function scrollTop() {
  requestAnimationFrame(() => {
    let box = document.querySelector('.ppx')?.parentElement || null
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    box?.scrollTo({ top: 0 })
  })
}

function packWord(n: number): string {
  const d = n % 10
  const h = n % 100
  if (d === 1 && h !== 11) return 'сборка'
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'сборки'
  return 'сборок'
}

/** Слаги наших сборок, которые уже стоят на компьютере. */
function useInstalledSlugs(): Set<string> {
  const profiles = useProfiles((s) => s.profiles)
  const [slugs, setSlugs] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!hasTauri()) return
    let alive = true
    void Promise.all(profiles.map((p) => loadProfileSettings(p.name).catch(() => null))).then((all) => {
      if (!alive) return
      const out = new Set<string>()
      for (const st of all) {
        if (st?.catalogPackSlug) out.add(st.catalogPackSlug)
        if (st?.modpackSlug) out.add(st.modpackSlug)
      }
      setSlugs(out)
    })
    return () => {
      alive = false
    }
  }, [profiles])
  return slugs
}

export function StudioModal({
  studio,
  current,
  onClose,
}: {
  studio: { slug: string; name: string }
  current: string
  onClose: () => void
}) {
  const [list, setList] = useState<MillidaPack[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const installed = useInstalledSlugs()

  useEffect(() => {
    let alive = true
    setFailed(false)
    catalogPacks()
      .then((l) => alive && setList(l.filter((p) => p.partner?.slug === studio.slug && !p.preview)))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [studio.slug, tick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Настоящие скачивания (без ручной «стартовой» прибавки) и жанры по словам.
  const rows = useMemo(
    () =>
      (list || []).map((p) => ({
        p,
        dl: realDownloads(p.slug, p.downloads) || 0,
        genres: genresOf(p.title, p.summary || ''),
      })),
    [list],
  )
  // Место в топе — по скачиваниям среди всех сборок студии, не по фильтру.
  const rank = useMemo(() => {
    const m = new Map<string, number>()
    rows
      .slice()
      .sort((a, b) => b.dl - a.dl)
      .slice(0, 3)
      .forEach((r, i) => r.dl > 0 && m.set(r.p.slug, i + 1))
    return m
  }, [rows])
  const genres = useMemo(
    () =>
      GENRES.map((g) => ({ ...g, n: rows.filter((r) => r.genres.includes(g.id)).length })).filter((g) => g.n >= 2),
    [rows],
  )
  const prem = rows.filter((r) => r.p.accessRequired).length
  const query = q.trim().toLowerCase()
  const shown = rows
    .filter((r) => !genre || r.genres.includes(genre))
    .filter((r) => !query || (r.p.title + ' ' + r.p.summary).toLowerCase().includes(query))
    .sort((a, b) => b.dl - a.dl)

  const open = (p: MillidaPack) => {
    onClose()
    if (p.slug === current) return
    useLobby.setState({ hubTarget: { pack: p.slug } })
    scrollTop()
  }

  return (
    <div className="modal-bg open vis ppx-studio-bg" {...backdropClose(onClose)}>
      <div className="modal ppx-studio-modal" role="dialog" aria-label={'Сборки ' + studio.name} data-section="studio_packs" data-id={studio.slug}>
        <header className="ppx-sm-head">
          <span className="ppx-sm-seal" aria-hidden="true">
            <Icon id="i-crown" />
          </span>
          <div>
            <span className="ppx-sm-kicker">
              Проверенная студия <Icon id="i-check" />
            </span>
            <h3>{studio.name}</h3>
            <span className="ppx-sm-sub">
              {list ? list.length + ' ' + packWord(list.length) + (prem ? ' · ' + prem + ' премиум' : '') : 'Сборки студии'}
            </span>
          </div>
          <button className="ppx-sm-x" aria-label="Закрыть" data-track="studio_close" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        </header>

        {list && list.length > 1 ? (
          <div className="ppx-sm-tools">
            <div className="ppx-sm-chips-row" role="group" aria-label="Жанр">
              <button
                className={'ppx-sm-chip' + (!genre ? ' on' : '')}
                aria-pressed={!genre}
                data-track="studio_genre"
                data-id="all"
                onClick={() => setGenre(null)}
              >
                <Icon id="i-flame" /> Топ
              </button>
              {genres.map((g) => (
                <button
                  key={g.id}
                  className={'ppx-sm-chip' + (genre === g.id ? ' on' : '')}
                  aria-pressed={genre === g.id}
                  data-track="studio_genre"
                  data-id={g.id}
                  onClick={() => setGenre(genre === g.id ? null : g.id)}
                >
                  {g.label} <i>{g.n}</i>
                </button>
              ))}
            </div>
            {list.length > 6 ? (
              <label className="input ppx-sm-search">
                <Icon id="i-search" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти сборку" aria-label="Найти сборку" />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="ppx-sm-scroll">
          <div className="ppx-sm-grid">
            {failed ? (
              <div className="ppx-sm-empty">
                <span>Список не загрузился</span>
                <button className="btn sm secondary" onClick={() => setTick(tick + 1)}>
                  <Icon id="i-restart" /> Повторить
                </button>
              </div>
            ) : !list ? (
              Array.from({ length: 8 }, (_, i) => <span key={i} className="skel ppx-sm-skel" />)
            ) : shown.length ? (
              shown.map(({ p, dl }) => {
                const top = rank.get(p.slug)
                const here = p.slug === current
                const have = installed.has(p.slug)
                return (
                  <button
                    key={p.slug}
                    className={'ppx-sm-card' + (here ? ' on' : '') + (p.accessRequired ? ' prem' : '') + (top ? ' top' : '')}
                    aria-current={here ? 'page' : undefined}
                    data-track="studio_pack"
                    data-id={p.slug}
                    onClick={() => open(p)}
                  >
                    <span className="ppx-sm-art">
                      {p.cover ? <img src={mirrorAsset(p.cover)} alt="" loading="lazy" draggable={false} /> : null}
                      {here ? (
                        <span className="ppx-sm-tag here">Вы здесь</span>
                      ) : p.accessRequired ? (
                        <span className="ppx-sm-tag gold">
                          <Icon id="i-crown" /> Премиум
                        </span>
                      ) : null}
                      {have ? (
                        <span className="ppx-sm-tag have">
                          <Icon id="i-check" /> Установлено
                        </span>
                      ) : null}
                      {top ? (
                        <span className="ppx-sm-rank" aria-label={'Топ ' + top}>
                          <i>#</i>
                          {top}
                        </span>
                      ) : null}
                    </span>
                    <span className="ppx-sm-body">
                      <b title={p.title}>{shortTitle(p.title)}</b>
                      {p.summary ? <span className="ppx-sm-pitch">{shortPitch(p.summary)}</span> : null}
                      <span className="ppx-sm-meta">
                        {p.game ? <span>{p.game}</span> : null}
                        {p.loader ? <span>{RU_LOADER(p.loader)}</span> : null}
                        {dl > 0 ? (
                          <em title={dl.toLocaleString('ru-RU') + ' скачиваний'}>
                            <Icon id="i-download" />
                            {downloadsShort(dl)}
                          </em>
                        ) : null}
                      </span>
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="ppx-sm-empty">
                <span>{query ? 'Ничего не нашли по «' + q + '»' : 'В этом жанре сборок нет'}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
