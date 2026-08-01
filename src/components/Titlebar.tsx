import { Icon } from './Icon'
import { tauri } from '../ipc/tauri'

const win = () => {
  const T = tauri()
  return T && T.window ? T.window.getCurrentWindow() : null
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
          <button className="tb-btn" id="winMin" title="Свернуть" onClick={() => win()?.minimize()}>
            <Icon id="i-minus" />
          </button>
          <button className="tb-btn" id="winMax" title="Развернуть" onClick={() => win()?.toggleMaximize()}>
            <Icon id="i-max" />
          </button>
          <button
            className="tb-btn close"
            id="winClose"
            title="Закрыть"
            onClick={() => {
              const w = win()
              if (w) w.close()
              else window.close()
            }}
          >
            <Icon id="i-x" />
          </button>
        </div>
      )}
    </div>
  )
}
