import { Fragment, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { BuildCard } from '../components/BuildCard'
import { fmtPlaytime, plural, whenText } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { useModUpdates } from '../state/modUpdates'
import { refreshPlayStats, usePlayStats } from '../state/playStats'
import { rememberServerName } from '../state/playStats'
import { openModal, setScreen, showToast } from '../state/ui'
import { quickJoin } from '../lib/joinServer'
import { usePackCode } from '../state/packCode'
import { InstallByCodeModal } from '../components/InstallByCodeModal'
import { composeIcon, randomIconRecipe, rememberIconRecipe } from '../lib/iconArt'
import type { IconRecipe } from '../lib/iconArt'
import { hasTauri } from '../ipc/tauri'
import { setProfileIcon } from '../ipc/commands'

const SKIP_KEY = 'm-icon-art-skip'

function readSkip(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}

export function Builds({ on }: { on: boolean }) {
  const { profiles, groups } = useProfiles()
  const updates = useModUpdates()
  const stats = usePlayStats((s) => s.stats)
  const verifiedSeconds = usePlayStats((s) => s.verifiedSeconds)
  const packCode = usePackCode()
  const [iconsSkipped, setIconsSkipped] = useState(readSkip)
  const [iconsBusy, setIconsBusy] = useState(false)
  const iconless = profiles.filter((p) => !p.icon)

  useEffect(() => {
    if (on) void refreshPlayStats()
  }, [on])

  const hoursOf = (name: string) => stats.builds.find((b) => b.key === name) || null
  const lastServerName = stats.last_server_name || stats.last_server

  const groupNames = Object.keys(
    profiles.reduce<Record<string, boolean>>((acc, p) => {
      const g = groups[p.name] || ''
      if (g) acc[g] = true
      return acc
    }, {}),
  ).sort()
  const ungrouped = profiles.filter((p) => !(groups[p.name] || ''))

  const buildCard = (p: (typeof profiles)[number]) => (
    <BuildCard key={p.name} p={p} hours={hoursOf(p.name)} withLast />
  )

  const skipIcons = () => {
    setIconsSkipped(true)
    try {
      localStorage.setItem(SKIP_KEY, '1')
    } catch {}
  }

  const fillIcons = async () => {
    if (!hasTauri()) {
      showToast('Доступно в приложении', 'error')
      return
    }
    setIconsBusy(true)
    let done = 0
    let last: IconRecipe | null = null
    let failure = ''
    for (const p of iconless) {
      const recipe = randomIconRecipe(last)
      last = recipe
      try {
        const icon = await composeIcon(recipe)
        await setProfileIcon(p.name, icon)
        rememberIconRecipe(p.name, recipe)
        done++
      } catch (e) {
        failure = '' + e
      }
    }
    setIconsBusy(false)
    await useProfiles.getState().refresh()
    if (done) {
      skipIcons()
      showToast(
        'Готово: ' + done + ' ' + plural(done, 'иконка', 'иконки', 'иконок') + ' на месте',
        'ok',
        'achievement',
      )
    }
    if (failure) showToast('Не все иконки собрались: ' + failure, 'error')
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-builds">
      <div className="page-head">
        <h1>Сборки</h1>
        {/* Пустой экран держит все входы в своей карточке: тулбар с теми же
            кнопками над ней был дублем (аудит 22.09.2026). «По коду» живёт
            в окне «Импорт» — это третий способ принести чужую сборку. */}
        {profiles.length ? (
          <div className="right">
            {updates.count > 0 ? (
              <button className="btn sm secondary" disabled={updates.updating} onClick={() => void updates.runAll()}>
                <Icon id="i-restart" />
                {updates.updating ? 'Обновляем…' : 'Обновить моды'}
                <span className="nav-count" style={{ marginLeft: '4px' }}>
                  {updates.count}
                </span>
              </button>
            ) : null}
            <button className="btn sm secondary" data-sound="open" onClick={() => openModal('impModal')}>
              <Icon id="i-download" />
              Импорт
            </button>
            <button className="btn sm primary" data-sound="open" onClick={() => openModal('nbModal')}>
              <Icon id="i-plus" />
              Новая сборка
            </button>
          </div>
        ) : null}
      </div>

      {stats.total_seconds ? (
        <div className="card play-stat">
          <div className="play-stat-main">
            <span className="play-stat-cap">Наиграно</span>
            <b className="play-stat-total">{fmtPlaytime(stats.total_seconds)}</b>
            {verifiedSeconds !== null && verifiedSeconds < stats.total_seconds ? (
              <span className="faint-note">на сайте {fmtPlaytime(verifiedSeconds)}</span>
            ) : null}
            {stats.sessions ? (
              <span className="faint-note">
                {stats.sessions + ' ' + plural(stats.sessions, 'запуск', 'запуска', 'запусков')}
              </span>
            ) : null}
          </div>
          {lastServerName ? (
            <div className="play-stat-srv">
              <span className="play-stat-cap">Последний сервер</span>
              <b>{lastServerName}</b>
              <span className="faint-note">{whenText(stats.last_at)}</span>
              {stats.last_server ? (
                <button
                  className="btn sm secondary"
                  onClick={() => {
                    const name = stats.last_server_name || stats.last_server
                    rememberServerName(stats.last_server, name)
                    void quickJoin(stats.last_server, name).catch(() => {})
                  }}
                >
                  <Icon id="i-play" />
                  Играть
                </button>
              ) : null}
            </div>
          ) : null}
          {stats.servers.length > 1 ? (
            <div className="play-stat-list">
              <span className="play-stat-cap">Любимые серверы</span>
              {stats.servers.slice(0, 3).map((s) => (
                <span className="play-stat-row" key={s.key}>
                  <span>{s.label || s.key}</span>
                  <b>{fmtPlaytime(s.seconds)}</b>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {iconless.length > 0 && !iconsSkipped ? (
        <div className="card icon-nudge">
          <span className="icon-nudge-art bx-stack" aria-hidden="true">
            <img src="/block-icons/Block7Millida.png" alt="" />
            <img src="/block-icons/Block20Millida.png" alt="" />
            <img src="/block-icons/Block35Millida.png" alt="" />
          </span>
          <div className="icon-nudge-text">
            <b>{'Иконки для ' + iconless.length + ' ' + plural(iconless.length, 'сборки', 'сборок', 'сборок')}</b>
          </div>
          <div className="icon-nudge-acts">
            <button className="btn sm ghost" disabled={iconsBusy} onClick={skipIcons}>
              Не надо
            </button>
            <button className="btn sm primary" disabled={iconsBusy} onClick={() => void fillIcons()}>
              <Icon id="i-brush" />
              {iconsBusy ? 'Собираем…' : 'Раздать'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="build-grid" id="buildGrid">
        {profiles.length ? (
          <>
            {ungrouped.map(buildCard)}
            {groupNames.map((g) => (
              <Fragment key={g}>
                <div className="build-group-cap">
                  {g}
                </div>
                {profiles.filter((p) => (groups[p.name] || '') === g).map(buildCard)}
              </Fragment>
            ))}
          </>
        ) : (
          <div className="card bx-empty">
            <span className="bx-stack lg" aria-hidden="true">
              <img src="/block-icons/Block7Millida.png" alt="" />
              <img src="/block-icons/Block45Millida.png" alt="" />
              <img src="/block-icons/Block35Millida.png" alt="" />
            </span>
            <b className="bx-empty-title">Создай первую сборку</b>
            <div className="bx-empty-acts">
              <button className="btn md primary" data-sound="open" onClick={() => openModal('nbModal')}>
                <Icon id="i-plus" /> Новая сборка
              </button>
              <button className="btn md secondary" onClick={() => setScreen('mods')}>
                <Icon id="i-blocks" /> Готовые сборки
              </button>
              <button className="btn md secondary" data-sound="open" onClick={() => openModal('impModal')}>
                <Icon id="i-download" /> Импорт
              </button>
            </div>
          </div>
        )}
      </div>
      {packCode.open ? (
        <InstallByCodeModal initialCode={packCode.code} onClose={() => packCode.close()} />
      ) : null}
    </section>
  )
}
