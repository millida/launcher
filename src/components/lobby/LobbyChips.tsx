import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { hasMillidaAccount } from '../../lib/api'
import { partyFull } from '../../lib/party'
import { openPvp } from '../../state/pvp'
import { useTiers } from '../../state/tiers'
import { stopMateSearch, useMateSearch } from '../../state/mateSearch'
import { closeRoom, partyWithOthers, usePartyStore } from '../../state/party'
import { showToast } from '../../state/ui'
import { tierNick } from '../top/TierBoard'
import { useT } from '../../i18n'
import { TIERS_SECTION_PUBLIC } from '../../lib/tiersSection'
import { liveInterval } from '../../lib/liveInterval'

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** Счётчик поиска на самой кнопке: тикает, только пока поиск идёт. */
function SearchClock({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    return liveInterval(() => setNow(Date.now()), 1000)
  }, [])
  return <span className="lchip-clock">{clock(now - since)}</span>
}

/**
 * Над доком «Играть» — топ недели и пати. Неделя считается по приросту ELO в
 * рейтинговых боях, а не по тиру (владелец 12.10.2026): в топе — твоё место и
 * прирост, нет — зовёт войти.
 *
 * Пати — две кнопки рядом (владелец 12.10.2026: «позвать друга — другая кнопка
 * около поиска пати; отмену сделай интуитивной»): «Найти пати» на том же месте
 * превращается в «Отмена · 0:12», как Play → Cancel в Fortnite; «Позвать друга»
 * открывает меню с друзьями в сети. В пати и при поиске топ недели уходит.
 */
export function LobbyChips({ on }: { on: boolean }) {
  const t = useT()
  const signedIn = hasMillidaAccount()
  const nick = signedIn ? tierNick() : ''
  const week = useTiers((s) => s.periodRows['week:all'])
  const row = nick && week ? week.find((r) => r.name.toLowerCase() === nick.toLowerCase()) ?? null : null
  const party = usePartyStore((s) => s.party)
  const searching = useMateSearch((s) => s.searching)
  const since = useMateSearch((s) => s.since)
  const together = partyWithOthers(party)
  const full = !!party && partyFull(party)

  useEffect(() => {
    if (on && TIERS_SECTION_PUBLIC) void useTiers.getState().loadPeriod('week', 'all')
  }, [on])

  const open = () => openPvp('play')
  const needAccount = () => showToast(t('Пати — с аккаунтом Millida'), 'error')
  // «Найти пати» открывает комнаты: видно, кто куда идёт, и вход одной кнопкой.
  const find = () => (signedIn ? usePartyStore.getState().set({ roomsOpen: true }) : needAccount())
  const me = usePartyStore((s) => s.me)
  const mine = !party || party.leaderId === me
  const roomOpen = !!party?.room?.open && mine
  const invite = () => (signedIn ? usePartyStore.getState().set({ inviteOpen: true }) : needAccount())

  return (
    <div className="lobby-chips">
      {TIERS_SECTION_PUBLIC && (
        <button className={'lchip lchip-tier' + (row ? '' : ' bait')} data-track="lobby_top" onClick={open}>
          <Icon id="i-trophy" />
          <b>{t('Топ недели')}</b>
          {row ? (
            <span className="lchip-pos">
              #{row.pos}
              <i>
                {(row.eloDelta ?? 0) >= 0 ? '+' : ''}
                {row.eloDelta ?? 0}
              </i>
            </span>
          ) : (
            <span className="lchip-go">{t('Войти в топ')}</span>
          )}
        </button>
      )}
      {full ? null : searching ? (
        <button className="lchip lchip-cancel" data-sound="close" data-track="party_search_cancel" onClick={() => void stopMateSearch()}>
          <Icon id="i-x" />
          <b>{t('Отмена')}</b>
          <SearchClock since={since} />
        </button>
      ) : roomOpen ? (
        <button className="lchip lchip-cancel" data-sound="close" data-track="party_room_close" onClick={() => void closeRoom()}>
          <Icon id="i-x" />
          <b>{t('Закрыть комнату')}</b>
          {party?.room?.since ? <SearchClock since={party.room.since} /> : null}
        </button>
      ) : together && !mine ? null : (
        <button className="lchip lchip-party" data-sound="open" data-track="party_rooms_open" aria-haspopup="dialog" onClick={find}>
          <Icon id="i-search" />
          <b>{together ? t('Комнаты') : t('Найти пати')}</b>
        </button>
      )}
      {full ? null : (
        <button className="lchip lchip-invite" data-sound="open" data-track="party_invite_open" aria-haspopup="dialog" onClick={invite}>
          <Icon id="i-users" />
          <b>{t('Позвать друга')}</b>
        </button>
      )}
    </div>
  )
}
