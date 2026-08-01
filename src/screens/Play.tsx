import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { ServerRow } from '../components/ServerRow'
import { MusicControls } from '../components/MusicPop'
import { useMusic } from '../state/music'
import { useHeroWallpaper } from '../components/HeroWallpaper'
import { LOADER_NAME, RU_LOADER, fmt, fmtPlaytime } from '../lib/format'
import { VIDEOS } from '../lib/wallpaper'
import { hasTauri } from '../ipc/tauri'
import { useProfiles } from '../state/profiles'
import { useServers } from '../state/servers'
import { useWallpaper } from '../state/wallpaper'
import { convertFileSrc, pickWallpaper } from '../ipc/commands'
import { useMods } from '../state/mods'
import { useModpackVersions } from '../state/modpack'
import { openModal, setScreen, showToast } from '../state/ui'
import { openProject } from '../state/project'
import { openBuildSettings } from '../state/instance'
import { useModUpdates } from '../state/modUpdates'
import { usePlayStats } from '../state/playStats'
import { realLaunch, startPrelaunch } from '../lib/launch'
import { stopRunningGame, useGame } from '../state/game'

interface ReadyHit {
  slug: string
  title: string
  icon_url?: string
  description?: string
  downloads: number
  cats: string[]
}

// Module-level cache: the screen remounts on every visit, the list changes daily.
let readyCache: { at: number; hits: ReadyHit[] } | null = null
const READY_TTL = 600000

function ReadyCard({ h }: { h: ReadyHit }) {
  return (
    <div
      className="card hoverable build-card ready-card"
      data-slug={h.slug}
      data-title={h.title}
      onClick={() => void openProject(h.slug, 'modpack')}
    >
      <span className="build-cover">
        <Cover url={h.icon_url} />
        <span
          className="mini-play ready-go"
          title="Выбрать версию и установить"
          onClick={(e) => {
            e.stopPropagation()
            void useModpackVersions.getState().openInstall(h.slug, h.title)
          }}
        >
          <Icon id="i-download" />
        </span>
      </span>
      <span className="build-body">
        <b>{h.title}</b>
        {h.description ? <span className="desc">{h.description}</span> : null}
        <span className="meta">
          {fmt(h.downloads) + ' скачиваний · ' + (h.cats.map(RU_LOADER).slice(0, 2).join(' · ') || 'Modrinth')}
        </span>
      </span>
    </div>
  )
}

