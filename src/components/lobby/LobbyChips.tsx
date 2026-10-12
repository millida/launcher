import { useEffect } from 'react'
import { Icon } from '../Icon'
import { hasMillidaAccount } from '../../lib/api'
import { openTop } from '../../state/boards'
import { bestTier, playerTiers, useTiers } from '../../state/tiers'
import { TierBadge, tierNick } from '../top/TierBoard'

/**
 * Над доком «Играть» — одна кнопка в топ (владелец 11.10.2026: огоньки
 * переехали к нику, место по часам убрано, «топ недели — кнопка войти в топ»).
 * Ведёт на PvP-топ: тир-лист и вход на сервер, где определяют тир.
 * Тир уже есть — на кнопке он, нет — зовёт войти в топ.
 */
export function LobbyChips({ on }: { on: boolean }) {
  const signedIn = hasMillidaAccount()
  const nick = signedIn ? tierNick() : ''
  const me = useTiers((s) => (s.nick === nick ? s.me : undefined))
  const modes = useTiers((s) => s.modes)
  const tier = me ? bestTier(playerTiers(me), modes.map((m) => m.slug)) : null

  useEffect(() => {
    if (on) void useTiers.getState().load(nick)
  }, [on, nick])

  return (
    <div className="lobby-chips">
      <button className={'lchip lchip-tier' + (tier ? '' : ' bait')} data-track="lobby_top" onClick={() => openTop('tiers')}>
        <Icon id="i-trophy" />
        <b>Топ недели</b>
        {tier ? <TierBadge tier={tier.tier} /> : <span className="lchip-go">Войти в топ</span>}
      </button>
    </div>
  )
}
