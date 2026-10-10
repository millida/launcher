import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { reportPlayer, type ReportAsk, type ReportReason } from '../../state/party'

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'abuse', label: 'Оскорбления' },
  { id: 'inappropriate', label: 'Неприличное' },
  { id: 'spam', label: 'Спам' },
  { id: 'scam', label: 'Обман' },
  { id: 'cheating', label: 'Читы' },
  { id: 'other', label: 'Другое' },
]

/** A report picks a reason from the list; the server attaches where it happened. */
export function ReportModal({ ask, close }: { ask: ReportAsk; close: () => void }) {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [block, setBlock] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [close])

  const send = async () => {
    if (!reason) return
    setBusy(true)
    const ok = await reportPlayer(ask.userId, reason, ask.context, { refId: ask.refId, block })
    setBusy(false)
    if (ok) close()
  }

  return (
    <div className="room-modal-back" onClick={close}>
      <div className="room-modal party-modal" data-section="party-report" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-flag" />
          </span>
          <b>{'Жалоба на ' + ask.nick}</b>
          <button className="tb-btn" aria-label="Закрыть" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>
        <div className="party-chips">
          {REASONS.map((r) => (
            <button key={r.id} className={'party-tag pick' + (reason === r.id ? ' on' : '')} onClick={() => setReason(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <button className={'party-tag pick' + (block ? ' on' : '')} aria-pressed={block} onClick={() => setBlock(!block)}>
          <Icon id={block ? 'i-check' : 'i-ban'} />
          Заблокировать
        </button>
        <div className="room-modal-acts">
          <button className="btn sm ghost" onClick={close}>
            Отмена
          </button>
          <button className="btn sm primary" disabled={!reason || busy} onClick={() => void send()}>
            <Icon id="i-send" />
            Отправить
          </button>
        </div>
      </div>
    </div>
  )
}
