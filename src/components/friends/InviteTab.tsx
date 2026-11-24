import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { copyText } from '../../lib/clipboard'
import { apiErrorText } from '../../lib/apiError'
import { trackFailure } from '../../lib/telemetry'
import { showToast } from '../../state/ui'
import {
  applyInviteCode,
  daysText,
  friendStatusText,
  friendsText,
  loadInvites,
  normalizeInviteCode,
  takeInviteCode,
} from '../../lib/referrals'
import type { InviteOverview } from '../../lib/referrals'
import { FRIENDS_TAB_EVENT } from './friendsView'
import { INVITEE_GIFTS } from '../../lib/inviteGifts'
import '../../styles/pixel/invite.css'
import { useT } from '../../i18n'

// The track pulls the pass styles and reward art: its own chunk, so the Friends screen's
// preload list in the startup bundle does not grow with it.
const InviteTrack = lazy(() => import('./InviteTrack').then((m) => ({ default: m.InviteTrack })))

function Skeleton() {
  return (
    <div className="card inv-card fr-skel">
      <span className="fr-skel-line" style={{ width: 180 }} />
      <span className="fr-skel-line" style={{ width: '100%', height: 44, marginTop: 14 }} />
      <span className="fr-skel-line sm" style={{ width: 240 }} />
    </div>
  )
}

function ApplyCode({ initial, onApplied }: { initial: string; onApplied: (next: InviteOverview) => void }) {
  const t = useT()
  const [code, setCode] = useState(initial)
  const [busy, setBusy] = useState(false)
  const submit = () => {
    const value = normalizeInviteCode(code)
    if (!value || busy) return
    setBusy(true)
    applyInviteCode(value)
      .then((next) => {
        onApplied(next)
        showToast(t('Код друга принят'), 'ok', 'achievement')
      })
      .catch((e) => {
        trackFailure('invite', e, { step: 'apply' })
        showToast(apiErrorText(e, t('Не удалось ввести код')), 'error')
      })
      .finally(() => setBusy(false))
  }
  return (
    <div className="card inv-card inv-apply">
      <div className="inv-title">
        <Icon id="i-gift" />
        {t('Есть код друга?')}
      </div>
      <div className="inv-apply-row">
        <div className="input sm inv-apply-input">
          <Icon id="i-key" />
          <input
            placeholder={t('Код друга')}
            value={code}
            maxLength={16}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>
        <button className="btn sm primary" data-track="invite_apply" disabled={busy || !normalizeInviteCode(code)} onClick={submit}>
          <Icon id="i-check" />
          {t('Ввести')}
        </button>
      </div>
    </div>
  )
}

function clock(seconds: number) {
  const m = Math.floor(Math.max(0, seconds) / 60)
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0')
}

