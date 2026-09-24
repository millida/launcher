import { useRef } from 'react'
import { Icon } from '../components/Icon'
import { cancelWebLogin, copyUserCode, copyVerifyLink, quickStart, startWebLogin, useLogin } from '../state/login'
import { millidaEver } from '../state/onboarding'
import { PixelField } from '../components/lobby/PixelField'
import '../styles/pixel/login.css'

export function Login({ on }: { on: boolean }) {
  const login = useLogin()
  const artRef = useRef<HTMLImageElement>(null)
  const guestAllowed = millidaEver()

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width - 0.5) * 14,
      y = ((e.clientY - r.top) / r.height - 0.5) * 8
    if (artRef.current) artRef.current.style.transform = 'translate(' + x + 'px,' + y + 'px)'
  }

  return (
    <div id="scr-login" className={'lg2' + (on ? ' on' : '')} onMouseMove={onMove}>
      {/* Сцена лобби фоном (правка владельца 23.09.2026: экраны входа были
          в старом UI со старыми персонажами). */}
      <PixelField on={on} />
      <div className="login-wrap lg2-wrap">
        <div className="login-form lg2-card">
          <div className="login-logo">
            <img src="/millida-logo.svg" alt="" width={56} height={56} />
          </div>
          <h1>Вход в Millida</h1>
          {/* Одна строка вместо абзаца: остальное показывает сам поток входа —
              код, «Открыть страницу», «Копировать ссылку» (аудит 22.09.2026). */}
          <p className="sub">Нет аккаунта — создастся при входе</p>

          <button
            className="btn lg primary lg2-main"
            id="webLogin"
            disabled={login.webBusy}
            onClick={() => void startWebLogin()}
          >
            <Icon id="i-shield" />
            {login.webLabel}
          </button>
          {login.webBusy ? (
            <div className="login-code-box">
              <button className="login-code" aria-label="Скопировать код" onClick={() => void copyUserCode()}>
                <span>{login.userCode}</span>
                <Icon id="i-copy" />
              </button>
              <div className="login-code-actions">
                <button className="btn sm secondary" onClick={() => void startWebLogin(true)}>
                  Открыть страницу
                </button>
                <button className="btn sm ghost" onClick={copyVerifyLink}>
                  Копировать ссылку
                </button>
                <button className="btn sm ghost" onClick={cancelWebLogin}>
                  Отмена
                </button>
              </div>
              {/* Браузер открывается не всегда: адрес для ручного ввода кода обязан быть виден. */}
              <div className="login-reg">Не открылось — millida.net/auth/launcher</div>
            </div>
          ) : (
            <div className="login-reg" id="tgHint" style={{ display: login.hintShown ? 'block' : 'none' }}>
              {login.hintText}
            </div>
          )}

          {guestAllowed ? (
            <button className="btn md secondary login-guest lg2-guest" id="quickStart" onClick={quickStart}>
              Играть гостем
            </button>
          ) : null}
          <div className="trust">
            <Icon id="i-shield" />
            <span>Пароль — только на сайте Millida</span>
          </div>
        </div>
        <div className="login-art lg2-art">
          <img ref={artRef} src="/lobby/duo@2x.webp" alt="" />
          <span className="lg2-shadow" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
