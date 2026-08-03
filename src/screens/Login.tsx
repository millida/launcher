import { useRef } from 'react'
import { Icon } from '../components/Icon'
import { cancelWebLogin, copyUserCode, copyVerifyLink, quickStart, startWebLogin, useLogin } from '../state/login'
import { millidaEver } from '../state/onboarding'

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
    <div id="scr-login" className={on ? 'on' : undefined} onMouseMove={onMove}>
      <div className="login-wrap">
        <div className="login-form">
          <div className="login-logo">
            <img src="/millida-logo.svg" alt="" style={{ width: '44px', height: '44px', borderRadius: '12px' }} />
            <div>
              <b>MILLIDA Launcher</b>
              <span>Часть экосистемы Millida</span>
            </div>
          </div>
          <h1>Вход в аккаунт Millida</h1>
          <p className="sub">Один аккаунт — лаунчер, друзья, серверы и все сервисы Millida.</p>

          <button
            className="btn md primary"
            style={{ width: '100%', gap: '9px' }}
            id="webLogin"
            disabled={login.webBusy}
            onClick={() => void startWebLogin()}
          >
            <Icon id="i-shield" />
            {login.webLabel}
          </button>
          {login.webBusy ? (
            <div className="login-code-box">
              <button className="login-code" title="Скопировать код" onClick={() => void copyUserCode()}>
                <span>{login.userCode}</span>
                <Icon id="i-copy" />
              </button>
              <div className="login-code-actions">
                <button className="btn sm secondary" onClick={() => void startWebLogin(true)}>
                  Открыть страницу
                </button>
                <button className="btn sm ghost" title="Скопировать ссылку" onClick={copyVerifyLink}>
                  Скопировать ссылку
                </button>
                <button className="btn sm ghost" onClick={cancelWebLogin}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <p className="faint-note" style={{ marginTop: '10px', lineHeight: 1.55 }}>
              Откроется страница Millida — войди почтой, Discord или Telegram и подтверди код. Лаунчер войдёт сам.
            </p>
          )}
          <div className="login-reg" id="tgHint" style={{ display: login.hintShown ? 'block' : 'none' }}>
            {login.hintText}
          </div>
          <div className="login-reg">Нет аккаунта Millida? Он создастся автоматически при входе.</div>

          {guestAllowed ? (
            <>
              <div className="or">или без сервисов</div>
              <button className="btn sm ghost" style={{ width: '100%' }} id="quickStart" onClick={quickStart}>
                Играть гостем (без друзей и профиля)
              </button>
            </>
          ) : (
            <div className="login-reg">
              Аккаунт нужен один раз: он даёт ник в игре, скины, друзей и свой сервер. После входа появится и режим
              гостя.
            </div>
          )}
          <div className="trust">
            <Icon id="i-shield" />
            <span>
              Вход подтверждается на официальной странице Millida — лаунчер не видит твой пароль.
            </span>
          </div>
        </div>
        <div className="login-art">
          <img ref={artRef} src="/hero-11.png" alt="" />
        </div>
      </div>
    </div>
  )
}
