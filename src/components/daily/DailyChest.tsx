import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { hasMillidaAccount } from '../../lib/api'
import { logoutToLogin } from '../../lib/session'
import { useAccounts } from '../../state/accounts'
import { dailyReady, useDaily } from '../../state/daily'
import { usePlus } from '../../state/plus'
import { useUi } from '../../state/ui'
import { daysWord, nextResetAt, timerText } from './track'
import { useCountdown } from './useCountdown'
import { DailyPassModal } from './DailyPassModal'
import { ChestArt } from './ChestArt'
import { HubTile } from '../lobby/HubTile'
import { WeekItem } from './WeekItem'
import { dayChestTier } from './rewards'
import '../../styles/pixel/daily.css'

/**
 * Окно трека рисует только одна из плашек на экране: иначе при двух
 * DailyChest открылись бы два окна друг над другом.
 */
let hostSeq = 0
let host = 0
const hostListeners = new Set<() => void>()
export function useDailyModalHost(): boolean {
  const id = useRef(0)
  if (!id.current) id.current = ++hostSeq
  const [, bump] = useState(0)
  useEffect(() => {
    const me = id.current
    const sync = () => bump((n) => n + 1)
    hostListeners.add(sync)
    if (!host) {
      host = me
      hostListeners.forEach((fn) => fn())
    }
    return () => {
      hostListeners.delete(sync)
      if (host === me) {
        host = 0
        // Передаём окно следующей живой плашке.
        const next = hostListeners.values().next().value
        if (next) next()
      }
    }
  }, [])
  if (!host && hostListeners.size) host = id.current
  return host === id.current
}

/**
 * Ежедневный сундук для угла лобби.
 *
 * `compact` — плашка 260×72 (левый верхний угол лобби). Без пропа — крупнее,
 * для экранов, где места больше. Клик по плашке открывает трек наград,
 * «Забрать» тоже только открывает окно: забирают там, клеткой или «Забрать всё».
 */
export function DailyChest({
  compact = false,
  hero = false,
  className,
}: {
  compact?: boolean
  /** Крупная яркая плитка лобби как в Brawl Stars: сундук, подпись, большая «Забрать». */
  hero?: boolean
  className?: string
}) {
  const status = useDaily((s) => s.status)
  const loading = useDaily((s) => s.loading)
  const failed = useDaily((s) => s.failed)
  const busy = useDaily((s) => s.busy)
  const modal = useDaily((s) => s.modal)
  const logged = useUi((s) => s.logged)
  const accounts = useAccounts((s) => s.list.map((a) => a.id).join(','))
  const signedIn = hasMillidaAccount()
  const isHost = useDailyModalHost()

  useEffect(() => {
    void useDaily.getState().load()
    if (signedIn) void usePlus.getState().load()
  }, [logged, accounts, signedIn])

  const ready = dailyReady(status)
  const left = useCountdown(nextResetAt(status), !!status && !ready, () => void useDaily.getState().load())

  // Служба не ответила и показать нечего — блока нет, заглушку не рисуем.
  if (signedIn && failed) return null

  const size = hero ? 104 : compact ? 44 : 68
  const cls = 'dc' + (hero ? ' hero' : compact ? ' compact' : '') + (ready ? ' ready' : '') + (className ? ' ' + className : '')

  // Лобби: плитка «Ежедневный бонус» того же вида, что «Магазин» (правка
  // владельца 23.09.2026 — без «Battle Pass», по-доброму, для Minecraft).
  if (hero) {
    const open = () => (signedIn ? useDaily.getState().setModal(true) : logoutToLogin())
    const guest = !signedIn
    const wait = !guest && (loading || !status)
    return (
      <>
        <HubTile
          kind="daily"
          className={className}
          daily={{
            title: 'Ежедневный бонус',
            art: '/lobby/daily@2x.png',
            sub: guest ? 'Войди и забирай' : wait ? '' : ready ? 'Забери награду' : 'Через ' + timerText(left),
            ribbon: null,
            hot: !guest && ready,
            onClick: open,
          }}
        />
        {isHost && signedIn ? <DailyPassModal open={modal} onClose={() => useDaily.getState().setModal(false)} /> : null}
      </>
    )
  }

  if (!signedIn) {
    return (
      <div className={cls + ' guest'}>
        <ChestArt ready={false} size={size} />
        <span className="dc-body">
          <b className="dc-title">{hero ? 'Награды каждый день' : 'Сундук каждый день'}</b>
        </span>
        <button className="btn sm primary dc-act" data-track="login" onClick={() => logoutToLogin()}>
          Войти
        </button>
      </div>
    )
  }

  if (loading || !status) {
    return (
      <div className={cls} aria-busy="true">
        <span className="skel dc-skel-art" />
        <span className="dc-body">
          <span className="skel dc-skel-line" />
          <span className="skel dc-skel-line short" />
        </span>
      </div>
    )
  }

  const open = () => useDaily.getState().setModal(true)
  const own = !!status.plus || usePlus.getState().active
  const today = status.track?.find((d) => d.day === status.cycleDay)
  const tier = dayChestTier([...(today?.free || []), ...(own ? today?.plus || [] : [])])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

  return (
    <>
      <div
        className={cls + ' clickable'}
        role="button"
        tabIndex={0}
        aria-label="Награды за вход"
        data-track="daily_open"
        onClick={open}
        onKeyDown={onKey}
      >
        <ChestArt ready={ready} size={size} tier={tier} />
        <span className="dc-body">
          <b className="dc-title">{ready ? (hero ? 'Награда на сегодня' : 'Сундук готов') : 'Через ' + timerText(left)}</b>
          {!hero && status.weekItem && !status.weekItem.owned ? (
            <WeekItem item={status.weekItem} compact />
          ) : status.streak > 0 ? (
            <span className="dc-sub">
              <Icon id="i-flame" />
              {compact ? daysWord(status.streak) : daysWord(status.streak) + ' подряд'}
            </span>
          ) : null}
        </span>
        {ready ? (
          <button
            className={'btn primary dc-act ' + (hero ? 'lg' : 'sm')}
            disabled={busy === 'claim'}
            data-track="daily_claim"
            onClick={(e) => {
              // Не забирает сразу: открывает пасс — сначала видно всё
              // (и строку PLUS), забор — клеткой или «Забрать всё» в окне.
              e.stopPropagation()
              open()
            }}
          >
            Забрать
          </button>
        ) : (
          <Icon id="i-chev-r" className="icon dc-chev" />
        )}
      </div>
      {isHost ? <DailyPassModal open={modal} onClose={() => useDaily.getState().setModal(false)} /> : null}
    </>
  )
}
