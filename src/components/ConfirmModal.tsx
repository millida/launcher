import { useEffect, useState } from 'react'
import { useConfirm } from '../state/confirm'
import { backdropClose } from '../lib/dismiss'

export function ConfirmModal() {
  const { open, title, message, confirmLabel, cancelLabel, danger, rememberKey, rememberLabel, close } = useConfirm()
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (open) setRemember(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('dismiss')
      if (e.key === 'Enter') close('yes', remember)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close, remember])

  if (!open) return null
  // Above every window a confirm can be opened from: ordinary modals sit at 400,
  // the room member list at 960 — under it the question about leaving the group
  // or kicking someone was invisible while the launcher waited for an answer.
  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 980 }}
      {...backdropClose(() => close('dismiss'))}
    >
      <div className="modal mw-xs">
        <h3>{title}</h3>
        <div className="sub" style={{ marginTop: '6px' }}>
          {message}
        </div>
        {rememberKey ? (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              marginTop: '18px',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--m-fg-muted)',
            }}
            onClick={(e) => {
              e.preventDefault()
              setRemember(!remember)
            }}
          >
            <span className={'chk' + (remember ? ' on' : '')}></span>
            {rememberLabel}
          </label>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '22px' }}>
          <button className="btn md secondary" onClick={() => close('no')}>
            {cancelLabel}
          </button>
          <button
            className={'btn md ' + (danger ? 'danger' : 'primary')}
            data-nosound
            onClick={() => close('yes', remember)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
