import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateInfo } from '../../ipc/commands'
import { renderMarkdown } from '../../lib/markdown'
import { backdropClose } from '../../lib/dismiss'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

export function UpdateAllModal({
  updates,
  titleOf,
  onConfirm,
  onClose,
}: {
  updates: UpdateInfo[]
  titleOf: (file: string) => string
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(updates.length === 1 ? updates[0]!.file_name : null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-bg open vis" style={{ zIndex: 970 }} {...backdropClose(onClose)}>
      <div className="modal mw-md bx-upd">
        <h3>{t('Что изменится · {n}', { n: updates.length })}</h3>
        <div className="bx-upd-list">
          {updates.map((u) => {
            const shown = open === u.file_name
            const notes = (u.changelog || '').trim()
            return (
              <div className={'bx-upd-row' + (shown ? ' open' : '')} key={u.file_name}>
                <button type="button" className="bx-upd-head" aria-expanded={shown} disabled={!notes} onClick={() => setOpen(shown ? null : u.file_name)}>
                  <b>{u.title || titleOf(u.file_name)}</b>
                  <span className="bx-upd-ver">
                    {u.old_version_number || '—'} <Icon id="i-arrow-r" /> {u.new_version_number}
                  </span>
                  {notes ? <Icon id="i-chev-d" /> : null}
                </button>
                {shown && notes ? <div className="bx-upd-notes md-body">{renderMarkdown(notes)}</div> : null}
              </div>
            )
          })}
        </div>
        <div className="bx-upd-acts">
          <button className="btn md secondary" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn md primary" autoFocus onClick={onConfirm}>
            <Icon id="i-arrow-up" /> {t('Обновить всё')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
