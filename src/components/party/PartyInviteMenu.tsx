import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { PARTY_SHOWCASE, SHOWCASE_FRIENDS } from '../../lib/demo'
import { partyCodeOk, prettyPartyCode } from '../../lib/party'
import { loadFriends, useFriends, type Friend } from '../../state/friends'
import { inviteToParty, joinPartyByCode, partyInviteCode, usePartyStore } from '../../state/party'
import { setScreen, showToast } from '../../state/ui'
import '../../styles/pixel/party-invite.css'
import { t, useT } from '../../i18n'
import { liveInterval } from '../../lib/liveInterval'

/** Сколько приглашение «висит» на кнопке, прежде чем её можно нажать снова. */
const INVITE_MS = 60_000

/** Кого уже позвали и до какого момента ждём: переживает закрытие меню. */
const useSent = create<{ until: Record<string, number> }>(() => ({ until: {} }))

interface FriendParty {
  userId: string
  size: number
  capacity: number
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** Чем занят друг — одной строкой под ником. */
function statusOf(f: Friend, other?: FriendParty): string {
  const party = other ? ' · ' + t('пати {n}/{max}', { n: other.size, max: other.capacity }) : ''
  if (!f.online) return t('Не в сети')
  const where = f.serverName || f.build
  if (f.place === 'game' || f.playing) return (where ? t('Играет: {where}', { where }) : t('Играет')) + party
  if (f.place === 'launcher') return t('В лаунчере') + party
  return t('На сайте') + party
}

function Row({ f, inside, full, other, now }: { f: Friend; inside: boolean; full: boolean; other?: FriendParty; now: number }) {
  const t = useT()
  const until = useSent((s) => s.until[f.userId] || 0)
  const [busy, setBusy] = useState(false)
  const waiting = until > now
  const call = async () => {
    if (busy) return
    // В показе настоящим друзьям приглашение не уходит: зовутся только боты.
    if (PARTY_SHOWCASE && !SHOWCASE_FRIENDS.some((b) => b.userId === f.userId)) return showToast(t('В показе зовутся только боты'), 'error')
    setBusy(true)
    const ok = await inviteToParty(f.userId)
    setBusy(false)
    if (ok) useSent.setState((s) => ({ until: { ...s.until, [f.userId]: Date.now() + INVITE_MS } }))
  }
  return (
    <div className={'pim-row' + (f.online ? '' : ' off')}>
      <span className="pim-ava">
        <Head nick={f.nickname || 'MHF_Steve'} src={f.avatarUrl} size={32} />
        {f.online ? <i className={'pim-dot' + (f.place === 'game' || f.playing ? ' game' : '')} /> : null}
      </span>
      <span className="pim-who">
        <b>{f.nickname || t('Друг')}</b>
        <span>{statusOf(f, other)}</span>
      </span>
      {inside ? (
        <span className="pim-in">
          <Icon id="i-check" />{t('В пати')}
        </span>
      ) : waiting ? (
        <span className="pim-wait">{t('Ждём {time}', { time: clock(until - now) })}</span>
      ) : (
        <button className="btn sm primary pim-call" data-track="party_invite" disabled={full || busy} onClick={() => void call()}>
          {t('Позвать')}
        </button>
      )}
    </div>
  )
}

/**
 * «Позвать друга» — раздел общего окна пати (владелец 12.10.2026: «тоже через
 * поп-ап»; до этого: «не пишется, кто онлайн»). Сверху те,
 * кто в сети (играющие — первыми) со строкой «чем занят», у каждого одна кнопка:
 * «Позвать» → «Ждём 0:58» → «В пати». Не в сети — свёрнуты. Внизу код пати.
 */
export function PartyInviteList({ close }: { close: () => void }) {
  const t = useT()
  const real = useFriends((s) => s.friends)
  const party = usePartyStore((s) => s.party)
  const [q, setQ] = useState('')
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState('')
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [entry, setEntry] = useState('')
  const [elsewhere, setElsewhere] = useState<Record<string, FriendParty>>({})
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    return liveInterval(() => setNow(Date.now()), 1000)
  }, [])

  useEffect(() => {
    void loadFriends()
    let alive = true
    api<{ parties: FriendParty[] }>('/party/friends')
      .then((r) => alive && setElsewhere(Object.fromEntries((r.parties || []).map((p) => [p.userId, p]))))
      .catch((e) => console.error('[party] friends', e))
    return () => {
      alive = false
    }
  }, [])

  const friends = useMemo<Friend[]>(
    () => (PARTY_SHOWCASE ? [...SHOWCASE_FRIENDS, ...real.filter((f) => !SHOWCASE_FRIENDS.some((b) => b.userId === f.userId))] : real),
    [real],
  )
  const inside = new Set((party?.members || []).map((m) => m.userId))
  const full = !!party && party.members.length >= party.capacity
  const needle = q.trim().toLowerCase()
  const match = (f: Friend) => !needle || (f.nickname || '').toLowerCase().includes(needle)
  const rank = (f: Friend) => (f.place === 'game' || f.playing ? 0 : f.place === 'launcher' ? 1 : 2)
  const online = friends.filter((f) => f.online && match(f)).sort((a, b) => rank(a) - rank(b))
  const offline = friends.filter((f) => !f.online && match(f))

  const makeCode = async () => {
    setBusy('code')
    const r = await partyInviteCode()
    setBusy('')
    if (!r) return
    setCode({ code: r.code, expiresAt: r.expiresAt })
    if (await copyText(prettyPartyCode(r.code))) showToast(t('Код скопирован — отправь другу'))
  }
  const copy = async () => {
    if (!code) return
    if (await copyText(prettyPartyCode(code.code))) showToast(t('Код скопирован'))
    else showToast(t('Не удалось скопировать'), 'error')
  }
  const join = async () => {
    if (!partyCodeOk(entry)) return showToast(t('Код из 8 знаков, например AB23-CD45'), 'error')
    setBusy('join')
    const joined = await joinPartyByCode(entry)
    setBusy('')
    if (joined) close()
  }

  return (
    <div className="pim-in-win" data-private data-section="party_invite">
        {friends.length > 6 ? (
          <div className="input sm pim-search">
            <Icon id="i-search" />
            <input placeholder={t('Ник друга')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}

        <div className="pim-list">
          {online.length ? <div className="pim-cap">{t('В сети · {n}', { n: online.length })}</div> : null}
          {online.map((f) => (
            <Row key={f.userId} f={f} inside={inside.has(f.userId)} full={full} other={elsewhere[f.userId]} now={now} />
          ))}
          {!friends.length ? (
            <div className="pim-empty">
              <Icon id="i-users" />
              <b>{t('Друзей пока нет')}</b>
              <button
                className="btn sm primary"
                onClick={() => {
                  close()
                  setScreen('friends')
                }}
              >
                {t('Найти друзей')}
              </button>
            </div>
          ) : !online.length && !needle ? (
            <div className="pim-empty">
              <Icon id="i-users" />
              <b>{t('Никого нет в сети')}</b>
            </div>
          ) : null}
          {offline.length ? (
            <button className="pim-cap pim-toggle" aria-expanded={showOff || !!needle} onClick={() => setShowOff((v) => !v)}>
              {t('Не в сети · {n}', { n: offline.length })}
              <Icon id="i-chev-d" className={'icon' + (showOff || needle ? ' up' : '')} />
            </button>
          ) : null}
          {showOff || needle
            ? offline.slice(0, 40).map((f) => <Row key={f.userId} f={f} inside={inside.has(f.userId)} full={full} other={elsewhere[f.userId]} now={now} />)
            : null}
        </div>

        <div className="pim-foot">
          {code ? (
            <button className="btn sm secondary pim-code" data-track="party_code_copy" onClick={() => void copy()}>
              <b>{prettyPartyCode(code.code)}</b>
              <Icon id="i-copy" />
            </button>
          ) : (
            <button className="btn sm secondary pim-code" data-track="party_code_make" disabled={busy === 'code' || full} onClick={() => void makeCode()}>
              <Icon id="i-link" />
              {t('Код пати')}
            </button>
          )}
          <div className="input sm pim-join">
            <input placeholder={t('Ввести код')} maxLength={64} value={entry} onChange={(e) => setEntry(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void join()} />
          </div>
          {entry.trim() ? (
            <button className="btn sm primary" disabled={busy === 'join'} onClick={() => void join()}>
              {t('Войти')}
            </button>
          ) : null}
        </div>
    </div>
  )
}