export function Play({ on }: { on: boolean }) {
  const profiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const setSelected = useProfiles((s) => s.setSelected)
  const refresh = useProfiles((s) => s.refresh)
  const servers = useServers((s) => s.list)
  const wp = useWallpaper()
  const hero = useHeroWallpaper(on)
  const setMusicOpen = useMusic((s) => s.setOpen)
  const updates = useModUpdates()
  const [ready, setReady] = useState<ReadyHit[] | null>(null)
  const [readyErr, setReadyErr] = useState('')
  const playStats = usePlayStats((s) => s.stats)
  const gameRunning = useGame((s) => s.running)
  const gameStopping = useGame((s) => s.stopping)
  const hoursOf = (name: string) => playStats.builds.find((b) => b.key === name) || null

  useEffect(() => {
    if (on && profiles.length && profiles.length !== updates.scannedCount && !updates.scanning)
      void updates.scan()
  }, [on, profiles.length])

  useEffect(() => {
    if (readyCache && Date.now() - readyCache.at < READY_TTL) {
      setReady(readyCache.hits)
      return
    }
    ;(async () => {
      try {
        const d = await (
          await fetch(
            'https://api.modrinth.com/v2/search?limit=8&index=downloads&facets=' +
              encodeURIComponent(JSON.stringify([['project_type:modpack']])),
          )
        ).json()
        const hits: ReadyHit[] = (d.hits || []).map((h: any) => ({
          slug: h.slug,
          title: h.title || '',
          icon_url: h.icon_url,
          description: (h.description || '').slice(0, 110),
          downloads: h.downloads,
          cats: h.display_categories || h.categories || [],
        }))
        if (hits.length) readyCache = { at: Date.now(), hits }
        setReady(hits)
        if (!hits.length) setReadyErr('Не удалось загрузить')
      } catch {
        setReady([])
        setReadyErr('Не удалось загрузить популярные сборки')
      }
    })()
  }, [])

  useEffect(() => {
    if (!wp.popOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('#wpPop')) return
      wp.setPopOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [wp.popOpen])

  const sel = profiles.find((p) => p.name === selected) || profiles[0]

  let heroName: string
  let heroMeta: ReactNode
  let heroEyebrow: string
  if (profiles.length && sel) {
    heroName = sel.name
    heroEyebrow = 'Продолжить'
    heroMeta = (
      <>
        <span className="pill">{LOADER_NAME(sel)}</span>
        <span className="pill">{sel.version}</span>
      </>
    )
  } else {
    heroName = 'Своя сборка за минуту'
    heroEyebrow = 'Millida Launcher'
    heroMeta = (
      <>
        <span className="pill">Minecraft и Java поставим сами</span>
        <span className="pill">Моды в один клик</span>
      </>
    )
  }

  const byRecent = profiles
    .map((p) => ({ p, t: Number(localStorage.getItem('m-last-' + p.name) || 0) }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.p)

  const buildCard = (p: (typeof profiles)[number]) => (
    <button
      key={p.name}
      className={'card hoverable build-card' + (p.name === selected ? ' selected' : '')}
      data-prof={p.name}
      data-sound="open"
      onClick={(e) => {
        setSelected(p.name)
        if ((e.target as HTMLElement).closest('.mini-play')) {
          void refresh()
          realLaunch(p.name)
          return
        }
        openBuildSettings(p.name)
      }}
    >
      <span className="build-cover">
        <Cover url={p.icon} />
        <span className="mini-play" data-nosound>
          <Icon id="i-play" />
        </span>
      </span>
      <span className="build-body">
        <b>{p.name}</b>
        <span className="meta">{LOADER_NAME(p) + ' · ' + p.version}</span>
        {hoursOf(p.name) ? (
          <span className="meta build-hours">
            <Icon id="i-clock" />
            {fmtPlaytime(hoursOf(p.name)!.seconds)}
          </span>
        ) : null}
      </span>
    </button>
  )

  const newBuildBtn = (
    <button className="build-new" id="newBuild2" data-sound="open" onClick={() => openModal('nbModal')}>
      <span className="inner">
        <Icon id="i-plus" />
        Новая сборка
      </span>
    </button>
  )

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-play">
      <div className="hero-live-wrap">
        <div className="hero-tools">
          <MusicControls />
          <button
            className="wp-btn"
            id="wpBtn"
            onClick={(e) => {
              e.stopPropagation()
              const next = !wp.popOpen
              if (next) setMusicOpen(false)
              wp.setPopOpen(next)
            }}
          >
            <Icon id="i-image" />
            Фон
          </button>
        </div>
      <div
        className="hero-live"
        id="heroLive"
        ref={hero.wrapRef}
        onMouseMove={hero.onMouseMove}
        onMouseLeave={hero.onMouseLeave}
      >
        <img
          id="wpPoster"
          className={hero.posterReady ? 'ready' : undefined}
          alt=""
          src={hero.posterSrc || undefined}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <video
          id="wpVideo"
          ref={hero.videoRef}
          className={hero.videoReady ? 'ready' : undefined}
          muted
          loop
          playsInline
          preload="auto"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        ></video>
        <canvas id="wpCanvas" ref={hero.canvasRef} className={hero.canvasReady ? 'ready' : undefined}></canvas>
        {wp.wpCur === 'custom' && wp.custom ? (
          wp.custom.kind === 'video' ? (
            <video
              key={wp.custom.path}
              className="ready"
              src={convertFileSrc(wp.custom.path)}
              muted
              loop
              playsInline
              autoPlay={wp.wpAnimOn}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
            />
          ) : (
            <img
              key={wp.custom.path}
              className="ready"
              alt=""
              src={convertFileSrc(wp.custom.path)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
            />
          )
        ) : null}
        <div className="hero-scrim"></div>

        <div className="hero-overlay">
          <div className="hero-body">
            <span className="eyebrow">{heroEyebrow}</span>
            <h2 id="heroName">{heroName}</h2>
            <div className="hero-meta" id="heroMeta">
              {heroMeta}
            </div>
          </div>
          <div className="hero-cta" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
            <button
              className="hero-gear"
              id="heroConfig"
              data-sound="open"
              title="Настроить сборку"
              style={sel ? undefined : { display: 'none' }}
              onClick={() => sel && openBuildSettings(sel.name)}
            >
              <Icon id="i-settings" />
            </button>
            <button
              className={'btn lg ' + (gameRunning ? 'danger' : 'primary')}
              id="playBtn"
              disabled={gameStopping}
              onClick={() => {
                if (gameRunning) {
                  stopRunningGame()
                  return
                }
                if (!sel) {
                  openModal('nbModal')
                  return
                }
                if (hasTauri()) realLaunch(sel.name)
                else startPrelaunch(sel.name)
              }}
            >
              <span className="fill"></span>
              <span className="lbl">
                <Icon id={gameRunning ? 'i-power' : sel ? 'i-play' : 'i-plus'} />
                <span id="playLbl">
                  {gameRunning
                    ? gameStopping
                      ? 'Останавливаем…'
                      : 'Остановить игру'
                    : sel
                      ? 'Играть'
                      : 'Создать сборку'}
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
        <div className={'wp-pop' + (wp.popOpen ? ' open' : '')} id="wpPop">
          <div className="cap">Живые обои</div>
          <div className="wp-grid" id="wpGrid">
            {VIDEOS.map((v) => (
              <div
                key={v.id}
                className={'wp-item' + (v.id === wp.wpCur ? ' on' : '')}
                data-id={v.id}
                onClick={() => wp.pick(v.id, v.name)}
              >
                <img
                  src={v.poster}
                  alt=""
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <span>{v.name}</span>
              </div>
            ))}
          </div>
          {wp.gallery.length ? <div className="cap">Мои фоны</div> : null}
          <div className="wp-grid">
            {wp.gallery.map((c) => (
              <div
                key={c.path}
                className={'wp-item' + (wp.wpCur === 'custom' && wp.custom && wp.custom.path === c.path ? ' on' : '')}
                title={c.name || 'Свой фон'}
                onClick={() => wp.setCustom(c)}
              >
                {c.kind === 'video' ? (
                  <span className="wp-item-ph">
                    <Icon id="i-play" />
                  </span>
                ) : (
                  <img
                    src={convertFileSrc(c.path)}
                    alt=""
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                <span>{c.name || 'Свой фон'}</span>
                <button
                  className="wp-item-del"
                  title="Удалить фон"
                  onClick={(e) => {
                    e.stopPropagation()
                    wp.removeCustom(c.path)
                  }}
                >
                  <Icon id="i-trash" />
                </button>
              </div>
            ))}
            <div
              className="wp-item wp-item-add"
              title="Загрузить свой фон"
              onClick={() => {
                if (!hasTauri()) {
                  showToast('Загрузка своего фона доступна в приложении', 'error')
                  return
                }
                void pickWallpaper()
                  .then((w) => {
                    if (w) wp.addCustom({ kind: w.kind, path: w.path, name: w.name })
                  })
                  .catch((e) => showToast('Не удалось загрузить фон: ' + e, 'error'))
              }}
            >
              <span className="wp-item-ph">
                <Icon id="i-upload" />
              </span>
              <span>Загрузить</span>
            </div>
          </div>
          <div className="wp-row">
            <span className="lab">Анимация</span>
            <span
              className={'tgl' + (wp.wpAnimOn ? ' on' : '')}
              id="wpAnim"
              onClick={(e) => {
                e.stopPropagation()
                wp.toggleAnim()
              }}
            ></span>
          </div>
        </div>
      </div>

      {profiles.length ? (
        <>
          <div className="sec-title sec-title-row">
            <span>Мои сборки</span>
            <button className="sec-link" onClick={() => setScreen('builds')}>
              Все сборки
              <Icon id="i-chev-r" />
            </button>
          </div>
          <div className="build-grid one-line" id="buildGrid" style={{ marginBottom: '22px' }}>
            {byRecent.slice(0, 8).map(buildCard)}
            {newBuildBtn}
          </div>
        </>
      ) : (
        <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '6px' }}>Создай первую сборку</div>
          <p className="faint-note" style={{ maxWidth: '460px', margin: '0 auto 16px', lineHeight: 1.55 }}>
            Выбери версию и загрузчик — Minecraft, Java и загрузчик поставим сами. Или импортируй сборку из другого
            лаунчера, или поставь готовый модпак.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn md primary" id="obNew" data-sound="open" onClick={() => openModal('nbModal')}>
              <Icon id="i-plus" /> Новая сборка
            </button>
            <button className="btn md secondary" id="obImport" data-sound="open" onClick={() => openModal('impModal')}>
              Импорт из лаунчера
            </button>
            <button className="btn md secondary" id="obModpack" onClick={() => setScreen('mods')}>
              Готовый модпак
            </button>
          </div>
        </div>
      )}

      {servers.length ? (
        <>
          <div className="sec-title sec-title-row">
            <span>Рекомендуемые серверы</span>
            <button className="sec-link" onClick={() => setScreen('servers')}>
              Все серверы
              <Icon id="i-chev-r" />
            </button>
          </div>
          <div className="stack" id="promoRow" style={{ marginBottom: '22px' }}>
            {servers.slice(0, 3).map((sv, i) => (
              <ServerRow key={sv.slug + i} sv={sv} />
            ))}
          </div>
        </>
      ) : null}

      <div className="sec-title sec-title-row">
        <span>Популярные сборки</span>
        <button
          className="sec-link"
          onClick={() => {
            setScreen('mods')
            useMods.getState().set({ modTab: 'modpack', fCats: [], fCat: 'все' })
            void useMods.getState().load()
          }}
        >
          Посмотреть все сборки
          <Icon id="i-chev-r" />
        </button>
      </div>
      <div className="ready-grid" id="readyGrid">
        {ready === null ? (
          <p className="faint-note" style={{ gridColumn: '1/-1' }}>
            Загружаем популярные сборки…
          </p>
        ) : ready.length ? (
          ready.map((h) => <ReadyCard key={h.slug} h={h} />)
        ) : (
          <p className="faint-note" style={{ gridColumn: '1/-1' }}>
            {readyErr}
          </p>
        )}
      </div>
    </section>
  )
}
