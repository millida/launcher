import { useEffect } from 'react'
import { Icon } from '../Icon'
import { usePlayChests, playLeftText } from '../../state/playChests'
import { useShopGift } from '../shop/giftState'
import { setScreen } from '../../state/ui'
import { hasMillidaAccount } from '../../lib/api'
import { dailyReady, useDaily } from '../../state/daily'
import { nextResetAt } from '../daily/track'
import { useCountdown } from '../daily/useCountdown'
import { chestTimerText } from '../../lib/retention'

/** Три слота сундуков за игру: ● забран/готов, ○ ещё нет — «●●○ 3 в день». */
export function PlayPips({ n = 3, filled }: { n?: number; filled: number }) {
  return (
    <span className="pc-pips" aria-label={filled + ' из ' + n + ' за день'}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
    </span>
  )
}

/** Строка сундуков за игру (06.10.2026): «Забрать сундук (2)» или «через 34 мин» — ведёт в «Бонусы» магазина. */
function PlayChestLine({ on }: { on: boolean }) {
  const view = usePlayChests((s) => s.view)
  const at = usePlayChests((s) => s.at)
  useEffect(() => {
    if (on) void usePlayChests.getState().load()
  }, [on])
  if (!view) return null
  // Просто открыть магазин сверху — дальше человек листает сам (владелец 06.10.2026).
  const toShop = () => {
    useShopGift.getState().setTab('today')
    setScreen('rubies')
    window.setTimeout(() => document.querySelector('#s-rubies')?.scrollTo?.({ top: 0 }), 50)
  }
  const left = view.nextInS === null ? null : Math.max(0, view.nextInS - Math.floor((Date.now() - at) / 1000))
  return (
    <button
      className={'play-chest' + (view.ready ? ' go' : '')}
      id="playChest"
      data-track="lobby_play_chest"
      // Готов — открываем прямо здесь (07.10.2026: игрок жал «Забрать» и попадал в магазин); нет — в «Бонусы».
      onClick={() => (view.ready ? void usePlayChests.getState().claim() : toShop())}
    >
      <Icon id="i-chest" />
      {view.ready ? (
        <>Открыть сундук{view.ready > 1 ? ' ×' + view.ready : ''}</>
      ) : left !== null ? (
        <>
          Сундук через <b>{playLeftText(left)}</b>
        </>
      ) : (
        <>Сундуки — завтра</>
      )}
      <PlayPips n={view.limit} filled={view.earned} />
    </button>
  )
}

/**
 * Строка под «Играть»: сколько ждать сундук дня или «Забрать сундук»
 * (владелец 06.10.2026: таймер — на главной, а не в магазине). В первый день,
 * пока игра ни разу не запускалась, — обещание сундука за первый час.
 */
export function PlayChest({ on, dayZero }: { on: boolean; dayZero: boolean }) {
  const status = useDaily((s) => s.status)
  const play = usePlayChests((s) => s.view)
  const failed = useDaily((s) => s.failed)
  const signedIn = hasMillidaAccount()
  const ready = dailyReady(status)
  const left = useCountdown(nextResetAt(status), on && !!status && !ready && !dayZero, () => void useDaily.getState().load())

  // Первый день и все дни: сундуки за игру (вещь навсегда за первый час отменена, 06.10.2026).
  if (dayZero) return <PlayChestLine on={on} />
  if (!signedIn || (failed && !status)) return null
  if (!status) {
    return (
      <div className="play-chest" aria-busy="true">
        <span className="skel play-chest-skel" />
      </div>
    )
  }
  if (ready) {
    return (
      <button className="play-chest go" id="playChest" data-track="lobby_chest_claim" onClick={() => useDaily.getState().setModal(true)}>
        <Icon id="i-chest" />
        Забрать сундук
      </button>
    )
  }
  // Бонус дня забран — строка про сундуки за игру; их нет (старая служба) — таймер бонуса.
  if (play) return <PlayChestLine on={on} />
  return (
    <div className="play-chest" id="playChest">
      <Icon id="i-chest" />
      Сундук через <b>{chestTimerText(left)}</b>
      <PlayChestLine on={on} />
    </div>
  )
}
