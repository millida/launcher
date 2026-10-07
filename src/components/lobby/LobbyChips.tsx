import { useEffect } from 'react'
import { Icon } from '../Icon'
import { hasMillidaAccount } from '../../lib/api'
import { useDaily } from '../../state/daily'
import { openTop, useBoards } from '../../state/boards'
import { daysWord } from '../daily/track'

/**
 * Над доком «Играть»: серия дней (огонь, щит, если пропуск простится) и место
 * в топе недели по часам (владелец 06.10.2026: «показывать серию и топ»).
 * Огонь открывает доску «Огоньки», место — доску «Неделя» (экран «Топ»).
 */
export function LobbyChips({ on }: { on: boolean }) {
  const status = useDaily((s) => s.status)
  const loading = useDaily((s) => s.loading)
  const me = useBoards((s) => s.views.week?.me ?? null)
  const signedIn = hasMillidaAccount()

  useEffect(() => {
    if (on && signedIn) void useBoards.getState().load('week')
  }, [on, signedIn])

  if (!signedIn) return null
  const streak = status?.streak ?? 0

  return (
    <div className="lobby-chips">
      {/* Скелетон — только пока статус грузится; не пришёл — чипа нет вовсе
          (раньше на месте огня навсегда оставалась пустая тёмная плашка). */}
      {!status ? (
        loading ? <span className="lchip skel lchip-skel" aria-hidden="true" /> : null
      ) : streak > 0 ? (
        <button
          className={'lchip lchip-streak' + (status.activeToday === false ? ' pending' : ' lit')}
          data-track="lobby_streak"
          aria-label={'Серия ' + daysWord(streak)}
          onClick={() => openTop('streak')}
        >
          <Icon id="i-flame" />
          <b>{daysWord(streak)}</b>
        </button>
      ) : null}
      {me ? (
        <button
          className="lchip lchip-top"
          data-track="lobby_week_top"
          onClick={() => openTop('week')}
        >
          <Icon id="i-trophy" />
          <b>{'#' + me.rank}</b>
          за неделю
        </button>
      ) : null}
    </div>
  )
}
