import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { reportPlayer, type ReportAsk, type ReportReason } from '../../state/party'
import { t, useT } from '../../i18n'

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'abuse', get label() { return t('Оскорбления') } },
  { id: 'inappropriate', get label() { return t('Неприличное') } },
  { id: 'spam', get label() { return t('Спам') } },
  { id: 'scam', get label() { return t('Обман') } },
  { id: 'cheating', get label() { return t('Читы') } },
  { id: 'other', get label() { return t('Другое') } },
]

/** A report picks a reason from the list; the server attaches where it happened. */
export function ReportModal({ ask, close }: { ask: ReportAsk; close: () => void }) {
  const t = useT()
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
          <b>{t('Жалоба на {nick}', { nick: ask.nick })}</b>
          <button className="tb-btn" aria-label={t('Закрыть')} onClick={close}>
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
          {t('Заблокировать')}
        </button>
        <div className="room-modal-acts">
          <button className="btn sm ghost" onClick={close}>
            {t('Отмена')}
          </button>
          <button className="btn sm primary" disabled={!reason || busy} onClick={() => void send()}>
            <Icon id="i-send" />
            {t('Отправить')}
          </button>
        </div>
      </div>
    </div>
  )
}
