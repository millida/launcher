import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { AccountMenu } from './AccountMenu'
import { Head } from './Head'
import { accKindLabel } from '../lib/format'
import { getAccount, isMillidaKind, useAccounts } from '../state/accounts'
import { useGameNick } from '../state/gameNick'
import { unreadTotal, useFriends } from '../state/friends'
import { radioOn, useMusic } from '../state/music'
import { BugPx, FEEDBACK_SHARDS, FeedbackModal, feedbackRewardReady } from './Feedback'
import { playSound, setSoundMode, soundMode } from '../lib/sound'
import { roomsUnreadTotal, useRooms } from '../state/rooms'
import { openMessages } from '../state/chatScreen'
import { PlayhubBar } from './playhub/MyBuilds'
import { PxIcon } from './PxIcon'
import { useHubTab } from './playhub/hubTab'
import { SKINS_IMPORT_EVENT, SKINS_UPLOAD_EVENT, useTopBar } from '../state/topbar'
import { useUi } from '../state/ui'
import type { ScreenId } from '../state/ui'
import { useHasMillida } from '../state/auth'
import { usePlus } from '../state/plus'
import { PL_STAGES, cancelPrelaunch } from '../lib/launch'
import { preloadScreen } from '../screens/registry'

/* Навигация как в Brawl Stars: у каждого раздела ровно один вход (владелец
   23.09.2026: «всё дублируется»). В лобби вкладок нет — разделы живут на сцене,
   здесь только кошелёк, настройки и аккаунт в углу. На остальных экранах —
   шапка с «← Лобби» и ходом запуска. Имя компонента осталось Sidebar, чтобы не
   трогать раскладку App.tsx. */
/** Две квадратные кнопки лобби: звуки интерфейса и музыка (по умолчанию играет). */
function LobbySoundBtns() {
  const music = useMusic((s) => radioOn(s))
  const toggleMusic = useMusic((s) => s.toggleRadio)
  const [ui, setUi] = useState(() => soundMode() === 'all')
  useEffect(() => {
    const sync = () => setUi(soundMode() === 'all')
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])
  return (
    <>
      <button
        className={'lb-btn lb-toggle' + (ui ? '' : ' off')}
        aria-pressed={ui}
        aria-label={ui ? 'Выключить звуки' : 'Включить звуки'}
        data-track={ui ? 'sound_off' : 'sound_on'}
        data-nosound
        onClick={() => {
          const next = !ui
          setSoundMode(next ? 'all' : 'notify')
          setUi(next)
          if (next) playSound('click')
        }}
      >
        <Icon id={ui ? 'i-volume' : 'i-mute'} />
      </button>
      <button
        className={'lb-btn lb-toggle' + (music ? '' : ' off')}
        aria-pressed={music}
        aria-label={music ? 'Выключить музыку' : 'Включить музыку'}
        data-track={music ? 'music_off' : 'music_on'}
        onClick={() => toggleMusic()}
      >
        <Icon id={music ? 'i-music' : 'i-music-off'} />
      </button>
    </>
  )
}

/** Вкладки хаба в верхней полосе: библиотека (во что играть) и ресурсы (каталог). */
function HubTopTabs() {
  const all = useHubTab((s) => s.all)
  const setAll = useHubTab((s) => s.setAll)
  const go = (v: boolean) => {
    if (v === all) return
    setAll(v)
    const c = document.querySelector('.content')
    if (c) c.scrollTop = 0
  }
  return (
    <div className="tb-tabs" role="tablist" aria-label="Во что играем">
      <button role="tab" aria-selected={!all} className={'tb-tab' + (!all ? ' on' : '')} data-sound="nav" data-track="hub_tab_library" onClick={() => go(false)}>
        <PxIcon name="chest" size={22} /> Библиотека
      </button>
      <button role="tab" aria-selected={all} className={'tb-tab' + (all ? ' on' : '')} data-sound="nav" data-track="hub_tab_resources" onClick={() => go(true)}>
        <PxIcon name="book" size={22} /> Ресурсы
      </button>
    </div>
  )
}

