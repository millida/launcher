import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from './Icon'
import { openCatalogHome, useHubTab } from './playhub/hubTab'
import { AccountMenu } from './AccountMenu'
import { Head } from './Head'
import { accKindLabel } from '../lib/format'
import { getAccount, isMillidaKind, useAccounts } from '../state/accounts'
import { useGameNick } from '../state/gameNick'
import { unreadTotal, useFriends } from '../state/friends'
import { roomsUnreadTotal, useRooms } from '../state/rooms'
import { showToast, useUi } from '../state/ui'
import { hideNavHint, noteHostingOpen, restoreNavHint, useNavHint } from '../state/navHint'
import { useNewHint } from '../state/newHint'
import type { ScreenId } from '../state/ui'
import type { HintStage } from '../state/navHint'
import { useHasMillida } from '../state/auth'
import { usePlus } from '../state/plus'
import { PL_STAGES, cancelPrelaunch } from '../lib/launch'
import { preloadScreen } from '../screens/registry'
import { t, tx, useT } from '../i18n'

/** hub: раздел «Во что играем» — false «Мои сборки» (сборки и рекомендации), true «Каталог». */
const NAV: { id: ScreenId; icon: string; label: string; pill?: string; hub?: boolean }[] = [
  { id: 'play', icon: 'i-play', get label() { return t('Играть') } },
  { id: 'playhub', icon: 'i-box2', get label() { return t('Мои сборки') }, hub: false },
  { id: 'playhub', icon: 'i-blocks', get label() { return t('Каталог') }, hub: true },
  { id: 'servers', icon: 'i-server', get label() { return t('Серверы') } },
  { id: 'skins', icon: 'i-shirt', get label() { return t('Скины') } },
  { id: 'rubies', icon: 'i-gem', get label() { return t('Магазин') } },
  { id: 'top', icon: 'i-trophy', get label() { return t('Топ') } },
  { id: 'friends', icon: 'i-users', get label() { return t('Друзья') } },
  { id: 'hosting', icon: 'i-server-cog', get label() { return t('Мой сервер') } },
]

const NAV_BOTTOM: { id: ScreenId; icon: string; label: string }[] = [{ id: 'settings', icon: 'i-settings', get label() { return t('Настройки') } }]

/**
 * Подсказка «бесплатно» продаёт хостинг только тому, кто его ещё не пробовал:
 * дальше она сама тускнеет и исчезает (см. state/navHint), а правый клик по
 * пункту убирает её сразу.
 */
function pillOf(
  id: ScreenId,
  pill: string | undefined,
  hosting: HintStage,
  cosmeticsSeen: boolean,
): string | undefined {
  if (!pill) return undefined
  if (id === 'hosting' && hosting === 'off') return undefined
  // «Новое» у скинов гаснет, когда человек открыл сами украшения, а не раздел:
  // раздел старый, новинка внутри него.
  if (id === 'skins' && cosmeticsSeen) return undefined
  return pill
}

function dismissHint(e: ReactMouseEvent) {
  e.preventDefault()
  hideNavHint()
  showToast(t('Подсказка убрана'), 'ok', false, { label: t('Вернуть'), run: restoreNavHint })
}

