import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { AccountMenu } from './AccountMenu'
import { Head } from './Head'
import { accKindLabel } from '../lib/format'
import { getAccount, useAccounts } from '../state/accounts'
import { unreadTotal, useFriends } from '../state/friends'
import { useUi } from '../state/ui'
import type { ScreenId } from '../state/ui'
import { useHasMillida } from '../state/auth'
import { PL_STAGES, cancelPrelaunch } from '../lib/launch'
import { preloadScreen } from '../screens/registry'

const NAV: { id: ScreenId; icon: string; label: string }[] = [
  { id: 'play', icon: 'i-play', label: 'Играть' },
  { id: 'builds', icon: 'i-box2', label: 'Мои сборки' },
  { id: 'mods', icon: 'i-blocks', label: 'Контент' },
  { id: 'servers', icon: 'i-server', label: 'Серверы' },
  { id: 'skins', icon: 'i-shirt', label: 'Скины' },
  { id: 'friends', icon: 'i-users', label: 'Друзья' },
  { id: 'hosting', icon: 'i-server-cog', label: 'Мой сервер' },
  { id: 'settings', icon: 'i-settings', label: 'Настройки' },
]

export function Sidebar({ onNav }: { onNav: (s: ScreenId) => void }) {
  const screen = useUi((s) => s.screen)
  const prelaunch = useUi((s) => s.prelaunch)
  const friends = useFriends((s) => s.friends)
  const reqIn = useFriends((s) => s.reqIn)
  const millida = useHasMillida()
  useAccounts()
  const acc = getAccount()
  const chipRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('m-sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const nv = !v
      try {
        localStorage.setItem('m-sidebar-collapsed', nv ? '1' : '0')
      } catch {}
      return nv
    })
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('#accMenu') || t.closest('.account')) return
      setMenuOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [menuOpen])

  const frCount = millida ? String(friends.filter((f) => f.online).length) : '0'
  const frAlerts = millida ? unreadTotal(friends) + reqIn.length : 0

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <button
        className="side-collapse"
        data-tip={collapsed ? 'Развернуть' : 'Свернуть'}
        title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        onClick={toggleCollapsed}
      >
        <span className="side-collapse-ic">
          <Icon id={collapsed ? 'i-chev-r' : 'i-chev-l'} />
        </span>
        <span className="nav-label">Свернуть</span>
      </button>

      <nav className="nav-group">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={'nav-item' + (screen === n.id ? ' active' : '')}
            data-screen={n.id}
            data-tip={n.label}
            onMouseEnter={() => preloadScreen(n.id)}
            onFocus={() => preloadScreen(n.id)}
            onClick={() => onNav(n.id)}
          >
            <Icon id={n.icon} />
            <span className="nav-label">{n.label}</span>
            {n.id === 'friends' ? (
              <>
                <span className="nav-count" id="frOnline">
                  {frCount}
                </span>
                {frAlerts ? (
                  <span className="nav-badge" title="Новые сообщения и заявки">
                    {frAlerts > 99 ? '99+' : frAlerts}
                  </span>
                ) : null}
              </>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="side-spacer"></div>

      {prelaunch.open ? (
        <>
          <div className="dl-card">
            <div className="dl-top">
              <Icon id="i-download" />
              <span className="dl-name">{prelaunch.msg || prelaunch.sub}</span>
              <span className="dl-pct" id="dlPct">
                {Math.round(prelaunch.pct)}%
              </span>
            </div>
            <div className="dl-track">
              <div className="dl-fill" id="dlFill" style={{ width: prelaunch.pct + '%' }}></div>
            </div>
            <div className="dl-steps">
              {PL_STAGES.map((st, i) => (
                <div key={st} className={'dl-step' + (i < prelaunch.stage ? ' done' : i === prelaunch.stage ? ' act' : '')}>
                  <span className="dl-step-ic">
                    {i < prelaunch.stage ? <Icon id="i-check" /> : i === prelaunch.stage ? <span className="spin"></span> : null}
                  </span>
                  {st}
                </div>
              ))}
              <button className="btn sm ghost" style={{ width: '100%', marginTop: '6px' }} onClick={cancelPrelaunch}>
                Отменить запуск
              </button>
            </div>
          </div>

          <div className="side-sep" style={{ marginTop: 0 }}></div>
        </>
      ) : null}

      <div
        className="account"
        title="Аккаунты"
        data-tip={(acc && acc.nick) || 'Гость'}
        ref={chipRef}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="ava">
          <Head
            nick={(acc && acc.nick) || 'MHF_Steve'}
            kind={acc ? acc.kind : undefined}
            src={acc && acc.avatar}
            size={32}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </span>
        <span className="acc-meta">
          <span className="acc-nick">{(acc && acc.nick) || 'Гость'}</span>{' '}
          <span className="acc-kind">{acc ? accKindLabel(acc.kind) : 'Нажми, чтобы войти'}</span>
        </span>
        <span className="acc-chevron">
          <Icon id="i-chev-r" />
        </span>
      </div>
      <AccountMenu open={menuOpen} onClose={() => setMenuOpen(false)} chipRef={chipRef} />
    </aside>
  )
}
