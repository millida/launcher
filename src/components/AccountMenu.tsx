import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { Icon } from './Icon'
import { Head } from './Head'
import { accKindLabel } from '../lib/format'
import { hasLicenseSession, msTokenExpired, useAccounts } from '../state/accounts'
import type { Account } from '../state/accounts'
import { SECRETS_CHANGED_EVENT } from '../lib/secure'
import { refreshMsAccounts, startMsLogin } from '../state/msLogin'
import { openModal, showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { forgetMillidaIfGone, logoutToLogin } from '../lib/session'

export function AccountMenu({
  open,
  onClose,
  chipRef,
}: {
  open: boolean
  onClose: () => void
  chipRef: RefObject<HTMLDivElement | null>
}) {
  const { list, active, setActive, remove } = useAccounts()
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 8, bottom: 8 })

  const lost = (a: Account) => a.kind === 'microsoft' && (!hasLicenseSession(a) || msTokenExpired(a))

  const [, bumpSecrets] = useState(0)
  useEffect(() => {
    const onChange = () => bumpSecrets((n) => n + 1)
    window.addEventListener(SECRETS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SECRETS_CHANGED_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (!open) return
    const el = chipRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ left: Math.max(8, r.left), bottom: window.innerHeight - r.top + 8 })
    }
  }, [open, chipRef])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        id="accMenu"
        data-acc-menu=""
        style={{
          position: 'fixed',
          zIndex: 140,
          width: '284px',
          background: 'var(--m-surface-2)',
          border: '1px solid var(--m-border)',
          borderRadius: '14px',
          boxShadow: 'var(--m-shadow-lg)',
          padding: '12px',
          display: open ? 'block' : 'none',
          left: pos.left + 'px',
          bottom: pos.bottom + 'px',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: 'var(--m-fg-subtle)',
            padding: '2px 6px 10px',
          }}
        >
          Аккаунты
        </div>
        {list.length ? (
          list.map((a) => (
            <div
              key={a.id}
              className="acc-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '11px',
                padding: '9px 10px',
                marginBottom: '2px',
                borderRadius: '11px',
                cursor: 'pointer',
                ...(a.id === active ? { background: 'var(--m-accent-soft)' } : {}),
              }}
              onClick={() => {
                setActive(a.id)
                if (lost(a)) {
                  onClose()
                  showToast('Проверяем лицензию Microsoft…')
                  void refreshMsAccounts(true).then(() => {
                    const now = useAccounts.getState().list.find((x) => x.id === a.id)
                    if (now && !lost(now)) {
                      showToast('Активный аккаунт: ' + a.nick)
                      return
                    }
                    showToast('Вход по лицензии слетел — подтверди аккаунт Microsoft заново', 'error')
                    void startMsLogin()
                  })
                  return
                }
                showToast('Активный аккаунт: ' + a.nick)
              }}
            >
              <Head
                nick={a.nick}
                kind={a.kind}
                src={a.avatar}
                size={30}
                style={{ flex: 'none', objectFit: 'cover', borderRadius: '8px' }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {a.nick}
                </b>
                <span style={{ fontSize: '11px', color: lost(a) ? 'var(--m-danger)' : 'var(--m-fg-subtle)' }}>
                  {lost(a) ? 'Вход слетел — нажми, чтобы войти' : accKindLabel(a.kind)}
                </span>
              </span>
              {a.id === active ? <Icon id="i-check" style={{ color: 'var(--m-accent)', flex: 'none' }} /> : null}
              <button
                className="acc-item-del"
                title="Убрать аккаунт"
                onClick={async (e) => {
                  e.stopPropagation()
                  if (await uiConfirm('Убрать аккаунт «' + a.nick + '» из лаунчера?', { confirmLabel: 'Убрать' })) {
                    remove(a.id)
                    forgetMillidaIfGone()
                    if (!useAccounts.getState().list.length) logoutToLogin()
                  }
                }}
              >
                <Icon id="i-trash" />
              </button>
            </div>
          ))
        ) : (
          <div style={{ padding: '8px', color: 'var(--m-fg-faint)', fontSize: '12.5px' }}>Пока нет аккаунтов</div>
        )}
        <div style={{ height: '1px', background: 'var(--m-border)', margin: '8px 4px' }}></div>
        <button
          id="accAddBtn"
          className="acc-add-btn"
          onClick={() => {
            onClose()
            openModal('accModal')
          }}
        >
          <Icon id="i-plus" />
          Добавить аккаунт
        </button>
      </div>
    </>
  )
}
