import { useEffect } from 'react'
import { useConfirm } from '../state/confirm'

export function ConfirmModal() {
  const { open, title, message, confirmLabel, cancelLabel, danger, close } = useConfirm()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  // Above other modals (z-index 400) so a confirm opened from a modal is not hidden behind it.
  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 700 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <div className="modal" style={{ width: '400px' }}>
        <h3>{title}</h3>
        <div className="sub" style={{ marginTop: '6px' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '22px' }}>
          <button className="btn md secondary" onClick={() => close(false)}>
            {cancelLabel}
          </button>
          <button
            className={'btn md ' + (danger ? 'danger' : 'primary')}
            data-nosound
            onClick={() => close(true)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
