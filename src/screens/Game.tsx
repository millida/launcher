import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { PxIcon } from '../components/PxIcon'
import {
  openUrl,
  storeGameInstall,
  storeGameOpen,
  storeGamesState,
  type StoreGameState,
} from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { GAMES, gameBuyUrl, gameHero, gamePoster, gameSite, useGame, type GameInfo } from '../lib/games'
import { runInstall, runningMsg, stopInstall, useInstalls } from '../state/installs'
import { PauseInstall } from '../components/PauseInstall'
import { showToast } from '../state/ui'
import { BedrockServers } from '../components/playhub/BedrockServers'
import '../styles/pixel/game.css'

/*
 * Экран игры Minecraft из «Других игр» библиотеки (29.09.2026).
 * Арт на всю ширину, постер ломает рамку, под ним — название, строка,
 * факты плашками и кнопки.
 * Как запускается каждая игра — src/lib/games.ts.
 */

const fail = (e: unknown) => showToast(String(e), 'error')

export function Game({ on }: { on: boolean }) {
  const slug = useGame((s) => s.slug)
  const game = GAMES.find((g) => g.slug === slug) || GAMES[0]
  const [store, setStore] = useState<StoreGameState[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!on || !hasTauri()) return
    storeGamesState()
      .then(setStore)
      .catch(() => setStore([]))
  }, [on, slug, tick])

  const st = store && store.find((x) => x.slug === game.slug)
  const content = document.querySelector('.content')

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-game" key={game.slug}>
      <div className={'gm-top gm-' + game.slug}>
        <div className="gm-hero">
          <img src={gameHero(game.slug)} alt="" />
        </div>
        <img className="gm-poster" src={gamePoster(game.slug)} alt={game.name} width={180} height={270} />
        <div className="card gm-panel">
        <div className="gm-main">
          <h1>
            {game.name}
            {game.isNew ? <span className="gm-new">Новинка</span> : null}
          </h1>
          <span className="gm-tag">{game.tagline}</span>
          <div className="gm-facts">
            <span className="gm-fact">
              <PxIcon name="clock" size={18} />
              {game.released}
            </span>
            {game.mods ? (
              <span className="gm-fact">
                <PxIcon name="box" size={18} />
                {game.mods}
              </span>
            ) : null}
          </div>
          <Actions game={game} st={st || null} onChanged={() => setTick((t) => t + 1)} />
        </div>
        </div>
      </div>

      {game.slug === 'bedrock' ? <BedrockServers on={on} /> : null}

      <div className="gm-head">
        <h2>Другие игры</h2>
      </div>
      <div className="hub-grid">
        {GAMES.filter((g) => g.slug !== game.slug).map((g) => (
          <button
            key={g.slug}
            className="ph-card"
            data-sound="open"
            data-track="game_switch"
            data-id={g.slug}
            onClick={() => {
              useGame.getState().open(g.slug)
              if (content) content.scrollTop = 0
            }}
          >
            <span className="ph-card-art">
              <img src={gameHero(g.slug)} alt="" loading="lazy" />
              {g.isNew ? <span className="gm-new gm-new-card">Новинка</span> : null}
            </span>
            <span className="ph-card-body">
              <b>{g.name}</b>
              <span className="ph-card-meta">{g.meta}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function openStore(slug: string, via: 'steam' | 'steam-install' | 'store-page' | 'store') {
  storeGameOpen(slug, via).catch(fail)
}

/*
 * «Играть» у игр из магазинов (владелец 29.09.2026: «нажимаешь играть —
 * скачивается игра»): есть копия — запускаем; нет — ставим, не выходя из
 * лаунчера (winget из Microsoft Store, у Education — установщик Microsoft),
 * потом запускаем. Не вышло — страница Microsoft Store. Покупку не
 * проверяем (владелец 29.09.2026): лицензию при установке и запуске проверяет
 * сам Microsoft Store или Steam, двойная проверка только мешала.
 */
export function Actions({ game, st, onChanged }: { game: GameInfo; st: StoreGameState | null; onChanged: () => void }) {
  const key = 'game-' + game.slug
  const task = useInstalls((s) => s.tasks[key])
  const page = (
    <button className="btn md ghost" data-track="game_site" onClick={() => void openUrl(gameSite(game.slug))}>
      <PxIcon name="book" size={18} /> Об игре
    </button>
  )
  if (st && !st.windows)
    return (
      <div className="gm-actions">
        <span className="gm-tag">Только Windows</span>
        {page}
      </div>
    )
  if (task && task.state === 'run')
    return (
      <div className="gm-actions">
        <div className="gm-progress">
          <div className="gm-bar">
            <span className={task.pct <= 5 ? 'gm-bar-wait' : undefined} style={{ width: Math.max(8, Math.round(task.pct)) + '%' }} />
          </div>
          <span className="gm-tag">{runningMsg(task, task.msg || task.label)}</span>
          <PauseInstall task={task} className="btn md ghost" withText />
          <button className="btn md ghost" onClick={() => stopInstall(key)}>
            Отменить
          </button>
        </div>
      </div>
    )
  const installed = !!st && (st.steam || st.store)
  const play = () => {
    if (st && st.steam) return openStore(game.slug, 'steam')
    if (st && st.store) return openStore(game.slug, 'store')
    runInstall({
      key,
      title: game.name,
      running: 'Ставим',
      run: () => storeGameInstall(game.slug),
      onDone: () => {
        onChanged()
        // Education запускает свой установщик сам; Store-игру — запускаем.
        if (game.slug !== 'education') setTimeout(() => openStore(game.slug, 'store'), 600)
      },
      onError: (e) => {
        showToast(String(e), 'error')
        openStore(game.slug, 'store-page')
      },
    })
  }
  return (
    <div className="gm-actions">
      <button
        className="btn lg primary gm-play"
        data-sound="play"
        data-track={installed ? 'game_play' : 'game_install'}
        data-id={game.slug}
        onClick={play}
      >
        <Icon id={installed ? 'i-play' : 'i-download'} /> Играть
      </button>
      {!installed && game.steam && st && st.steamClient ? (
        <button className="btn md secondary" data-track="game_steam_install" onClick={() => openStore(game.slug, 'steam-install')}>
          Steam
        </button>
      ) : null}
      {!installed && game.slug !== 'education' ? (
        <button className="btn md secondary" data-track="game_buy" data-id={game.slug} onClick={() => void openUrl(gameBuyUrl(game.slug))}>
          Купить в Blups
        </button>
      ) : null}
      {page}
    </div>
  )
}
