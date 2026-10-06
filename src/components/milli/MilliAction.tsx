import { useEffect, useState } from 'react'
import { PxArt } from './px'
import { actionState, maybeAutoRun, runAction, toggleRow, undoAction, useMilliActions } from '../../lib/milliActions'
import type { MilliAction, MilliActionKind, MilliActionRow } from '../../lib/milliActions'
import '../../lib/milliSteps'
import { startMilliDoctor } from '../../lib/milliDoctor'
import '../../styles/pixel/milli-action.css'

/*
 * Карточка действия Милли в чате: заголовок, строки «было → станет»,
 * одна кнопка «Применить», после — ✓/✕ по строкам и «Отменить».
 * Шаги выполняются только по нажатию (кроме разведки только на чтение).
 */

const KIND_PX: Record<MilliActionKind, string> = {
  graphics: 'spyglass',
  modcfg: 'comparator',
  backup: 'chest',
  restore: 'clock',
  import: 'ender_chest',
  diary: 'book_quill',
  doctor: 'crafting_table',
  update: 'compass',
  port: 'compass',
  crashfix: 'redstone',
}

// Pair A: шаги доктора, карточка вылета, тихий ежедневный осмотр — один раз на запуск.
try {
  startMilliDoctor()
} catch {}

const SEV_ORDER = { red: 0, yellow: 1, info: 2 } as const

function Row({ r, i, actionId, off, res, canPick }: { r: MilliActionRow; i: number; actionId: string; off: boolean; res?: { ok: boolean; detail?: string }; canPick: boolean }) {
  const [more, setMore] = useState(false)
  const icon = r.icon && /^https:\/\//.test(r.icon) ? <img src={r.icon} alt="" loading="lazy" /> : r.icon ? <PxArt name={r.icon} size={16} /> : null
  return (
    <>
      <li className={'mact-row' + (off ? ' off' : '') + (r.sev && r.sev !== 'info' ? ' ' + r.sev : '')} style={{ ['--i' as string]: i }}>
        {r.optional && canPick ? (
          <input type="checkbox" className="mact-chk" checked={!off} onChange={() => toggleRow(actionId, r.id)} aria-label={r.label} />
        ) : null}
        {icon}
        <span className="mact-k" title={r.label}>
          {r.label}
        </span>
        {r.from != null || r.to != null ? (
          <span className="mact-v">
            {r.from != null ? <s>{r.from}</s> : null}
            {r.from != null && r.to != null ? <span aria-hidden="true">→</span> : null}
            {r.to != null ? <b>{r.to}</b> : null}
          </span>
        ) : null}
        {res ? (
          <span className={'mact-ok ' + (res.ok ? 'y' : 'n')} title={res.detail}>
            {res.ok ? '✓' : '✕'}
          </span>
        ) : null}
        {r.note && !more ? (
          <button type="button" className="mact-more" onClick={() => setMore(true)} aria-label="Подробнее">
            ?
          </button>
        ) : null}
      </li>
      {more && r.note ? <p className="mact-note">{r.note}</p> : null}
      {res && !res.ok && res.detail ? <p className="mact-note">{res.detail}</p> : null}
    </>
  )
}

export function MilliActionCard({ action }: { action: MilliAction }) {
  // Состояние живёт в сторе: перерисовка ленты и возврат в чат его не сбрасывают.
  useEffect(() => {
    actionState(action)
    maybeAutoRun(action)
  }, [action])
  const st = useMilliActions((s) => s.byId[action.id])
  const a = st?.action ?? action
  const phase = st?.phase ?? 'ready'
  const off = st?.off ?? []
  const rows = [...a.rows].sort((x, y) => SEV_ORDER[x.sev ?? 'info'] - SEV_ORDER[y.sev ?? 'info'])
  const busy = phase === 'running' || phase === 'undoing'
  const nothing = a.rows.length > 0 && a.rows.every((r) => off.includes(r.id))
  const auto = a.auto && phase === 'running'

  return (
    <div className="mact" data-kind={a.kind} data-phase={phase} aria-live="polite">
      <div className="mact-head">
        <PxArt name={KIND_PX[a.kind] ?? 'comparator'} size={16} />
        <span>{a.title}</span>
        {a.profile ? <span className="mact-tag">{a.profile}</span> : null}
      </div>
      {rows.length ? (
        <ul className="mact-rows">
          {rows.map((r, i) => (
            <Row key={r.id} r={r} i={i} actionId={a.id} off={off.includes(r.id)} res={st?.rows[r.id]} canPick={phase === 'ready'} />
          ))}
        </ul>
      ) : null}
      <div className="mact-foot">
        {phase === 'ready' || phase === 'failed' ? (
          a.auto || !a.steps.length ? null : (
            <button type="button" className="btn primary sm" disabled={nothing} data-track="milli_action_apply" data-kind={a.kind} onClick={() => void runAction(a.id)}>
              {phase === 'failed' ? 'Ещё раз' : a.cta || 'Применить'}
            </button>
          )
        ) : null}
        {busy ? <span className="mact-msg">{auto ? 'Смотрю…' : phase === 'undoing' ? 'Возвращаю…' : 'Делаю…'}</span> : null}
        {phase === 'done' ? (
          <>
            <span className="mact-msg">{a.restart ? 'Готово · перезапусти игру' : 'Готово'}</span>
            {st?.undo.length ? (
              <button type="button" className="btn ghost sm" data-track="milli_action_undo" data-kind={a.kind} onClick={() => void undoAction(a.id)}>
                Отменить
              </button>
            ) : null}
          </>
        ) : null}
        {phase === 'undone' ? <span className="mact-msg">Вернула как было</span> : null}
        {st?.error ? <span className="mact-msg bad">{st.error}</span> : null}
      </div>
    </div>
  )
}
