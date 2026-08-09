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
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true, remember)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close, remember])

  if (!open) return null
  // Above other modals (z-index 400) so a confirm opened from a modal is not hidden behind it.
  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 700 }}
      {...backdropClose(() => close(false))}
    >
      <div className="modal" style={{ width: '400px' }}>
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
          <button className="btn md secondary" onClick={() => close(false)}>
            {cancelLabel}
          </button>
          <button
            className={'btn md ' + (danger ? 'danger' : 'primary')}
            data-nosound
            onClick={() => close(true, remember)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
