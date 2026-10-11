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
  joinPartyByCode,
  partyInviteCode,
  usePartyStore,
} from '../../state/party'
import { startMateSearch, stopMateSearch, useMateSearch } from '../../state/mateSearch'

interface FriendParty {
  userId: string
  size: number
  capacity: number
}

/** Who to call: friends first (online on top), or a short-lived code for anyone else. */
export function PartyInviteModal({ close }: { close: () => void }) {
  const friends = useFriends((s) => s.friends)
  const party = usePartyStore((s) => s.party)
  const searching = useMateSearch((s) => s.searching)
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

        <div className="party-code-row">
          <div className="input sm">
            <input
              placeholder="Код друга"
              maxLength={64}
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void join()}
            />
          </div>
          {entry.trim() ? (
            <button className="btn sm" disabled={busy === 'join'} onClick={() => void join()}>
              <Icon id="i-login" />
              Войти
            </button>
          ) : code ? (
            <button className="btn sm secondary party-my-code" onClick={() => void copy()} title={minutesLeft + ' мин'}>
              <b>{prettyPartyCode(code.code)}</b>
              <Icon id="i-copy" />
            </button>
          ) : (
            <button className="btn sm secondary" disabled={busy === 'code' || full} onClick={() => void makeCode()}>
              <Icon id="i-link" />
              Мой код
            </button>
          )}
        </div>

        {/* Strangers are the fallback, not the first choice: the search used to sit
            next to «+» on every seat and pulled unknown players into the lobby. */}
        {full ? null : searching ? (
          <button className="btn sm secondary party-find" onClick={() => void stopMateSearch()}>
            <Icon id="i-x" />
            Отменить поиск напарника
          </button>
        ) : (
          <button
            className="btn sm secondary party-find"
            onClick={() => {
              close()
              void startMateSearch()
            }}
          >
            <Icon id="i-search" />
            Найти напарника
          </button>
        )}
      </div>
    </div>
  )
}
