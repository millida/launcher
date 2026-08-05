import { Icon } from './Icon'
import { useUi } from '../state/ui'

export function Toast() {
  const toastMsg = useUi((s) => s.toastMsg)
  const toastShow = useUi((s) => s.toastShow)
  const toastKind = useUi((s) => s.toastKind)
  const toastAction = useUi((s) => s.toastAction)
  const hideToast = useUi((s) => s.hideToast)
  return (
    <div className={'toast ' + toastKind + (toastShow ? ' show' : '') + (toastAction ? ' has-act' : '')} id="toast">
      <Icon id={toastKind === 'error' ? 'i-alert' : 'i-check'} />
      <span id="toastMsg">{toastMsg}</span>
      {toastAction ? (
        <button
          className="toast-act"
          onClick={() => {
            toastAction.run()
            hideToast()
          }}
        >
          {toastAction.label}
        </button>
      ) : null}
    </div>
  )
}
