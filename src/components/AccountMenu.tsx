import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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

/** Ширина меню (.acc-menu): по ней меню прижимается к правому краю окна. */
const ACC_MENU_W = 330

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
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 8, bottom: 8 })

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
      // Кнопка аккаунта теперь в верхней полосе справа (23.09.2026): меню
      // открывается под ней и не вылезает за правый край окна. Снизу — как было.
      const left = Math.max(8, Math.min(r.left, window.innerWidth - ACC_MENU_W - 8))
      setPos(
        r.top < window.innerHeight / 2
          ? { left, top: r.bottom + 8 }
          : { left, bottom: window.innerHeight - r.top + 8 },
      )
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

  // Меню уходит в body: у сайдбара срез угла (clip-path), и всё, что вылезает
  // за его край, обрезалось — меню шириной 284px показывалось наполовину.
  return createPortal(
    <>
      <div
        id="accMenu"
        data-acc-menu=""
        data-private
        data-section="accounts"
        className="acc-menu"
        style={{
          display: open ? 'block' : 'none',
          left: pos.left + 'px',
          top: pos.top != null ? pos.top + 'px' : undefined,
          bottom: pos.bottom != null ? pos.bottom + 'px' : undefined,
        }}
      >
        <div className="acc-menu-cap">Аккаунты</div>
        {list.length ? (
          list.map((a) => (
            <div
              key={a.id}
              className={'acc-item' + (a.id === active ? ' on' : '')}
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
                size={40}
                style={{ flex: 'none', objectFit: 'cover' }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b className="acc-item-nick">{a.nick}</b>
                <span className={'acc-item-kind' + (lost(a) ? ' lost' : '')}>
                  {lost(a) ? 'Войти заново' : accKindLabel(a.kind)}
                </span>
              </span>
              {a.id === active ? <Icon id="i-check" style={{ color: 'var(--m-accent)', flex: 'none' }} /> : null}
              <button
                className="acc-item-del"
                aria-label="Выйти из аккаунта"
                data-track="account_remove"
                title="Выйти из аккаунта"
                onClick={async (e) => {
                  e.stopPropagation()
                  // Убрать аккаунт = выйти из него (правка владельца 23.09.2026:
                  // отдельной «Выйти из Millida» больше нет).
                  if (await uiConfirm('Выйти из аккаунта «' + a.nick + '»?', { confirmLabel: 'Выйти' })) {
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
          <div className="acc-menu-empty">Пока нет аккаунтов</div>
        )}
        <div className="acc-menu-sep"></div>
        <button
          id="accAddBtn"
          className="acc-add-btn"
          data-track="account_add"
          onClick={() => {
            onClose()
            openModal('accModal')
          }}
        >
          <Icon id="i-plus" />
          Добавить аккаунт
        </button>
      </div>
    </>,
    document.body,
  )
}
