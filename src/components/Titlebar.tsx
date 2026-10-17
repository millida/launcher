import { Icon } from './Icon'
import { tauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { useT } from '../i18n'

const win = () => {
  const T = tauri()
  return T && T.window ? T.window.getCurrentWindow() : null
}

/// The frameless window has no other way to be minimised, maximised or closed,
/// so a failure here leaves the player pressing a dead button: it is reported,
/// never dropped.
function windowAction(
  failText: (error: string) => string,
  run: (w: NonNullable<ReturnType<typeof win>>) => Promise<void>,
  closeWithoutWindow = false,
) {
  const w = win()
  if (!w) {
    if (closeWithoutWindow) window.close()
    return
  }
  void run(w).catch((e) => showToast(failText(String(e)), 'error'))
}

/// macOS keeps the native title bar (Overlay style) with its traffic lights; custom window
/// buttons exist only on the frameless Windows and Linux windows.
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)

export function Titlebar() {
  const t = useT()
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
            aria-label={t('Свернуть')}
            onClick={() => windowAction((error) => t('Не удалось свернуть окно: {error}', { error }), (w) => w.minimize())}
          >
            <Icon id="i-minus" />
          </button>
          <button
            className="tb-btn"
            id="winMax"
            aria-label={t('Развернуть')}
            onClick={() => windowAction((error) => t('Не удалось развернуть окно: {error}', { error }), (w) => w.toggleMaximize())}
          >
            <Icon id="i-max" />
          </button>
          <button
            className="tb-btn close"
            id="winClose"
            aria-label={t('Закрыть')}
            onClick={() => windowAction((error) => t('Не удалось закрыть окно: {error}', { error }), (w) => w.close(), true)}
          >
            <Icon id="i-x" />
          </button>
        </div>
      )}
    </div>
  )
}
