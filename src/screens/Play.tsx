import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { BuildIcon } from '../components/playhub/BuildIcon'
import { LobbyCharacter } from '../components/lobby/LobbyCharacter'
import { EmoteBubble } from '../components/lobby/EmoteBubble'
import { Recommend } from '../components/lobby/Recommend'
import { PixelField } from '../components/lobby/PixelField'
import { HubTile } from '../components/lobby/HubTile'
import { useHeroWallpaper } from '../components/HeroWallpaper'
import { LOADER_NAME, fmtN, fmtPlaytime } from '../lib/format'
import { VIDEOS } from '../lib/wallpaper'
import { hasTauri } from '../ipc/tauri'
import { useProfiles } from '../state/profiles'
import { useLobby } from '../state/lobbyMode'
import type { LobbyMode } from '../state/lobbyMode'
import { playMode } from '../lib/lobbyPlay'
import { useWallpaper } from '../state/wallpaper'
import { convertFileSrc, pickWallpaper } from '../ipc/commands'
import { setScreen, showToast, useUi } from '../state/ui'
import { PL_STAGES, cancelPrelaunch } from '../lib/launch'
import { playTier } from '../lib/playTiers'
import { useModUpdates } from '../state/modUpdates'
import { usePlayStats } from '../state/playStats'
import { stopRunningGame, useGame } from '../state/game'
// Пиксельный слой главного экрана. Пока файл не подключён в main.tsx,
// импорт стоит здесь — иначе полки стоят без своих правил.
import '../styles/pixel/play.css'
import '../styles/pixel/lobby.css'

/* Разделы на лобби, как в Brawl Stars: у каждого ровно один вход (владелец
   23.09.2026: «всё дублируется»). Режимы и каталог открывает плашка «Что
   играем сегодня», гардероб — кнопка под персонажем, друзей — список справа,
   настройки — шестерёнка в углу. Слева под сундуком — плитки «Магазин» и
   «Свой сервер» (HubTile). */

/**
 * Пустая плашка режима: вместо значка-сетки по очереди сменяются обложки —
 * версии, сборки, режимы, как барабан (правка владельца 23.09.2026, 21:45).
 */
const REEL = [
  '/versions/26.3.webp',
  '/versions/1.20.1.webp',
  '/versions/1.21.11.webp',
  '/versions/26.2.webp',
  '/versions/1.21.4.webp',
  '/versions/1.16.5.webp',
  '/versions/1.12.2.webp',
]
function ModeReel() {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setI((n) => (n + 1) % REEL.length), 2600)
    return () => clearInterval(t)
  }, [])
  return <img key={i} className="lobby-mode-reel" src={REEL[i]} alt="" />
}

