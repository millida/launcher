import { renderMarkdown } from '../lib/markdown'
import { backdropClose } from '../lib/dismiss'
import { useWhatsNew } from '../state/whatsNew'
import { closeModal, useUi } from '../state/ui'

/// The shared renderer knows headings, not lists, and breaks a line only on a
/// blank one: a changelog written as normal Markdown arrived as one run-on
/// paragraph. Reshaping it here keeps CHANGELOG.md a plain readable file.
const asBlocks = (text: string) =>
  text
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\n(?=[ \t]*• )/g, '\n\n')
    .replace(/(^|\n)(#{1,3} [^\n]*)\n+/g, '$1$2\n')

export function WhatsNewModal() {
  const modal = useUi((s) => s.modals.wnModal)
  const { version, notes } = useWhatsNew()
  if (!modal.open) return null
  const close = () => closeModal('wnModal')
  return (
    <div
      id="wnModal"
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      {...backdropClose(close)}
    >
      <div className="modal mw-md" style={{ maxHeight: '86%' }}>
        <h3>Что нового</h3>
        <div className="sub">Millida Launcher {version}</div>
        <div
          style={{
            maxHeight: '52vh',
            overflow: 'auto',
            margin: '14px 0',
            fontSize: '13.5px',
            lineHeight: 1.6,
            color: 'var(--m-fg-muted)',
          }}
        >
          {renderMarkdown(asBlocks(notes))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn md primary" id="wnClose" data-sound="close" onClick={close}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  )
}