/// Что получил ты сам, когда тебя позвали: три плитки, каждая — сделано или в пути.
function InviteeGifts({ gifts }: { gifts: NonNullable<InviteOverview['invitee']> }) {
  const t = useT()
  const chest = gifts.chest
  const state = {
    rubies: { done: !!gifts.badge, note: '' },
    chest: { done: chest.granted, note: chest.granted ? '' : clock(chest.playSeconds) + ' / ' + clock(chest.needSeconds) },
    plus: { done: gifts.plus.granted, note: gifts.plus.granted ? '' : t('после 2 ч') },
  }
  return (
    <div className="card inv-card">
      <div className="inv-title">
        <Icon id="i-gift" />
        {t('Твои подарки')}
      </div>
      <div className="inv-gifts">
        {INVITEE_GIFTS.map((g) => (
          <div key={g.id} className={'inv-gift' + (state[g.id].done ? ' on' : '')}>
            <Icon id={g.icon} />
            <b>{g.title}</b>
            <small>{state[g.id].done ? t('Получено') : state[g.id].note}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

export function InviteTab({ on }: { on: boolean }) {
  const t = useT()
  const [data, setData] = useState<InviteOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [pendingCode, setPendingCode] = useState('')
  const seq = useRef(0)

  const load = () => {
    const mine = ++seq.current
    setFailed(false)
    loadInvites()
      .then((next) => {
        if (mine === seq.current) setData(next)
      })
      .catch((e) => {
        if (mine !== seq.current) return
        trackFailure('invite', e, { step: 'load' })
        setFailed(true)
      })
  }

  const refresh = () => {
    const code = takeInviteCode()
    if (code) setPendingCode(code)
    load()
  }

  useEffect(() => {
    if (on) refresh()
  }, [on])

  useEffect(() => {
    const reopen = (e: Event) => {
      if ((e as CustomEvent).detail === 'invite') refresh()
    }
    window.addEventListener(FRIENDS_TAB_EVENT, reopen)
    return () => window.removeEventListener(FRIENDS_TAB_EVENT, reopen)
  }, [])

  const applied = (next: InviteOverview) => {
    seq.current++
    setData(next)
  }

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    showToast(ok ? t('{what} скопирована', { what }) : t('Не удалось скопировать'), ok ? 'ok' : 'error')
  }

  if (!data) {
    if (!failed) return <Skeleton />
    return (
      <div className="fr-blank">
        <Icon id="i-alert" />
        <b>{t('Не удалось загрузить приглашения')}</b>
        <button className="btn sm secondary" data-track="invite_retry" onClick={load}>
          <Icon id="i-restart" />
          {t('Повторить')}
        </button>
      </div>
    )
  }

  const hours = Math.round(data.rules.playSeconds / 3600)

  return (
    <>
      {data.canApply ? <ApplyCode key={pendingCode} initial={pendingCode} onApplied={applied} /> : null}
      {data.invitedBy ? (
        <p className="faint-note inv-by">
          {t('Тебя пригласил')} <b>{data.invitedBy.nickname || t('друг')}</b>
        </p>
      ) : null}
      {data.invitee ? <InviteeGifts gifts={data.invitee} /> : null}

      <div className="card inv-card">
        <div className="inv-title">
          <Icon id="i-users" />
          {t('Пригласи друга — получи PLUS')}
        </div>
        <div className="inv-code-row">
          <span className="inv-code" data-private>
            {data.code}
          </span>
          <button className="btn sm primary" data-track="invite_copy_link" onClick={() => void copy(data.link, t('Ссылка'))}>
            <Icon id="i-link" />
            {t('Копировать ссылку')}
          </button>
          <button className="btn sm secondary" data-track="invite_copy_code" onClick={() => void copy(data.code, t('Код'))}>
            <Icon id="i-copy" />
            {t('Код')}
          </button>
        </div>
        <p className="faint-note inv-rule">
          {t('+{days} PLUS за друга · {hours} ч за {n} дня', { days: daysText(data.perFriendPlusDays), hours, n: data.rules.playDays })}
        </p>
      </div>

      <Suspense fallback={<div className="card inv-card fr-skel" style={{ height: 300 }} />}>
        <InviteTrack data={data} />
      </Suspense>
      {data.tiers.some((step) => step.reached && !step.granted) ? (
        <p className="faint-note inv-rule">
          {t('Награда за ступень приходит сама, нажимать ничего не нужно: сундуки — в «Мои сундуки», PLUS — на аккаунт. Ступени с часами выдаются через 72 часа. Прошло больше трёх дней — напиши в поддержку.')}
        </p>
      ) : null}
      {data.pending > 0 ? (
        <p className="faint-note inv-rule">
          {t('Ещё не засчитаны: {friends}. Друг засчитывается, когда наиграет {hours} ч за {n} дня.', {
            friends: friendsText(data.pending),
            hours,
            n: data.rules.playDays,
          })}
        </p>
      ) : null}

      {data.friends.length ? (
        <>
          <div className="fr-cap">{t('Приглашённые · {n}', { n: data.friends.length })}</div>
          {data.friends.map((f, i) => (
            <div className={'fr-row' + (f.status === 'rejected' ? ' off' : '')} key={(f.nickname || '') + f.invitedAt + i}>
              <Head nick={f.nickname || undefined} size={40} />
              <span className="fr-body">
                <span className="fr-nick">{f.nickname || t('Игрок')}</span>
                <span className={'fr-status inv-st-' + f.status}>
                  <Icon id={f.status === 'qualified' ? 'i-check' : f.status === 'rejected' ? 'i-ban' : 'i-clock'} />
                  {friendStatusText(f, data.rules.playSeconds)}
                </span>
              </span>
            </div>
          ))}
        </>
      ) : (
        <div className="fr-blank">
          <Icon id="i-gift" />
          <b>{t('Пока никого')}</b>
          <button className="btn sm primary" data-track="invite_copy_link_empty" onClick={() => void copy(data.link, t('Ссылка'))}>
            <Icon id="i-link" />
            {t('Копировать ссылку')}
          </button>
        </div>
      )}
    </>
  )
}
