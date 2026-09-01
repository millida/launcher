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

  const newBuildBtn = (
    <button className="build-new" data-sound="open" onClick={() => openModal('nbModal')}>
      <span className="inner">
        <Icon id="i-plus" />
        Новая сборка
      </span>
    </button>
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
        <div className="right">
          {updates.count > 0 ? (
            <button
              className="btn sm secondary"
              disabled={updates.updating}
              onClick={() => void updates.runAll()}
              title="Обновить моды во всех сборках"
            >
              <Icon id="i-restart" />
              {updates.updating ? 'Обновляем…' : 'Обновить моды'}
              <span className="nav-count" style={{ marginLeft: '4px' }}>
                {updates.count}
              </span>
            </button>
          ) : null}
          <button className="btn sm secondary" data-sound="open" onClick={() => usePackCode.getState().show()}>
            <Icon id="i-link" />
            По коду
          </button>
          <button className="btn sm secondary" data-sound="open" onClick={() => openModal('impModal')}>
            <Icon id="i-download" />
            Импорт
          </button>
          <button className="btn sm primary" data-sound="open" onClick={() => openModal('nbModal')}>
            <Icon id="i-plus" />
            Новая сборка
          </button>
        </div>
      </div>

      {stats.total_seconds ? (
        <div className="card play-stat">
          <div className="play-stat-main">
            <span className="play-stat-cap">Наиграно в лаунчере</span>
            <b className="play-stat-total">{fmtPlaytime(stats.total_seconds)}</b>
            {verifiedSeconds !== null && verifiedSeconds < stats.total_seconds ? (
              <span
                className="faint-note"
                title="На сайте засчитывается только время, которое видел сервер: игра без интернета и без входа в аккаунт Millida в него не попадает."
              >
                на сайте подтверждено {fmtPlaytime(verifiedSeconds)}
              </span>
            ) : null}
            <span className="faint-note">
              {[
                stats.sessions
                  ? stats.sessions + ' ' + plural(stats.sessions, 'запуск', 'запуска', 'запусков')
                  : '',
                stats.last_build ? 'последняя сборка «' + stats.last_build + '»' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
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
                  <Icon id="i-login" />
                  Вернуться
                </button>
              ) : null}
            </div>
          ) : null}
          {stats.servers.length > 1 ? (
            <div className="play-stat-list">
              <span className="play-stat-cap">Больше всего играл</span>
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
          <span className="icon-nudge-art">
            <Icon id="i-brush" />
          </span>
          <div className="icon-nudge-text">
            <b>Иконки для сборок</b>
            <span className="faint-note">
              {'У ' +
                iconless.length +
                ' ' +
                plural(iconless.length, 'сборки', 'сборок', 'сборок') +
                ' нет иконки. Соберём случайные — фон плюс блок, потом поменяешь в параметрах сборки.'}
            </span>
          </div>
          <div className="icon-nudge-acts">
            <button className="btn sm secondary" disabled={iconsBusy} onClick={skipIcons}>
              Не надо
            </button>
            <button className="btn sm primary" disabled={iconsBusy} onClick={() => void fillIcons()}>
              <Icon id="i-brush" />
              {iconsBusy ? 'Собираем…' : 'Выдать случайные'}
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
                <div className="build-group-cap" title={g}>
                  {g}
                </div>
                {profiles.filter((p) => (groups[p.name] || '') === g).map(buildCard)}
              </Fragment>
            ))}
            {newBuildBtn}
          </>
        ) : (
          <div className="card" style={{ gridColumn: '1/-1', padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '6px' }}>Создай первую сборку</div>
            <p className="faint-note" style={{ maxWidth: '460px', margin: '0 auto 16px', lineHeight: 1.55 }}>
              Выбери версию и загрузчик — Minecraft, Java и загрузчик поставим сами. Или импортируй сборку из другого
              лаунчера, или поставь готовый модпак из раздела «Контент».
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn md primary" data-sound="open" onClick={() => openModal('nbModal')}>
                <Icon id="i-plus" /> Новая сборка
              </button>
              <button className="btn md secondary" data-sound="open" onClick={() => openModal('impModal')}>
                Импорт из лаунчера
              </button>
              <button className="btn md secondary" onClick={() => setScreen('mods')}>
                Готовый модпак
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
