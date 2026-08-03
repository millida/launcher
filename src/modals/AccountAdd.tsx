import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { closeModal, showToast, useUi } from '../state/ui'
import { openExt } from '../lib/api'
import { useAccounts } from '../state/accounts'
import { cancelWebLogin, copyUserCode, copyVerifyLink, startWebLogin, useLogin } from '../state/login'
import { cancelMsLogin, copyMsCode, copyMsVerifyLink, openMsVerifyPage, startMsLogin, useMsLogin } from '../state/msLogin'

type Kind = 'millida' | 'microsoft' | 'offline'

const KINDS: { id: Kind; ic: string; title: string; sub: string }[] = [
  {
    id: 'millida',
    ic: 'i-key',
    title: 'Аккаунт Millida',
    sub: 'Почта, Discord или Telegram — ник, друзья и баланс Millida',
  },
  {
    id: 'microsoft',
    ic: 'i-shield',
    title: 'Лицензия Microsoft',
    sub: 'Официальный Minecraft: сервера с лицензией, свой скин и плащ',
  },
  {
    id: 'offline',
    ic: 'i-user',
    title: 'Офлайн-аккаунт',
    sub: 'Без лицензии — только ник для пиратских серверов',
  },
]

function KindPanel({ kind, onBack, onDone }: { kind: Kind; onBack: () => void; onDone: () => void }) {
  const login = useLogin()
  const ms = useMsLogin()
  const [nick, setNick] = useState('')
  const count = useAccounts((s) => s.list.length)
  const startCount = useRef(count)
  const doneRef = useRef(false)
  const doneCb = useRef(onDone)
  doneCb.current = onDone

  useEffect(() => {
    if (doneRef.current || count === startCount.current) return
    doneRef.current = true
    doneCb.current()
  }, [count])

  const createOffline = () => {
    const v = nick.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(v)) {
      showToast('Ник: латиница, цифры и _, от 3 до 16 символов', 'error')
      return
    }
    useAccounts.getState().add({ nick: v, kind: 'offline' })
    onDone()
    showToast('Аккаунт создан: ' + v)
  }

  const meta = KINDS.find((k) => k.id === kind)!
  const busy = kind === 'millida' ? login.webBusy : kind === 'microsoft' ? ms.busy : false
  const code = kind === 'millida' ? login.userCode : ms.userCode
  const hint = kind === 'millida' ? login.hintText : ms.hint

  return (
    <>
      <button
        className="btn sm ghost"
        style={{ alignSelf: 'flex-start', marginBottom: '12px' }}
        onClick={() => {
          if (kind === 'millida') cancelWebLogin()
          if (kind === 'microsoft') cancelMsLogin()
          onBack()
        }}
      >
        <Icon id="i-chev-l" />
        Назад
      </button>
      <div className="acc-opt" style={{ cursor: 'default' }}>
        <span className="acc-opt-ic">
          <Icon id={meta.ic} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: '13.5px', fontWeight: 650 }}>{meta.title}</b>
          <span style={{ fontSize: '12px', color: 'var(--m-fg-subtle)' }}>{meta.sub}</span>
        </span>
      </div>

      {kind === 'offline' ? (
        <div style={{ marginTop: '16px' }}>
          <div className="input" style={{ width: '100%' }}>
            <input
              placeholder="Ник в игре (латиница, 3–16)"
              maxLength={16}
              autoFocus
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createOffline()
              }}
            />
          </div>
          <button className="btn md primary" style={{ width: '100%', marginTop: '12px' }} onClick={createOffline}>
            Создать аккаунт
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '16px' }}>
          {busy && code ? (
            <>
              <button
                className="acc-code"
                title="Скопировать код"
                onClick={() => void (kind === 'millida' ? copyUserCode() : copyMsCode())}
              >
                <span>{code}</span>
                <Icon id="i-copy" />
              </button>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  className="btn sm secondary"
                  style={{ flex: 1 }}
                  onClick={() => (kind === 'millida' ? void startWebLogin(true) : openMsVerifyPage())}
                >
                  Открыть страницу
                </button>
                <button
                  className="btn sm ghost"
                  title="Скопировать ссылку"
                  onClick={() => (kind === 'millida' ? copyVerifyLink() : copyMsVerifyLink())}
                >
                  Ссылка
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => (kind === 'millida' ? cancelWebLogin() : cancelMsLogin())}
                >
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <button
              className="btn md primary"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => void (kind === 'millida' ? startWebLogin() : startMsLogin())}
            >
              <Icon id={meta.ic} />
              {busy ? 'Ждём подтверждения…' : kind === 'millida' ? 'Войти через Millida' : 'Войти через Microsoft'}
            </button>
          )}
          <p className="faint-note" style={{ marginTop: '12px', lineHeight: 1.55 }}>
            {hint ||
              (kind === 'millida'
                ? 'Откроется страница Millida — войди почтой, Discord или Telegram и подтверди код.'
                : 'Откроется страница Microsoft — введи код и войди в аккаунт с лицензией Minecraft.')}
          </p>
        </div>
      )}
    </>
  )
}

export function AccountAddModal() {
  const modal = useUi((s) => s.modals.accModal)
  const [kind, setKind] = useState<Kind | null>(null)

  useEffect(() => {
    if (!modal.open) setKind(null)
  }, [modal.open])

  useEffect(() => {
    if (!modal.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal('accModal')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal.open])

  if (!modal.open) return null
  const close = () => closeModal('accModal')

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="accModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal" style={{ width: '460px', display: 'flex', flexDirection: 'column' }}>
        <h3>Добавить аккаунт</h3>
        <div className="sub">Аккаунты можно переключать в любой момент — прогресс и сборки общие.</div>

        <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column' }}>
          {kind ? (
            <KindPanel kind={kind} onBack={() => setKind(null)} onDone={close} />
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {KINDS.map((k) => (
                <button key={k.id} className="acc-opt" onClick={() => setKind(k.id)}>
                  <span className="acc-opt-ic">
                    <Icon id={k.ic} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: '13.5px', fontWeight: 650 }}>{k.title}</b>
                    <span style={{ fontSize: '12px', color: 'var(--m-fg-subtle)' }}>{k.sub}</span>
                  </span>
                  <Icon id="i-chev-r" style={{ color: 'var(--m-fg-faint)' }} />
                </button>
              ))}
              <a
                className="acc-buy"
                href="https://blups.me/product/minecraft"
                onClick={(e) => {
                  e.preventDefault()
                  openExt('https://blups.me/product/minecraft')
                }}
              >
                <span className="acc-buy-ic">
                  <Icon id="i-bag" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: '13.5px', fontWeight: 700 }}>Купить лицензию Minecraft</b>
                  <span style={{ fontSize: '12px', opacity: 0.9 }}>Официальный ключ на Blups — дешевле и сразу</span>
                </span>
                <Icon id="i-ext" />
              </a>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '22px' }}>
          <button className="btn md secondary" data-sound="close" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
