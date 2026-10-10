import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { partyCodeOk, prettyPartyCode } from '../../lib/party'
import { loadFriends, useFriends } from '../../state/friends'
import { showToast } from '../../state/ui'
import {
  inviteToParty,
  isLeader,
  joinPartyByCode,
  partyInviteCode,
  setPartyCapacity,
  usePartyStore,
} from '../../state/party'

interface FriendParty {
  userId: string
  size: number
  capacity: number
}

/** Who to call: friends first (online on top), or a short-lived code for anyone else. */
export function PartyInviteModal({ close }: { close: () => void }) {
  const friends = useFriends((s) => s.friends)
  const party = usePartyStore((s) => s.party)
  const me = usePartyStore((s) => s.me)
  const [called, setCalled] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [entry, setEntry] = useState('')
  const [q, setQ] = useState('')
  const [elsewhere, setElsewhere] = useState<Record<string, FriendParty>>({})

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [close])

  useEffect(() => {
    void loadFriends()
    let alive = true
    api<{ parties: FriendParty[] }>('/party/friends')
      .then((r) => {
        if (!alive) return
        setElsewhere(Object.fromEntries((r.parties || []).map((p) => [p.userId, p])))
      })
      .catch((e) => console.error('[party] friends', e))
    return () => {
      alive = false
    }
  }, [])

  const inside = new Set((party?.members || []).map((m) => m.userId))
  const full = !!party && party.members.length >= party.capacity
  const needle = q.trim().toLowerCase()
  const list = useMemo(
    () =>
      friends
        .filter((f) => !needle || (f.nickname || '').toLowerCase().includes(needle))
        .sort((a, b) => Number(!!b.online) - Number(!!a.online))
        .slice(0, 40),
    [friends, needle],
  )

  const call = async (userId: string) => {
    setBusy(userId)
    const ok = await inviteToParty(userId)
    setBusy('')
    if (ok) setCalled((c) => ({ ...c, [userId]: true }))
  }

  const makeCode = async () => {
    setBusy('code')
    const r = await partyInviteCode()
    setBusy('')
    if (r) setCode({ code: r.code, expiresAt: r.expiresAt })
  }

  const copy = async () => {
    if (!code) return
    if (await copyText(prettyPartyCode(code.code))) showToast('Код скопирован')
    else showToast('Не удалось скопировать', 'error')
  }

  const join = async () => {
    if (!partyCodeOk(entry)) {
      showToast('Код из 8 знаков, например AB23-CD45', 'error')
      return
    }
    setBusy('join')
    const joined = await joinPartyByCode(entry)
    setBusy('')
    if (joined) close()
  }

  const leader = isLeader(party, me)
  const minutesLeft = code ? Math.max(1, Math.round((code.expiresAt - Date.now()) / 60_000)) : 0

  return (
    <div className="room-modal-back" onClick={close}>
      <div className="room-modal party-modal" data-private data-section="party" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-users" />
          </span>
          <b>Позвать в пати</b>
          <button className="tb-btn" aria-label="Закрыть" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>

        {friends.length > 6 ? (
          <div className="input sm room-pick-search">
            <Icon id="i-search" />
            <input placeholder="Найти друга…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}
        <div className="room-pick">
          {list.map((f) => {
            const here = inside.has(f.userId)
            const other = elsewhere[f.userId]
            const done = called[f.userId]
            return (
              <div key={f.userId} className={'room-pick-row' + (here ? ' off' : '')}>
                <Head nick={f.nickname} src={f.avatarUrl} size={28} />
                <span className="room-pick-nick">{f.nickname || ''}</span>
                {here ? (
                  <span className="room-pick-note">в пати</span>
                ) : (
                  <>
                    {other ? <span className="room-pick-note">{'в пати ' + other.size + '/' + other.capacity}</span> : null}
                    <button
                      className="btn sm secondary"
                      disabled={full || done || busy === f.userId}
                      onClick={() => void call(f.userId)}
                    >
                      <Icon id={done ? 'i-check' : 'i-send'} />
                      {done ? 'Позвали' : 'Позвать'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
          {!friends.length ? <p className="faint-note">Друзей пока нет — дай код</p> : null}
        </div>

        <div className="side-cap">Код пати</div>
        {code ? (
          <div className="party-code">
            <b>{prettyPartyCode(code.code)}</b>
            <span className="meta">{minutesLeft + ' мин'}</span>
            <button className="btn sm secondary" onClick={() => void copy()}>
              <Icon id="i-copy" />
              Копировать
            </button>
          </div>
        ) : (
          <button className="btn sm secondary" disabled={busy === 'code' || full} onClick={() => void makeCode()}>
            <Icon id="i-link" />
            Получить код
          </button>
        )}

        <div className="side-cap">Войти по коду</div>
        <div className="wm-row">
          <div className="input sm" style={{ flex: 1 }}>
            <input
              placeholder="AB23-CD45"
              maxLength={64}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void join()}
            />
          </div>
          <button className="btn sm secondary" disabled={busy === 'join' || !entry.trim()} onClick={() => void join()}>
            <Icon id="i-login" />
            Войти
          </button>
        </div>

        {leader && party ? (
          <>
            <div className="side-cap">Мест в пати</div>
            <div className="party-size">
              <button
                className="btn sm secondary"
                aria-label="Меньше мест"
                disabled={party.capacity <= Math.max(2, party.members.length)}
                onClick={() => void setPartyCapacity(party.capacity - 1)}
              >
                <Icon id="i-minus" />
              </button>
              <b>{party.capacity}</b>
              <button
                className="btn sm secondary"
                aria-label="Больше мест"
                disabled={party.capacity >= party.maxCapacity}
                onClick={() => void setPartyCapacity(party.capacity + 1)}
              >
                <Icon id="i-plus" />
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
