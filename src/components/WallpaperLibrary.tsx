import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '../ipc/commands'
import { backdropClose } from '../lib/dismiss'
import { apiErrorText } from '../lib/apiError'
import { showLogin } from '../lib/session'
import { useHasMillida } from '../state/auth'
import { fetchLibrary, fetchMine, installFromLibrary, publishOwn, removeOwn, toggleLike } from '../lib/wallpaperLib'
import { NAME_MAX, countText, draftName, statusText, type OwnWallpaper, type WallpaperCard } from '../lib/wallpaperLibFormat'
import { useLocale, useT } from '../i18n'
import { Icon } from './Icon'
import { Segs } from './SetKit'
import { closeWallpaperLibrary, useWallpaperLibrary, type LibrarySort, type LibraryTab } from './wallpaperLibStore'
import '../styles/pixel/wplib.css'

type Load<T> = { state: 'loading' } | { state: 'error'; text: string } | ({ state: 'ready' } & T)

const SEARCH_DELAY_MS = 300
const SKELETONS = [0, 1, 2, 3, 4, 5]

export function WallpaperLibrary() {
  const t = useT()
  const locale = useLocale()
  const open = useWallpaperLibrary((s) => s.open)
  const tab = useWallpaperLibrary((s) => s.tab)
  const draft = useWallpaperLibrary((s) => s.draft)

  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<Load<{ items: WallpaperCard[]; total: number }>>({ state: 'loading' })
  const [more, setMore] = useState(false)
  const [mine, setMine] = useState<Load<{ items: OwnWallpaper[] }>>({ state: 'loading' })
  const [installing, setInstalling] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const listSeq = useRef(0)
  const mineSeq = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const loadList = (sort: LibrarySort, text: string) => {
    const seq = ++listSeq.current
    setList({ state: 'loading' })
    setMore(false)
    fetchLibrary(sort, text, 0)
      .then((page) => {
        if (seq === listSeq.current) setList({ state: 'ready', items: page.items ?? [], total: page.total ?? 0 })
      })
      .catch((e) => {
        if (seq === listSeq.current) setList({ state: 'error', text: apiErrorText(e, t('Библиотека не загрузилась — повтори через минуту')) })
      })
  }

  const loadMore = (sort: LibrarySort) => {
    if (list.state !== 'ready') return
    const seq = listSeq.current
    setMore(true)
    fetchLibrary(sort, query, list.items.length)
      .then((page) => {
        if (seq !== listSeq.current) return
        setList((prev) => {
          if (prev.state !== 'ready') return prev
          const known = new Set(prev.items.map((c) => c.id))
          return { state: 'ready', items: [...prev.items, ...(page.items ?? []).filter((c) => !known.has(c.id))], total: page.total ?? prev.total }
        })
      })
      .catch((e) => {
        if (seq === listSeq.current) setList({ state: 'error', text: apiErrorText(e, t('Библиотека не загрузилась — повтори через минуту')) })
      })
      .finally(() => {
        if (seq === listSeq.current) setMore(false)
      })
  }

  const loadMine = () => {
    const seq = ++mineSeq.current
    setMine({ state: 'loading' })
    fetchMine()
      .then((items) => {
        if (seq === mineSeq.current) setMine({ state: 'ready', items: Array.isArray(items) ? items : [] })
      })
      .catch((e) => {
        if (seq === mineSeq.current) setMine({ state: 'error', text: apiErrorText(e, t('Твои фоны не загрузились — повтори через минуту')) })
      })
  }

  const signedIn = useHasMillida()

  useEffect(() => {
    if (!open) return
    if (tab === 'mine') {
      if (signedIn) loadMine()
    } else loadList(tab, query)
  }, [open, tab, query, signedIn])

  useEffect(() => {
    if (open) setName(draftName(draft?.name))
  }, [open, draft])

  useEffect(() => () => clearTimeout(searchTimer.current), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWallpaperLibrary()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const patchCard = (id: string, patch: Partial<WallpaperCard>) =>
    setList((prev) => (prev.state === 'ready' ? { ...prev, items: prev.items.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : prev))

  const like = (card: WallpaperCard) => {
    void toggleLike(card).then((r) => {
      if (r) patchCard(card.id, r)
    })
  }

  const install = (card: WallpaperCard) => {
    if (installing) return
    setInstalling(card.id)
    void installFromLibrary(card)
      .then((downloads) => {
        if (downloads !== null) patchCard(card.id, { downloads })
      })
      .finally(() => setInstalling(null))
  }

  const publish = () => {
    if (!draft || publishing || !name.trim()) return
    setPublishing(true)
    void publishOwn(draft.path, name)
      .then((ok) => {
        if (!ok) return
        useWallpaperLibrary.setState({ draft: null })
        loadMine()
      })
      .finally(() => setPublishing(false))
  }

  const remove = (w: OwnWallpaper) => {
    void removeOwn(w).then((ok) => {
      if (ok) setMine((prev) => (prev.state === 'ready' ? { ...prev, items: prev.items.filter((x) => x.id !== w.id) } : prev))
    })
  }

  const onSearch = (value: string) => {
    setQ(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setQuery(value.trim()), SEARCH_DELAY_MS)
  }

  const tabs: [LibraryTab, string][] = [
    ['popular', t('Популярные')],
    ['new', t('Новые')],
    ['liked', t('Любимые')],
    ['mine', t('Мои')],
  ]

  const libraryView =
    list.state === 'loading' ? (
      <div className="wplib-grid" aria-busy="true">
        {SKELETONS.map((i) => (
          <div key={i} className="wplib-card skel" />
        ))}
      </div>
    ) : list.state === 'error' ? (
      <div className="wplib-state">
        <span>{list.text}</span>
        <button className="btn sm secondary" onClick={() => tab !== 'mine' && loadList(tab, query)}>
          {t('Повторить')}
        </button>
      </div>
    ) : list.items.length ? (
      <>
        <div className="wplib-grid">
          {list.items.map((c) => (
            <article key={c.id} className="wplib-card">
              <div className="wplib-thumb">
                <img src={c.thumbUrl} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="wplib-info">
                <b className="wplib-name">{c.name}</b>
                <span className="wplib-author">{c.author}</span>
              </div>
              <div className="wplib-acts">
                <button
                  className={'wplib-like' + (c.liked ? ' on' : '')}
                  aria-pressed={c.liked}
                  aria-label={t('Нравится')}
                  onClick={() => like(c)}
                >
                  <Icon id={c.liked ? 'i-heart' : 'i-heart-off'} />
                  <span>{countText(c.likes, locale)}</span>
                </button>
                <span className="wplib-dl" aria-label={t('Скачиваний: {n}', { n: c.downloads })}>
                  <Icon id="i-download" />
                  <span>{countText(c.downloads, locale)}</span>
                </span>
                <button className="btn sm primary wplib-set" disabled={installing !== null} onClick={() => install(c)}>
                  {installing === c.id ? t('Ставим…') : t('Поставить')}
                </button>
              </div>
            </article>
          ))}
        </div>
        {list.items.length < list.total && tab !== 'mine' ? (
          <button className="btn sm secondary wplib-more" disabled={more} onClick={() => loadMore(tab)}>
            {t('Показать ещё')}
          </button>
        ) : null}
      </>
    ) : (
      <div className="wplib-state">{query ? t('Ничего не нашли') : t('Фонов пока нет')}</div>
    )

  const draftView = draft ? (
    <form
      className="wplib-draft"
      onSubmit={(e) => {
        e.preventDefault()
        publish()
      }}
    >
      <div className="wplib-thumb">
        <img src={convertFileSrc(draft.path)} alt="" />
      </div>
      <div className="wplib-draft-body">
        <div className="input sm">
          <input
            value={name}
            maxLength={NAME_MAX}
            placeholder={t('Название')}
            aria-label={t('Название')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="wplib-draft-acts">
          <button type="submit" className="btn sm primary" disabled={publishing || !name.trim()}>
            {publishing ? t('Отправляем…') : t('Опубликовать')}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => useWallpaperLibrary.setState({ draft: null })}>
            {t('Отмена')}
          </button>
        </div>
      </div>
    </form>
  ) : null

  const mineView = !signedIn ? (
    <div className="wplib-state">
      <span>{t('Войди в Millida, чтобы публиковать фоны')}</span>
      <button
        className="btn sm primary"
        onClick={() => {
          closeWallpaperLibrary()
          showLogin()
        }}
      >
        {t('Войти')}
      </button>
    </div>
  ) : (
    <>
      {draftView}
      {mine.state === 'loading' ? (
        <div className="wplib-rows" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="wplib-row skel" />
          ))}
        </div>
      ) : mine.state === 'error' ? (
        <div className="wplib-state">
          <span>{mine.text}</span>
          <button className="btn sm secondary" onClick={loadMine}>
            {t('Повторить')}
          </button>
        </div>
      ) : mine.items.length ? (
        <div className="wplib-rows">
          {mine.items.map((w) => (
            <div key={w.id} className="wplib-row">
              <div className="wplib-thumb">
                <img src={w.thumbUrl} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="wplib-info">
                <b className="wplib-name">{w.name}</b>
                <span className={'wplib-status ' + w.status.toLowerCase()}>{statusText(w)}</span>
              </div>
              <button className="btn sm ghost wplib-del" aria-label={t('Удалить')} onClick={() => remove(w)}>
                <Icon id="i-trash" />
              </button>
            </div>
          ))}
        </div>
      ) : draft ? null : (
        <div className="wplib-state">{t('Ты ещё не публиковал фоны')}</div>
      )}
    </>
  )

  return (
    <div className="modal-bg open vis" style={{ zIndex: 960 }} {...backdropClose(closeWallpaperLibrary)}>
      <div className="modal mw-lg wplib" role="dialog" aria-modal="true" aria-label={t('Библиотека фонов')}>
        <div className="wplib-head">
          <h3>{t('Библиотека фонов')}</h3>
          <button className="btn sm ghost wplib-x" aria-label={t('Закрыть')} onClick={closeWallpaperLibrary}>
            <Icon id="i-x" />
          </button>
        </div>
        <div className="wplib-bar">
          <Segs<LibraryTab> value={tab} options={tabs} onPick={(v) => useWallpaperLibrary.setState({ tab: v })} />
          {tab !== 'mine' ? (
            <div className="input sm wplib-search">
              <Icon id="i-search" />
              <input
                type="search"
                value={q}
                placeholder={t('Поиск')}
                aria-label={t('Поиск')}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>
          ) : null}
        </div>
        <div className="wplib-body">{tab === 'mine' ? mineView : libraryView}</div>
      </div>
    </div>
  )
}
