import { Icon } from './Icon'
import { useUi } from '../state/ui'
import { cancelPrelaunch } from '../lib/launch'
import { prelaunchPct, prelaunchStageName } from '../lib/launchView'

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

/// The lobby shows launch progress on the Play button itself; on every other
/// screen it lives here, in the same shell as the other notices.
export function LaunchToast() {
  const pl = useUi((s) => s.prelaunch)
  const lobby = useUi((s) => s.screen === 'play')
  if (!pl.open || lobby) return null
  const pct = prelaunchPct(pl.pct)
  return (
    <div className="toast show has-act launch-toast" id="launchToast" role="status">
      <span className="spin" aria-hidden="true"></span>
      <span className="launch-toast-body">
        <span className="launch-toast-row">
          <span className="launch-toast-name">{prelaunchStageName(pl)}</span>
          <b className="launch-toast-pct">{pct + '%'}</b>
        </span>
        <span className="launch-toast-bar">
          <i style={{ width: pct + '%' }} />
        </span>
      </span>
      <button className="launch-toast-x" aria-label="Отменить запуск" data-track="cancel_launch" onClick={cancelPrelaunch}>
        <Icon id="i-x" />
      </button>
    </div>
  )
}
