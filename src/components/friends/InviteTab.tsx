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
  tierRewardParts,
  tierRewardText,
} from '../../lib/referrals'
import type { InviteOverview, InvitePerk } from '../../lib/referrals'
import { FRIENDS_TAB_EVENT } from './friendsView'
import { INVITEE_GIFTS } from '../../lib/inviteGifts'
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

function clock(seconds: number) {
  const m = Math.floor(Math.max(0, seconds) / 60)
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0')
}

/// Что получил ты сам, когда тебя позвали: три плитки, каждая — сделано или в пути.
function InviteeGifts({ gifts }: { gifts: NonNullable<InviteOverview['invitee']> }) {
  const chest = gifts.chest
  const state = {
    rubies: { done: !!gifts.badge, note: '' },
    chest: { done: chest.granted, note: chest.granted ? '' : clock(chest.playSeconds) + ' / ' + clock(chest.needSeconds) },
    plus: { done: gifts.plus.granted, note: gifts.plus.granted ? '' : 'после 2 ч' },
  }
  return (
    <div className="card inv-card">
      <div className="inv-title">
        <Icon id="i-gift" />
        Твои подарки
      </div>
      <div className="inv-gifts">
        {INVITEE_GIFTS.map((g) => (
          <div key={g.id} className={'inv-gift' + (state[g.id].done ? ' on' : '')}>
            <Icon id={g.icon} />
            <b>{g.title}</b>
            <small>{state[g.id].done ? 'Получено' : state[g.id].note}</small>
          </div>
        ))}
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
      {data.invitee ? <InviteeGifts gifts={data.invitee} /> : null}

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
          {'+' + daysText(data.perFriendPlusDays) + ' PLUS за друга · ' + hours + ' ч за ' + data.rules.playDays + ' дня'}
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
            // Клетка лестницы (QA 06.10.2026: «Иконка «Аметист» + Эпический сундук» в 3–4 строки):
            // число друзей сверху, каждая награда — своя строка со своим значком, одна строка на награду.
            <li key={t.friends} className={'inv-step' + (t.reached ? ' on' : '')}>
              <span className="inv-step-top">
                <span className="inv-step-n">{t.friends}</span>
                {t.granted ? (
                  <Icon id="i-check" className="icon inv-step-ok" />
                ) : t.reached && t.delayed ? (
                  <Icon id="i-clock" className="icon inv-step-wait" />
                ) : null}
              </span>
              {stepLines(t).map((line) => (
                <span key={line.text} className="inv-step-r">
                  <Icon id={line.icon} />
                  <span>{line.text}</span>
                </span>
              ))}
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

/** Строки клетки лестницы: первая особая награда, сундук, дни PLUS — не больше двух. */
function stepLines(t: { perks: { kind: string; name: string }[]; chest?: string | null; chestName?: string | null; plusDays: number }): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = []
  const perk = t.perks[0]
  if (perk) out.push({ icon: perk.kind === 'icon' ? 'i-image' : 'i-crown', text: tierRewardParts({ plusDays: 0, chestName: null, perks: [perk] as InvitePerk[] })[0]! })
  if (t.chestName) out.push({ icon: 'i-chest', text: t.chestName })
  if (t.plusDays > 0) out.push({ icon: 'i-crown', text: daysText(t.plusDays) + ' PLUS' })
  return out.slice(0, 2)
}
