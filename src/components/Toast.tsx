import { Icon } from './Icon'
import { useUi } from '../state/ui'

export function Toast() {
  const toastMsg = useUi((s) => s.toastMsg)
  const toastShow = useUi((s) => s.toastShow)
  const toastKind = useUi((s) => s.toastKind)
  return (
    <div className={'toast ' + toastKind + (toastShow ? ' show' : '')} id="toast">
      <Icon id={toastKind === 'error' ? 'i-alert' : 'i-check'} />
      <span id="toastMsg">{toastMsg}</span>
    </div>
  )
}
