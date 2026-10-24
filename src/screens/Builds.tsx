import { Fragment, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { tx, useT } from '../i18n'
import { BuildCard } from '../components/BuildCard'
import { fmtPlaytime, plural, whenText } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { useModUpdates } from '../state/modUpdates'
import { refreshPlayStats, usePlayStats } from '../state/playStats'
import { rememberServerName } from '../state/playStats'
import { openModal, setScreen, showToast } from '../state/ui'
import { quickJoin } from '../lib/joinServer'
import { composeIcon, randomIconRecipe, rememberIconRecipe } from '../lib/iconArt'
import type { IconRecipe } from '../lib/iconArt'
import { hasTauri } from '../ipc/tauri'
import { setProfileGroup, setProfileIcon } from '../ipc/commands'
import { groupTree, normalizeGroup } from '../lib/buildGroups'
import '../styles/pixel/build-extras.css'

/** Pointer travel before a press on a card becomes a drag rather than a click. */
const DRAG_START_PX = 6

const SKIP_KEY = 'm-icon-art-skip'

function readSkip(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}

export function Builds({ on }: { on: boolean }) {
  const t = useT()
  const { profiles, groups } = useProfiles()
  const updates = useModUpdates()
  const stats = usePlayStats((s) => s.stats)
  const verifiedSeconds = usePlayStats((s) => s.verifiedSeconds)
  const [iconsSkipped, setIconsSkipped] = useState(readSkip)
  const [iconsBusy, setIconsBusy] = useState(false)
  const iconless = profiles.filter((p) => !p.icon)

  useEffect(() => {
    if (on) void refreshPlayStats()
  }, [on])

  const hoursOf = (name: string) => stats.builds.find((b) => b.key === name) || null
  const lastServerName = stats.last_server_name || stats.last_server

  const groupOf = (name: string) => normalizeGroup(groups[name] || '')
  const groupRows = groupTree(profiles.map((p) => groupOf(p.name)).filter(Boolean))
  const ungrouped = profiles.filter((p) => !groupOf(p.name))

  // Native HTML drag events do not reach the page while the window accepts
  // dropped files, so a card is dragged with plain pointer events.
  const press = useRef<{ name: string; x: number; y: number; active: boolean } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const dropAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop-group]') as HTMLElement | null
    return el ? (el.dataset.dropGroup ?? null) : null
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      if (!p.active && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START_PX) return
      if (!p.active) {
        p.active = true
        setDragging(p.name)
      }
      setOver(dropAt(e.clientX, e.clientY))
    }
    const up = (e: PointerEvent) => {
      const p = press.current
      press.current = null
      if (!p || !p.active) return
      setDragging(null)
      setOver(null)
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      const target = dropAt(e.clientX, e.clientY)
      if (target === null || target === groupOf(p.name)) return
      if (!hasTauri()) {
        showToast(t('Доступно в приложении'))
        return
      }
      setProfileGroup(p.name, target)
        .then(() => useProfiles.getState().refresh())
        .catch((err) => showToast(t('Не удалось перенести: {error}', { error: tx(err) }), 'error'))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [groups])

  const buildCard = (p: (typeof profiles)[number]) => (
    <div
      key={p.name}
      className={'bx-drag' + (dragging === p.name ? ' on' : '')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        press.current = { name: p.name, x: e.clientX, y: e.clientY, active: false }
      }}
    >
      <BuildCard p={p} hours={hoursOf(p.name)} withLast />
    </div>
  )

  const skipIcons = () => {
    setIconsSkipped(true)
    try {
      localStorage.setItem(SKIP_KEY, '1')
    } catch {}
  }

  const fillIcons = async () => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'), 'error')
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
        plural(done, t('Готово: {n} иконка на месте', { n: done }), t('Готово: {n} иконки на месте', { n: done }), t('Готово: {n} иконок на месте', { n: done })),
        'ok',
        'achievement',
      )
    }
    if (failure) showToast(t('Не все иконки собрались: {error}', { error: failure }), 'error')
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-builds">
      <div className="page-head">
        <h1>{t('Сборки')}</h1>
        {/* Пустой экран держит все входы в своей карточке: тулбар с теми же
            кнопками над ней был дублем (аудит 22.09.2026). «По коду» живёт
            в окне «Импорт» — это третий способ принести чужую сборку. */}
        {profiles.length ? (
          <div className="right">
            {updates.count > 0 ? (
              <button className="btn sm secondary" disabled={updates.updating} onClick={() => void updates.runAll()}>
                <Icon id="i-restart" />
                {updates.updating ? t('Обновляем…') : t('Обновить моды')}
                <span className="nav-count" style={{ marginLeft: '4px' }}>
                  {updates.count}
                </span>
              </button>
            ) : null}
            <button className="btn sm secondary" data-sound="open" onClick={() => openModal('impModal')}>
              <Icon id="i-download" />
              {t('Импорт')}
            </button>
            <button className="btn sm primary" data-sound="open" onClick={() => openModal('nbModal')}>
              <Icon id="i-plus" />
              {t('Новая сборка')}
            </button>
          </div>
        ) : null}
      </div>

      {stats.total_seconds ? (
        <div className="card play-stat">
          <div className="play-stat-main">
            <span className="play-stat-cap">{t('Наиграно')}</span>
            <b className="play-stat-total">{fmtPlaytime(stats.total_seconds)}</b>
            {verifiedSeconds !== null && verifiedSeconds < stats.total_seconds ? (
              <span className="faint-note">{t('на сайте {time}', { time: fmtPlaytime(verifiedSeconds) })}</span>
            ) : null}
            {stats.sessions ? (
              <span className="faint-note">
                {plural(stats.sessions, t('{n} запуск', { n: stats.sessions }), t('{n} запуска', { n: stats.sessions }), t('{n} запусков', { n: stats.sessions }))}
              </span>
            ) : null}
          </div>
          {lastServerName ? (
            <div className="play-stat-srv">
              <span className="play-stat-cap">{t('Последний сервер')}</span>
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
                  {t('Играть')}
                </button>
              ) : null}
            </div>
          ) : null}
          {stats.servers.length > 1 ? (
            <div className="play-stat-list">
              <span className="play-stat-cap">{t('Любимые серверы')}</span>
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
            <b>{plural(iconless.length, t('Иконки для {n} сборки', { n: iconless.length }), t('Иконки для {n} сборок', { n: iconless.length }), t('Иконки для {n} сборок', { n: iconless.length }))}</b>
          </div>
          <div className="icon-nudge-acts">
            <button className="btn sm ghost" disabled={iconsBusy} onClick={skipIcons}>
              {t('Не надо')}
            </button>
            <button className="btn sm primary" disabled={iconsBusy} onClick={() => void fillIcons()}>
              <Icon id="i-brush" />
              {iconsBusy ? t('Собираем…') : t('Раздать')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="build-grid" id="buildGrid">
        {profiles.length ? (
          <>
            {dragging && groupRows.length ? (
              <div className={'build-group-cap bx-drop' + (over === '' ? ' over' : '')} data-drop-group="">
                {t('Без группы')}
              </div>
            ) : null}
            {ungrouped.map(buildCard)}
            {groupRows.map((g) => (
              <Fragment key={g.path}>
                <div
                  className={'build-group-cap' + (dragging ? ' bx-drop' : '') + (over === g.path ? ' over' : '')}
                  data-drop-group={g.path}
                  style={g.depth ? { paddingLeft: g.depth * 14 + 'px' } : undefined}
                >
                  {g.label}
                </div>
                {profiles.filter((p) => groupOf(p.name) === g.path).map(buildCard)}
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
            <b className="bx-empty-title">{t('Создай первую сборку')}</b>
            <div className="bx-empty-acts">
              <button className="btn md primary" data-sound="open" onClick={() => openModal('nbModal')}>
                <Icon id="i-plus" /> {t('Новая сборка')}
              </button>
              <button className="btn md secondary" onClick={() => setScreen('mods')}>
                <Icon id="i-blocks" /> {t('Готовые сборки')}
              </button>
              <button className="btn md secondary" data-sound="open" onClick={() => openModal('impModal')}>
                <Icon id="i-download" /> {t('Импорт')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