export function Play({ on }: { on: boolean }) {
  const profiles = useProfiles((s) => s.profiles)
  const picked = useLobby((s) => s.picked)
  const lobbyServers = useLobby((s) => s.servers)
  const loadLobby = useLobby((s) => s.load)
  const wp = useWallpaper()
  // Обои убраны (владелец 23.09.2026): фон — только цветная сцена PixelField.
  const hero = useHeroWallpaper(false)
  const updates = useModUpdates()
  const playStats = usePlayStats((s) => s.stats)
  const running = useGame((s) => s.list)
  const gameStopping = useGame((s) => s.stopping)
  // Ход подготовки к запуску — прямо на кнопке: скачиваем → запускаем → в игре.
  const prelaunch = useUi((s) => s.prelaunch)
  const hoursOf = (name: string) => playStats.builds.find((b) => b.key === name) || null

  useEffect(() => {
    if (on && profiles.length && profiles.length !== updates.scannedCount && !updates.scanning)
      void updates.scan()
  }, [on, profiles.length])

  useEffect(() => {
    if (on) void loadLobby()
  }, [on])

  // Часы на «Играть»: статистику лобби грузит само, не ждёт «Во что играем».
  useEffect(() => {
    if (on) void usePlayStats.getState().refresh()
  }, [on])


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

  // «Что играем сегодня» — только то, что человек выбрал сам (в каталоге
  // режимов или запуском). Ничего не подставляем: «Играть» без выбора ведёт
  // в каталог, а не молча запускает сборку дня (владелец 23.09.2026).
  const tier = playTier(playStats.total_seconds)
  const mode: LobbyMode | null =
    picked && (picked.kind !== 'build' || profiles.some((p) => p.name === picked.name)) ? picked : null
  const sel = mode && mode.kind === 'build' ? profiles.find((p) => p.name === mode.name) || null : null
  const selRunning = !!sel && running.includes(sel.name)
  const selHours = sel ? hoursOf(sel.name) : null
  const liveServer = mode && mode.kind === 'server' ? lobbyServers.find((s) => s.slug === mode.slug) || null : null

  // Для аналитики: что стоит в «Сегодня играем» (имя своей сборки — только как id сборки).
  const modeId =
    mode?.kind === 'build'
      ? mode.name
      : mode?.kind === 'version'
        ? mode.version
        : mode?.kind === 'premium'
          ? mode.slug || mode.id
          : mode?.kind === 'server'
            ? mode.slug
            : undefined

  const modeArt =
    mode?.kind === 'build' ? (
      // Иконка сборки крупно по центру — как на карточке «Моих сборок»
      // (владелец 24.09.2026: мелкий сундук в углу).
      <span className="lobby-mode-cover lobby-mode-bi">
        <BuildIcon icon={sel?.icon} size={104} />
      </span>
    ) : mode?.kind === 'version' ? (
      <img src={'/versions/' + mode.version + '.webp'} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
    ) : mode?.kind === 'premium' ? (
      mode.cover ? <img src={mode.cover} alt="" /> : null
    ) : mode?.kind === 'server' ? (
      mode.banner || mode.logo ? <img src={(mode.banner || mode.logo) as string} alt="" /> : null
    ) : (
      <ModeReel />
    )
  const modeTitle =
    mode?.kind === 'build' ? mode.name : mode?.kind === 'version' ? 'Minecraft ' + mode.version : mode?.kind === 'premium' ? mode.title : mode?.kind === 'server' ? mode.name : 'Ещё не выбрано'
  const modeMeta =
    mode?.kind === 'build' && sel ? (
      <>
        {LOADER_NAME(sel) + ' · ' + sel.version}
        {/* «меньше минуты» не пишем — это пустяк, а не наигранные часы */}
        {selHours && selHours.seconds >= 3600 ? (
          <span className="hero-num">
            <Icon id="i-clock" />
            <b>{fmtPlaytime(selHours.seconds)}</b>
          </span>
        ) : null}
      </>
    ) : mode?.kind === 'version' ? (
      'Fabric'
    ) : mode?.kind === 'premium' ? (
      mode.meta
    ) : mode?.kind === 'server' && liveServer ? (
      <span className="hero-num">
        <Icon id="i-users" />
        <b>{fmtN(liveServer.online)}</b>
      </span>
    ) : null
  const modeTag =
    mode?.kind === 'premium' ? (
      <>
        <Icon id="i-crown" />
        Премиум
      </>
    ) : mode?.kind === 'server' ? (
      <>
        <Icon id="i-server" />
        Сервер
      </>
    ) : null

  return (
    <section className={'screen lobby' + (on ? ' on' : '')} id="s-play">
      <div className="hero-live-wrap lobby-wrap">
      <div
        className="hero-live"
        id="heroLive"
        ref={hero.wrapRef}
        onMouseMove={hero.onMouseMove}
        onMouseLeave={hero.onMouseLeave}
      >
        <PixelField on={on} />

      </div>
      <LobbyCharacter on={on} />
      <EmoteBubble />
      <Recommend on={on} />
      {/* Левый край — как в Brawl Stars: крупный сундук и под ним разделы.
          Боковой полосы на главной нет (владелец 23.09.2026). */}
      {/* Ежедневный бонус живёт в магазине (правка владельца 21:43): плитки
          бонуса нет, у «Магазина» «!», пока бонус не забран. */}
      <div className="lobby-left">
        <nav className="lobby-nav" aria-label="Разделы">
          <HubTile kind="shop" />
          <HubTile kind="wardrobe" />
          <HubTile kind="server" />
        </nav>
      </div>
      <div className="lobby-who">
        {playStats.total_seconds >= 3600 ? (
          <span
            className="lobby-hours"
            title={tier.next ? 'Наиграно · следующая ступень ' + tier.next + ' ч' : 'Наиграно'}
          >
            <Icon id="i-trophy" />
            {fmtPlaytime(playStats.total_seconds)}
            {tier.next ? (
              <span className="lobby-hours-bar" aria-hidden="true">
                <span style={{ width: Math.round(tier.progress * 100) + '%' }} />
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="lobby-side">
        {/* Над рядом — подпись и мелкие действия сборки; сам ряд — плашка
            режима и «Играть» одной высоты, как в Brawl Stars. */}
        <div className="lobby-side-top">
          <span />
          <span className="lobby-tools">
            {running.length ? (
              <button className="lobby-tool stop" id="stopBtn" data-track="stop_game" disabled={gameStopping} onClick={() => stopRunningGame()}>
                <Icon id="i-power" />
                {gameStopping ? 'Останавливаем…' : 'Остановить'}
              </button>
            ) : null}
          </span>
        </div>
        <div className="lobby-row">
          {/* OneBlock в лобби убран (владелец 24.09.2026, 07:26: «пока убираем»). */}
          {/* Плашка ведёт в каталог режимов, «Играть» — только запуск. */}
          <button
            className="lobby-mode"
            data-sound="open"
            data-track="today"
            data-section="today"
            data-src="today"
            data-kind={mode?.kind}
            data-id={modeId}
            data-private={mode?.kind === 'build' ? '' : undefined}
            onClick={() => setScreen('playhub')}
          >
            {/* Панель на всю ширину (правка владельца 22:44): крупная обложка
                меняется раз в пару секунд — «загляни, может найдёшь интереснее». */}
            <span className={'lobby-mode-card' + (mode ? ' kind-' + mode.kind : ' empty')}>
              <span className="lobby-mode-art">
                {mode ? modeArt : null}
                <span className={'lobby-mode-reelbox' + (mode ? ' under' : '')}>
                  <ModeReel />
                </span>
                {modeTag ? <span className="mode-tile-tag">{modeTag}</span> : null}
              </span>
              <span className="lobby-mode-body">
                <span className="lobby-mode-lab">Сегодня играем</span>
                <b>{modeTitle}</b>
                {modeMeta ? <span className="meta">{modeMeta}</span> : null}
              </span>
            </span>
          </button>
          {/* Кнопка запуска стоит на постоянном месте и видна на первом кадре:
              наведение её не вызывает и не прячет (антипаттерн Modrinth). */}
          <button
            className={'btn lg ' + (selRunning ? 'running' : prelaunch.open ? 'primary loading' : 'primary')}
            id="playBtn"
            data-track="play"
            data-src="lobby_play"
            data-kind={mode?.kind}
            data-id={modeId}
            data-private={mode?.kind === 'build' ? '' : undefined}
            data-sound={mode ? undefined : 'open'}
            onClick={() => {
              // Второе нажатие во время подготовки — отмена запуска
              // (владелец 24.09.2026, 17:26).
              if (prelaunch.open) {
                cancelPrelaunch()
                return
              }
              if (!mode) {
                setScreen('playhub')
                return
              }
              void playMode(mode, profiles)
            }}
          >
            <span className="fill" style={prelaunch.open ? { width: Math.round(prelaunch.pct) + '%' } : undefined}></span>
            <span className="lbl">
              {selRunning ? (
                <span className="run-dot"></span>
              ) : prelaunch.open ? (
                <span className="spin"></span>
              ) : (
                <Icon id="i-play" />
              )}
              <span id="playLbl">
                {selRunning ? (
                  'Запущено'
                ) : prelaunch.open ? (
                  <>
                    <span className="play-stage">{(PL_STAGES[prelaunch.stage] || 'Запуск') + ' · нажми — отмена'}</span>
                    {Math.round(prelaunch.pct) + '%'}
                  </>
                ) : (
                  <>
                    Играть
                    {/* Сколько наиграно через лаунчер — видно при каждом заходе
                        (владелец 24.09.2026, 13:31). */}
                    {playStats.total_seconds >= 3600 ? (
                      <span className="play-hours">
                        <Icon id="i-clock" />
                        {fmtPlaytime(playStats.total_seconds)} в игре
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </span>
          </button>
        </div>
      </div>
        <div className={'wp-pop' + (wp.popOpen ? ' open' : '')} id="wpPop">
          <div className="cap">Живые обои</div>
          <div className="wp-grid" id="wpGrid">
            <div
              className={'wp-item wp-item-pixels' + (wp.wpCur === 'pixels' ? ' on' : '')}
              data-id="pixels"
              onClick={() => wp.pick('pixels', 'Сцена')}
            >
              <span className="wp-item-ph" aria-hidden="true">
                <Icon id="i-grid" />
              </span>
              <span>Сцена</span>
            </div>
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
                  aria-label="Удалить фон"
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
              onClick={() => {
                if (!hasTauri()) {
                  showToast('Загрузка своего фона доступна в приложении', 'error')
                  return
                }
                void pickWallpaper()
                  .then((w) => {
                    if (w) wp.addCustom({ kind: w.kind, path: w.path, name: w.name })
                  })
                  .catch((e) => {
                    console.error('[wallpaper]', e)
                    showToast('Не удалось загрузить фон', 'error')
                  })
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

    </section>
  )
}
