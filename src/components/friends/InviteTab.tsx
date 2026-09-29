import { useEffect, useRef, useState } from 'react'
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
  tierProgress,
  tierRewardText,
} from '../../lib/referrals'
import type { InviteOverview } from '../../lib/referrals'
import { FRIENDS_TAB_EVENT } from './friendsView'
import '../../styles/pixel/invite.css'

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
  const [code, setCode] = useState(initial)
  const [busy, setBusy] = useState(false)
  const submit = () => {
    const value = normalizeInviteCode(code)
    if (!value || busy) return
    setBusy(true)
    applyInviteCode(value)
      .then((next) => {
        onApplied(next)
        showToast('Код друга принят', 'ok', 'achievement')
      })
      .catch((e) => {
        trackFailure('invite', e, { step: 'apply' })
        showToast(apiErrorText(e, 'Не удалось ввести код'), 'error')
      })
      .finally(() => setBusy(false))
  }
  return (
    <div className="card inv-card inv-apply">
      <div className="inv-title">
        <Icon id="i-gift" />
        Есть код друга?
      </div>
      <div className="inv-apply-row">
        <div className="input sm inv-apply-input">
          <Icon id="i-key" />
          <input
            placeholder="Код друга"
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
          Ввести
        </button>
      </div>
    </div>
  )
}

export function InviteTab({ on }: { on: boolean }) {
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
    showToast(ok ? what + ' скопирована' : 'Не удалось скопировать', ok ? 'ok' : 'error')
  }

  if (!data) {
    if (!failed) return <Skeleton />
    return (
      <div className="fr-blank">
        <Icon id="i-alert" />
        <b>Не удалось загрузить приглашения</b>
        <button className="btn sm secondary" data-track="invite_retry" onClick={load}>
          <Icon id="i-restart" />
          Повторить
        </button>
      </div>
    )
  }

  const hours = Math.round(data.rules.playSeconds / 3600)
  const nextTier = data.next ? data.tiers.find((t) => t.friends === data.next?.friends) : null

  return (
    <>
      {data.canApply ? <ApplyCode key={pendingCode} initial={pendingCode} onApplied={applied} /> : null}
      {data.invitedBy ? (
        <p className="faint-note inv-by">
          Тебя пригласил <b>{data.invitedBy.nickname || 'друг'}</b>
        </p>
      ) : null}

      <div className="card inv-card">
        <div className="inv-title">
          <Icon id="i-users" />
          Пригласи друга — получи PLUS
        </div>
        <div className="inv-code-row">
          <span className="inv-code" data-private>
            {data.code}
          </span>
          <button className="btn sm primary" data-track="invite_copy_link" onClick={() => void copy(data.link, 'Ссылка')}>
            <Icon id="i-link" />
            Копировать ссылку
          </button>
          <button className="btn sm secondary" data-track="invite_copy_code" onClick={() => void copy(data.code, 'Код')}>
            <Icon id="i-copy" />
            Код
          </button>
        </div>
        <p className="faint-note inv-rule">
          {'+' + daysText(data.perFriendPlusDays) + ' PLUS за друга, который наиграет ' + hours + ' ч'}
        </p>
      </div>

      <div className="card inv-card">
        <div className="inv-head">
          <span className="inv-title">
            <Icon id="i-trophy" />
            {'Засчитано: ' + friendsText(data.qualified)}
          </span>
          {data.earned.plusDays ? <span className="inv-earned">{'+' + daysText(data.earned.plusDays) + ' PLUS'}</span> : null}
        </div>
        {data.next && nextTier ? (
          <>
            <div className="bar inv-bar">
              <i style={{ width: Math.round(tierProgress(data.qualified, data.tiers) * 100) + '%' }} />
            </div>
            <p className="faint-note inv-next">{'Ещё ' + friendsText(data.next.left) + ' — ' + tierRewardText(nextTier)}</p>
          </>
        ) : null}
        <ol className="inv-ladder">
          {data.tiers.map((t) => (
            <li key={t.friends} className={'inv-step' + (t.reached ? ' on' : '')}>
              <span className="inv-step-n">{t.friends}</span>
              <Icon id={t.chest ? 'i-chest' : 'i-crown'} />
              <span className="inv-step-r">{tierRewardText(t)}</span>
              {t.granted ? <Icon id="i-check" className="icon inv-step-ok" /> : null}
            </li>
          ))}
        </ol>
      </div>

      {data.friends.length ? (
        <>
          <div className="fr-cap">{'Приглашённые · ' + data.friends.length}</div>
          {data.friends.map((f, i) => (
            <div className={'fr-row' + (f.status === 'rejected' ? ' off' : '')} key={(f.nickname || '') + f.invitedAt + i}>
              <Head nick={f.nickname || undefined} size={40} />
              <span className="fr-body">
                <span className="fr-nick">{f.nickname || 'Игрок'}</span>
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
          <b>Пока никого</b>
          <button className="btn sm primary" data-track="invite_copy_link_empty" onClick={() => void copy(data.link, 'Ссылка')}>
            <Icon id="i-link" />
            Копировать ссылку
          </button>
        </div>
      )}
    </>
  )
}