/** Облачко сообщения 12×11 — пиксель-арт вместо контурной иконки. */
function MsgPx() {
  return (
    <svg className="lb-px" viewBox="0 0 12 11" aria-hidden="true" shapeRendering="crispEdges">
      <rect x="1" y="0" width="10" height="1" fill="#1b1f1c" />
      <rect x="0" y="1" width="12" height="6" fill="#1b1f1c" />
      <rect x="1" y="7" width="10" height="1" fill="#1b1f1c" />
      <rect x="2" y="8" width="3" height="1" fill="#1b1f1c" />
      <rect x="2" y="9" width="1" height="2" fill="#1b1f1c" />
      <rect x="1" y="1" width="10" height="6" fill="#ffffff" />
      <rect x="1" y="6" width="10" height="1" fill="#c9d3cc" />
      <rect x="3" y="7" width="2" height="1" fill="#ffffff" />
      <rect x="3" y="8" width="1" height="1" fill="#ffffff" />
      <rect x="3" y="3" width="1" height="2" fill="#2f8f46" />
      <rect x="5" y="3" width="2" height="2" fill="#2f8f46" />
      <rect x="8" y="3" width="1" height="2" fill="#2f8f46" />
    </svg>
  )
}

export function Sidebar({ onNav }: { onNav: (s: ScreenId) => void }) {
  const screen = useUi((s) => s.screen)
  const topBack = useTopBar((s) => s.back)
  const prelaunch = useUi((s) => s.prelaunch)
  const friends = useFriends((s) => s.friends)
  const reqIn = useFriends((s) => s.reqIn)
  const rooms = useRooms((s) => s.rooms)
  const millida = useHasMillida()
  const plusActive = usePlus((s) => s.active)
  useAccounts()
  const acc = getAccount()
  const gameName = useGameNick((s) => s.name)
  // The Millida game profile has its own name, and that is what the server sees.
  const inGameNick = acc && isMillidaKind(acc.kind) && gameName ? gameName : acc ? acc.nick : ''
  const chipRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [fbOpen, setFbOpen] = useState(false)
  const fbReward = !fbOpen && feedbackRewardReady()
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

  // Непрочитанное в группах считается тем же счётчиком: для человека это одно
  // и то же «мне написали», а не два разных места.
  const frAlerts = millida ? unreadTotal(friends) + roomsUnreadTotal(rooms) + reqIn.length : 0

  const lobby = screen === 'play'

  const dl = prelaunch.open ? (
    <div className="tb-dl" role="status">
      <span className="spin"></span>
      <span className="tb-dl-name">{PL_STAGES[prelaunch.stage] || prelaunch.msg || prelaunch.sub}</span>
      <span className="tb-dl-pct" id="dlPct">
        {Math.round(prelaunch.pct)}%
      </span>
      <span className="tb-dl-track">
        <span id="dlFill" style={{ width: prelaunch.pct + '%' }}></span>
      </span>
      <button className="tb-icon" aria-label="Отменить запуск" data-track="cancel_launch" onClick={cancelPrelaunch}>
        <Icon id="i-x" />
      </button>
    </div>
  ) : null


  if (lobby) {
    const onlineList = friends.filter((f) => f.online)
    const online = onlineList.length
    const unread = (millida ? unreadTotal(friends) + roomsUnreadTotal(rooms) : 0)
    const badge = (n: number) => (n ? <span className="lb-badge">{n > 99 ? '99+' : n}</span> : null)
    return (
      /* Лобби (правка владельца 23.09.2026, 21:00): справа вверху — отдельные
         кнопки, как в Brawl Stars: друзья (сколько в сети), сообщения
         (непрочитанное), аккаунт (голова и ник — менеджер аккаунтов),
         настройки. Без общей плашки-блока. */
      <>
      <header className="topbar is-lobby">
        {dl}
        <div className="lb-btns">
          {/* Друзья — первыми, аккаунт за ними: друзей смотрят постоянно,
              аккаунт меняют редко (владелец 24.09.2026, 07:47). Лица тех, кто в сети, внахлёст (как пати в Fortnite):
              живые головы вместо контурной иконки. Никого — серые Стив и Алекс. */}
          <span className="lb-badge-wrap">
            <button className="lb-btn lb-friends" data-sound="nav" data-track="nav_friends" aria-label={'Друзья, в сети ' + online} onClick={() => onNav('friends')}>
              <span className={'lb-heads' + (online ? '' : ' off')} aria-hidden="true">
                {(online ? onlineList.slice(0, 3) : [{ userId: 's', nickname: 'MHF_Steve' }, { userId: 'a', nickname: 'MHF_Alex' }]).map((f) => (
                  <Head key={f.userId} nick={f.nickname || 'MHF_Steve'} src={'avatarUrl' in f ? f.avatarUrl : undefined} size={36} className="lb-head" />
                ))}
              </span>
              <span className="lb-txt">
                <b>{online}</b>
                <i>в сети</i>
              </span>
            </button>
            {badge(reqIn.length)}
          </span>
          <div
            className="lb-btn lb-acc account"
            role="button"
            aria-label="Аккаунты"
            data-track="nav_accounts"
            data-private
            ref={chipRef}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={'ava' + (plusActive ? ' is-plus' : '')}>
              <Head
                nick={inGameNick || 'MHF_Steve'}
                kind={acc ? acc.kind : undefined}
                src={acc && acc.avatar}
                size={56}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </span>
            <span className="lb-acc-txt">
              <span className="acc-nick">{inGameNick || 'Гость'}</span>
              <i className={plusActive ? 'plus' : ''}>{plusActive ? 'PLUS' : acc ? accKindLabel(acc.kind) : 'Войти'}</i>
            </span>
            <Icon id="i-chev-d" />
          </div>
          {/* Звук и музыка — квадратами перед чатом (владелец 24.09.2026, 13:57). */}
          <LobbySoundBtns />
          <span className="lb-badge-wrap">
            <button
              className="lb-btn lb-msg"
              data-sound="nav"
              data-track="nav_messages"
              aria-label={unread ? 'Сообщения, непрочитанных ' + unread : 'Сообщения'}
              onMouseEnter={() => preloadScreen('chat')}
              onClick={openMessages}
            >
              <MsgPx />
            </button>
            {badge(unread)}
          </span>
          {/* Отзыв и баги — зелёный «жучок» между чатом и настройками (16:41). */}
          <button
            className={'lb-btn lb-fb' + (fbReward ? ' has-gift' : '')}
            data-sound="open"
            data-track="nav_feedback"
            aria-label="Отзыв о лаунчере"
            onClick={() => setFbOpen(true)}
          >
            <BugPx size={26} light />
            {fbReward ? <span className="lb-fb-gift">+{FEEDBACK_SHARDS}</span> : null}
          </button>
          {fbOpen ? <FeedbackModal onClose={() => setFbOpen(false)} /> : null}
          <button
            className="lb-btn"
            aria-label="Настройки"
            data-track="nav_settings"
            data-screen="settings"
            onMouseEnter={() => preloadScreen('settings')}
            onClick={() => onNav('settings')}
          >
            <Icon id="i-settings" />
          </button>
        </div>
        <AccountMenu open={menuOpen} onClose={() => setMenuOpen(false)} chipRef={chipRef} />
      </header>
      </>
    )
  }

  return (
    /* Внутренние экраны: только шапка — возврат в лобби, ход запуска, рубины.
       Название раздела не пишем: у каждого экрана свой заголовок. Вкладок
       разделов нет: в другой раздел — через лобби, как в Brawl Stars. */
    <header className="topbar">
      {/* Счётчик — красным значком на углу кнопки, как «!» у плиток лобби
          (владелец 25.09.2026): внутри кнопки его срезал угол. */}
      <span className="tb-back-wrap">
        <button
          className="tb-back"
          data-screen="play"
          data-sound="nav"
          data-track={topBack ? 'nav_back' : 'nav_play'}
          onClick={() => (topBack ? topBack() : onNav('play'))}
        >
          <Icon id="i-chev-l" />
          {topBack ? 'Назад' : 'Лобби'}
        </button>
        {frAlerts ? (
          <span className="tb-badge" aria-label="Новые сообщения и заявки">
            {frAlerts > 99 ? '99+' : frAlerts}
          </span>
        ) : null}
      </span>
      {/* «Библиотека | Ресурсы» — в самой верхней полосе, по центру
          (владелец 24.09.2026, 17:24). */}
      {screen === 'playhub' ? <HubTopTabs /> : null}
      <div className="tb-right">
        {screen === 'playhub' ? <PlayhubBar /> : null}
        {screen === 'skins' ? (
          <span className="ph-bar">
            <button className="btn md secondary" data-sound="open" data-track="skin_import" onClick={() => window.dispatchEvent(new Event(SKINS_IMPORT_EVENT))}>
              <Icon id="i-download" /> Импорт
            </button>
            <button className="btn md primary" data-sound="open" data-track="skin_upload" onClick={() => window.dispatchEvent(new Event(SKINS_UPLOAD_EVENT))}>
              <Icon id="i-upload" /> Загрузить скин
            </button>
          </span>
        ) : null}
        {dl}
        {/* Слот верхней полосы: магазин и хостинг ставят сюда баланс и действия,
            на один уровень с «← Лобби» (владелец 25.09.2026: убрать крупный
            заголовок, кошелёк — наверх). Экран заполняет его через TopbarPortal. */}
        <span className="tb-slot" id="tbSlot" />
      </div>
    </header>
  )
}