export function ClassicSidebar({ onNav }: { onNav: (s: ScreenId) => void }) {
  const t = useT()
  const screen = useUi((s) => s.screen)
  const prelaunch = useUi((s) => s.prelaunch)
  const friends = useFriends((s) => s.friends)
  const reqIn = useFriends((s) => s.reqIn)
  const rooms = useRooms((s) => s.rooms)
  const millida = useHasMillida()
  const hostingHint = useNavHint((s) => s.hosting)
  const plusActive = usePlus((s) => s.active)
  const cosmeticsSeen = useNewHint((s) => s.cosmeticsSeen)
  useAccounts()
  const acc = getAccount()
  const gameName = useGameNick((s) => s.name)
  // The Millida game profile has its own name, and that is what the server sees.
  const inGameNick = acc && isMillidaKind(acc.kind) && gameName ? gameName : acc ? acc.nick : ''
  const otherAccountNick = acc && inGameNick !== acc.nick ? acc.nick : ''
  const chipRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('m-cl-side-collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const nv = !v
      try {
        localStorage.setItem('m-cl-side-collapsed', nv ? '1' : '0')
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

  useEffect(() => {
    void usePlus.getState().load()
  }, [millida])

  const hubAll = useHubTab((s) => s.all)
  // Старые входы «Сборки» и «Каталог» (экраны builds и mods) подсвечивают те же пункты.
  const isOn = (n: (typeof NAV)[number]) =>
    n.hub === undefined
      ? screen === n.id
      : (screen === 'playhub' && hubAll === n.hub) || screen === (n.hub ? 'mods' : 'builds')

  const frOnline = millida ? friends.filter((f) => f.online).length : 0
  // Непрочитанное в группах считается тем же счётчиком: для человека это одно
  // и то же «мне написали», а не два разных места.
  const frAlerts = millida ? unreadTotal(friends) + roomsUnreadTotal(rooms) + reqIn.length : 0

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      {/* Свернуть — не строкой меню, а уголком, который проявляется при
          наведении на панель (как в Notion и Linear). По умолчанию панель открыта. */}
      <button
        className="cl-fold"
        aria-label={collapsed ? t('Развернуть меню') : t('Свернуть меню')}
        title={collapsed ? t('Развернуть меню') : t('Свернуть меню')}
        onClick={toggleCollapsed}
      >
        <Icon id={collapsed ? 'i-chev-r' : 'i-chev-l'} />
      </button>

      <nav className="nav-group">
        {NAV.map((n) => (
          <button
            key={n.label}
            className={'nav-item' + (isOn(n) ? ' active' : '')}
            data-screen={n.id}
            data-tip={n.label}
            onMouseEnter={() => preloadScreen(n.id)}
            onFocus={() => preloadScreen(n.id)}
            onClick={() => {
              if (n.id === 'hosting') noteHostingOpen()
              if (n.hub === true && !useHubTab.getState().all) openCatalogHome()
              else if (n.hub !== undefined) useHubTab.getState().setAll(n.hub)
              onNav(n.id)
            }}
            onContextMenu={pillOf(n.id, n.pill, hostingHint, cosmeticsSeen) ? dismissHint : undefined}
          >
            <Icon id={n.icon} />
            <span className="nav-label">{n.label}</span>
            {pillOf(n.id, n.pill, hostingHint, cosmeticsSeen) ? (
              <span className={'nav-pill' + (hostingHint === 'quiet' ? ' quiet' : '')}>{n.pill}</span>
            ) : null}
            {n.id === 'friends' ? (
              <>
                {frOnline ? (
                  <span className="nav-count" id="frOnline" title={t('Друзья в сети')}>
                    {frOnline}
                  </span>
                ) : null}
                {frAlerts ? (
                  <span className="nav-badge" title={t('Новые сообщения и заявки')}>
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
              <span className="dl-name">{tx(prelaunch.msg || prelaunch.sub)}</span>
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
                {t('Отменить запуск')}
              </button>
            </div>
          </div>

          <div className="side-sep" style={{ marginTop: 0 }}></div>
        </>
      ) : null}

      <nav className="nav-group nav-group-bottom">
        {NAV_BOTTOM.map((n) => (
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
          </button>
        ))}
      </nav>

      <div
        className="account"
        title={t('Аккаунты')}
        data-tip={inGameNick || t('Гость')}
        ref={chipRef}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className={'ava' + (plusActive ? ' is-plus' : '')}>
          <Head
            nick={inGameNick || 'MHF_Steve'}
            kind={acc ? acc.kind : undefined}
            src={acc && acc.avatar}
            size={32}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </span>
        <span className="acc-meta">
          <span className="acc-nick">{inGameNick || t('Гость')}</span>{' '}
          <span className="acc-kind">
            {acc ? (otherAccountNick ? t('Ник в игре · аккаунт {nick}', { nick: otherAccountNick }) : accKindLabel(acc.kind)) : t('Нажми, чтобы войти')}
          </span>
        </span>
        <span className="acc-chevron">
          <Icon id="i-chev-r" />
        </span>
      </div>
      <AccountMenu open={menuOpen} onClose={() => setMenuOpen(false)} chipRef={chipRef} />
    </aside>
  )
}
