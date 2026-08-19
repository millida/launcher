import { Icon } from './Icon'
import { tauri } from '../ipc/tauri'
import { showToast } from '../state/ui'

const win = () => {
  const T = tauri()
  return T && T.window ? T.window.getCurrentWindow() : null
}

/// The frameless window has no other way to be minimised, maximised or closed,
/// so a failure here leaves the player pressing a dead button: it is reported,
/// never dropped.
function windowAction(what: string, run: (w: NonNullable<ReturnType<typeof win>>) => Promise<void>) {
  const w = win()
  if (!w) {
    if (what === 'закрыть') window.close()
    return
  }
  void run(w).catch((e) => showToast('Не удалось ' + what + ' окно: ' + e, 'error'))
}

/// macOS keeps the native title bar (Overlay style) with its traffic lights; custom window
/// buttons exist only on the frameless Windows and Linux windows.
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)

export function Titlebar() {
  return (
    <div className={'titlebar' + (IS_MAC ? ' mac' : '')}>
      <div className="tb-drag" data-tauri-drag-region="" style={{ flex: 1 }}></div>
      <div className="tb-center">
        <img src="/millida-logo.svg" alt="" style={{ width: '22px', height: '22px', borderRadius: '6px' }} />
        <span className="tb-name">MILLIDA LAUNCHER</span>
      </div>
      {IS_MAC ? null : (
        <div className="tb-btns">
          <button
            className="tb-btn"
            id="winMin"
            title="Свернуть"
            onClick={() => windowAction('свернуть', (w) => w.minimize())}
          >
            <Icon id="i-minus" />
          </button>
          <button
            className="tb-btn"
            id="winMax"
            title="Развернуть"
            onClick={() => windowAction('развернуть', (w) => w.toggleMaximize())}
          >
            <Icon id="i-max" />
          </button>
          <button
            className="tb-btn close"
            id="winClose"
            title="Закрыть"
            onClick={() => windowAction('закрыть', (w) => w.close())}
          >
            <Icon id="i-x" />
          </button>
        </div>
      )}
    </div>
  )
}
