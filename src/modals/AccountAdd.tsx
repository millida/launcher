import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { PxIcon } from '../components/PxIcon'
import { closeModal, showToast, useUi } from '../state/ui'
import { isOfflineNick, pinnedOfflineNick, useAccounts } from '../state/accounts'
import { useGameNick } from '../state/gameNick'
import { hasMillidaAccount } from '../lib/api'
import { useAccountAdd, type AccountAddKind } from '../state/accountAdd'
import { cancelWebLogin, copyUserCode, copyVerifyLink, startWebLogin, useLogin } from '../state/login'
import { cancelMsLogin, copyMsCode, copyMsVerifyLink, openMsVerifyPage, startMsLogin, useMsLogin } from '../state/msLogin'
import { enterApp } from '../lib/session'
import { backdropClose } from '../lib/dismiss'
import { useT, type Vars } from '../i18n'
import { SecurityInfo } from './SecurityInfo'
import { AccountChoice } from '../components/AccountChoice'

type Kind = AccountAddKind

interface KindMeta {
  id: Kind
  icon: ReactNode
  title: string
  sub: string
}

const MC_ICON = <PxIcon name="mc-grass" size={24} />

function kindMeta(kind: Kind, t: (key: string, vars?: Vars) => string): KindMeta {
  if (kind === 'microsoft') return { id: kind, icon: MC_ICON, title: t('Лицензия Minecraft'), sub: t('Вход через Microsoft') }
  if (kind === 'offline') return { id: kind, icon: <Icon id="i-mo-user" />, title: t('Офлайн-аккаунт'), sub: t('нет Realms и нет лицензионных серверов') }
  return { id: kind, icon: <Icon id="i-mo-key" />, title: t('Аккаунт Millida'), sub: t('Друзья, ник и баланс') }
}

export function KindPanel({ kind, onBack, onDone, onSafety }: { kind: Kind; onBack: () => void; onDone: () => void; onSafety: () => void }) {
  const t = useT()
  const login = useLogin()
  const ms = useMsLogin()
  const profileNick = useGameNick((s) => s.name)
  const pinned = pinnedOfflineNick(hasMillidaAccount(), profileNick)
  const [typed, setTyped] = useState<string | null>(null)
  const nick = typed ?? pinned
  const carriesMillida = !!pinned && nick.trim() === pinned
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
    if (!isOfflineNick(v)) {
      showToast(t('Ник: латиница, цифры и _, от 3 до 16 символов'), 'error')
      return
    }
    useAccounts.getState().add({ nick: v, kind: 'offline' })
    if (!useUi.getState().logged) enterApp()
    onDone()
    showToast(t('Аккаунт создан: {nick}', { nick: v }))
  }

  const meta = kindMeta(kind, t)
  const millida = kind === 'millida'
  const busy = millida ? login.webBusy : ms.busy
  const code = millida ? login.userCode : ms.userCode
  const hint = millida ? login.hintText : ms.hint

  return (
    <>
      <button
        className="btn sm ghost"
        style={{ alignSelf: 'flex-start', marginBottom: '12px' }}
        onClick={() => {
          if (millida) cancelWebLogin()
          if (kind === 'microsoft') cancelMsLogin()
          onBack()
        }}
      >
        <Icon id="i-chev-l" />
        {t('Назад')}
      </button>
      <div className="acc-opt" style={{ cursor: 'default' }}>
        <span className="acc-opt-ic">{meta.icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: '13.5px', fontWeight: 650 }}>{meta.title}</b>
          <span style={{ fontSize: '12px', color: 'var(--m-fg-subtle)' }}>{meta.sub}</span>
        </span>
      </div>

      {kind === 'offline' ? (
        <div style={{ marginTop: '16px' }}>
          <div className="input" style={{ width: '100%' }}>
            <input
              placeholder={t('Ник в игре (латиница, 3–16)')}
              maxLength={16}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={nick}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createOffline()
              }}
            />
          </div>
          {carriesMillida ? <p className="faint-note">{t('Ник аккаунта Millida: пускает на серверы с входом Millida')}</p> : null}
          <button className="btn md primary" style={{ width: '100%', marginTop: '12px' }} onClick={createOffline}>
            {t('Создать')}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '16px' }}>
          {busy && code ? (
            <>
              <button
                className="acc-code"
                aria-label={t('Скопировать код')}
                onClick={() => void (millida ? copyUserCode() : copyMsCode())}
              >
                <span>{code}</span>
                <Icon id="i-copy" />
              </button>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  className="btn sm secondary"
                  style={{ flex: 1 }}
                  onClick={() => (millida ? void startWebLogin(true) : openMsVerifyPage())}
                >
                  {t('Открыть страницу')}
                </button>
                <button className="btn sm ghost" onClick={() => (millida ? copyVerifyLink() : copyMsVerifyLink())}>
                  {t('Копировать ссылку')}
                </button>
                <button className="btn sm ghost" onClick={() => (millida ? cancelWebLogin() : cancelMsLogin())}>
                  {t('Отмена')}
                </button>
              </div>
            </>
          ) : (
            <button
              className="btn md primary"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => void (millida ? startWebLogin() : startMsLogin())}
            >
              {millida ? <Icon id="i-mo-key" /> : <Icon id="i-mo-shield" />}
              {busy ? t('Ждём подтверждения…') : millida ? t('Войти через Millida') : t('Войти через Microsoft')}
            </button>
          )}
          {kind === 'microsoft' ? (
            <div className="faint-note" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Icon id="i-shield" />
              <span>{t('Полностью безопасно. Убедись сам:')}</span>
              <a
                href="https://millida.net/launcher/bezopasnost"
                onClick={(e) => {
                  e.preventDefault()
                  onSafety()
                }}
              >
                {t('Как это работает?')}
              </a>
            </div>
          ) : null}
          {hint ? (
            <p className="faint-note" style={{ marginTop: '12px', lineHeight: 1.5 }}>
              {hint}
            </p>
          ) : null}
        </div>
      )}
    </>
  )
}

export function AccountAddModal() {
  const t = useT()
  const modal = useUi((s) => s.modals.accModal)
  const preset = useAccountAdd((s) => s.kind)
  const [kind, setKind] = useState<Kind | null>(null)
  const [safety, setSafety] = useState(false)

  useEffect(() => {
    if (modal.open) {
      setKind(preset)
      return
    }
    setKind(null)
    setSafety(false)
    useAccountAdd.setState({ kind: null })
  }, [modal.open, preset])

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
      {...backdropClose(close)}
    >
      <div className={'modal ' + (safety ? 'mw-md' : 'mw-sm')} style={{ display: 'flex', flexDirection: 'column' }}>
        <h3>{safety ? t('Как это работает') : t('Добавить аккаунт')}</h3>

        <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column' }}>
          {safety ? (
            <SecurityInfo onBack={() => setSafety(false)} />
          ) : kind ? (
            <KindPanel
              kind={kind}
              onBack={() => (preset ? close() : setKind(null))}
              onDone={close}
              onSafety={() => setSafety(true)}
            />
          ) : (
            <AccountChoice track="account_add" onPick={setKind} />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '22px' }}>
          <button className="btn md secondary" data-sound="close" onClick={close}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
