import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { AccountMenu } from './AccountMenu'
import { Head } from './Head'
import { accKindLabel } from '../lib/format'
import { getAccount, isMillidaKind, useAccounts } from '../state/accounts'
import { useGameNick } from '../state/gameNick'
import { unreadTotal, useFriends } from '../state/friends'
import { radioOn, useMusic } from '../state/music'
import { BugPx } from './BugPx'
import { FEEDBACK_SHARDS, feedbackRewardReady } from './feedbackStatus'

// Окно отзыва открывают редко: его код — отдельный чанк.
const FeedbackModal = lazy(() => import('./Feedback').then((m) => ({ default: m.FeedbackModal })))
import { playSound, setSoundMode, soundMode, soundVolume } from '../lib/sound'
import { writePref } from '../lib/prefs'
import { Slider } from './Slider'
import { roomsUnreadTotal, useRooms } from '../state/rooms'
import { openMessages } from '../state/chatScreen'
import { PlayhubBar } from './hosts'
import { PxIcon } from './PxIcon'
import { openCatalogHome, useHubTab } from './playhub/hubTab'
import { SKINS_IMPORT_EVENT, SKINS_UPLOAD_EVENT, useTopBar } from '../state/topbar'
import { useUi } from '../state/ui'
import type { ScreenId } from '../state/ui'
import { useHasMillida } from '../state/auth'
import { usePlus } from '../state/plus'
import { PlusMark } from './premium/PlusMark'
import { onRealtime } from '../lib/realtime'
import { preloadScreen } from '../screens/registry'
import { useDaily } from '../state/daily'
import { useT } from '../i18n'

/* Навигация как в Brawl Stars: у каждого раздела ровно один вход (владелец
   23.09.2026: «всё дублируется»). В лобби вкладок нет — разделы живут на сцене,
   здесь только кошелёк, настройки и аккаунт в углу. На остальных экранах —
   шапка с «← Лобби» и ходом запуска. Имя компонента осталось Sidebar, чтобы не
   трогать раскладку App.tsx. */
/** Две квадратные кнопки лобби: звуки интерфейса и музыка (по умолчанию играет). */
/**
 * Быстрый звук под шестерёнкой (владелец 12.10.2026: «музыку и звуки — в
 * настройки, но чтобы школьник нашёл»). Кнопок звука и музыки в полосе больше
 * нет: всё живёт в «Настройки → Звук», а навёл на шестерёнку — выключил или
 * убавил, не заходя.
 */
function QuickSound() {
  const t = useT()
  const music = useMusic((s) => radioOn(s))
  const musicLevel = useMusic((s) => s.level)
  const setMusicLevel = useMusic((s) => s.setVolume)
  const toggleMusic = useMusic((s) => s.toggleRadio)
  const [sfxLevel, setSfxLevel] = useState(soundVolume)
  const [ui, setUi] = useState(() => soundMode() === 'all')
  useEffect(() => {
    const sync = () => {
      setUi(soundMode() === 'all')
      setSfxLevel(soundVolume())
    }
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])
  return (
    <span className="lb-vol-pop lb-quick-pop" role="group" aria-label={t('Звук')}>
      <span className="lb-vol-card lb-quick-card">
        <span className="lb-quick-row">
          <button
            className={'lb-quick-tg' + (ui ? '' : ' off')}
            aria-pressed={ui}
            aria-label={ui ? t('Выключить звуки') : t('Включить звуки')}
            data-track={ui ? 'sound_off' : 'sound_on'}
            data-notip
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
          <Slider
            value={sfxLevel}
            min={0}
            max={100}
            width={130}
            onChange={(v) => {
              setSfxLevel(v)
              writePref('m-sound-vol', String(v))
              playSound('click')
            }}
          />
          <b>{sfxLevel + '%'}</b>
        </span>
        <span className="lb-quick-row">
          <button
            className={'lb-quick-tg' + (music ? '' : ' off')}
            aria-pressed={music}
            aria-label={music ? t('Выключить музыку') : t('Включить музыку')}
            data-track={music ? 'music_off' : 'music_on'}
            data-notip
            onClick={() => toggleMusic()}
          >
            <Icon id={music ? 'i-music' : 'i-music-off'} />
          </button>
          <Slider value={musicLevel} min={0} max={100} width={130} onChange={setMusicLevel} />
          <b>{musicLevel + '%'}</b>
        </span>
      </span>
    </span>
  )
}

/** Вкладки хаба в верхней полосе: библиотека (во что играть) и ресурсы (каталог). */
/** libLabel — «Мои сборки» в раскладке «Классика», где так же назван пункт панели. */
export function HubTopTabs({ libLabel }: { libLabel?: string }) {
  const t = useT()
  const all = useHubTab((s) => s.all)
  const setAll = useHubTab((s) => s.setAll)
  const go = (v: boolean) => {
    if (v === all) return
    if (v) openCatalogHome()
    else setAll(v)
    const c = document.querySelector('.content')
    if (c) c.scrollTop = 0
  }
  return (
    <div className="tb-tabs" role="tablist" aria-label={t('Во что играем')}>
      <button role="tab" aria-selected={!all} className={'btn md tb-tab ' + (!all ? 'primary on' : 'secondary')} data-sound="nav" data-track="hub_tab_library" onClick={() => go(false)}>
        {/* Библиотека — книжная полка, не сундук (владелец 10.10.2026). */}
        <img className="tb-tab-block" src="/block-icons/Block52Millida.png" alt="" width={26} height={26} draggable={false} /> {libLabel ?? t('Библиотека')}
      </button>
      <button role="tab" aria-selected={all} className={'btn md tb-tab ' + (all ? 'primary on' : 'secondary')} data-sound="nav" data-track="hub_tab_resources" onClick={() => go(true)}>
        <PxIcon name="book" size={30} /> {t('Каталог')}
      </button>
    </div>
  )
}

export function Sidebar({ onNav }: { onNav: (s: ScreenId) => void }) {
  const t = useT()
  const screen = useUi((s) => s.screen)
  const topBack = useTopBar((s) => s.back)
  const topBare = useTopBar((s) => s.bare)
  const friends = useFriends((s) => s.friends)
  const reqIn = useFriends((s) => s.reqIn)
  const rooms = useRooms((s) => s.rooms)
  const millida = useHasMillida()
  const plusActive = usePlus((s) => s.active)
  const plusTier = usePlus((s) => s.tier)
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

  useEffect(() => onRealtime('account', () => void usePlus.getState().load()), [])

  // Непрочитанное в группах считается тем же счётчиком: для человека это одно
  // и то же «мне написали», а не два разных места.
  const frAlerts = millida ? unreadTotal(friends) + roomsUnreadTotal(rooms) + reqIn.length : 0

  const lobby = screen === 'play'

  if (lobby) {
    const onlineList = friends.filter((f) => f.online)
    const online = onlineList.length
    const unread = (millida ? unreadTotal(friends) + roomsUnreadTotal(rooms) : 0)
    const badge = (n: number) => (n ? <span className="lb-badge">{n > 99 ? '99+' : n}</span> : null)
    return (
      /* Лобби (правка владельца 23.09.2026, 21:00): справа вверху — отдельные
         кнопки, как в Brawl Stars. С 12.10.2026 их четыре: друзья (в сети,
         заявки и непрочитанное одним счётчиком — чат открывается оттуда же),
         аккаунт, отзыв, настройки (под шестерёнкой — быстрый звук). */
      <>
      <header className="topbar is-lobby">
        <div className="lb-btns">
          {/* Друзья — первыми, аккаунт за ними: друзей смотрят постоянно,
              аккаунт меняют редко (владелец 24.09.2026, 07:47). Лица тех, кто в сети, внахлёст (как пати в Fortnite):
              живые головы вместо контурной иконки. Никого — серые Стив и Алекс. */}
          <span className="lb-badge-wrap">
            <button
              className="lb-btn lb-friends"
              data-sound="nav"
              data-track={unread && !reqIn.length ? 'nav_messages' : 'nav_friends'}
              aria-label={unread ? t('Друзья, в сети {online}, непрочитанных {unread}', { online, unread }) : t('Друзья, в сети {online}', { online })}
              onMouseEnter={() => preloadScreen(unread ? 'chat' : 'friends')}
              onClick={() => (unread && !reqIn.length ? openMessages() : onNav('friends'))}
            >
              <span className={'lb-heads' + (online ? '' : ' off')} aria-hidden="true">
                {(online ? onlineList.slice(0, 3) : [{ userId: 's', nickname: 'MHF_Steve' }, { userId: 'a', nickname: 'MHF_Alex' }]).map((f) => (
                  <Head key={f.userId} nick={f.nickname || 'MHF_Steve'} src={'avatarUrl' in f ? f.avatarUrl : undefined} size={36} className="lb-head" />
                ))}
              </span>
              <span className="lb-txt">
                <b>{online}</b>
                <i>{t('в сети')}</i>
              </span>
            </button>
            {badge(reqIn.length + unread)}
          </span>
          <div
            className="lb-btn lb-acc account"
            role="button"
            aria-label={t('Аккаунты')}
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
              <span className="acc-nick-row">
                <span className="acc-nick">{inGameNick || t('Гость')}</span>
                <NickStreak />
              </span>
              {plusActive ? (
                <PlusMark tier={plusTier === 'DIAMOND' ? 'DIAMOND' : 'PLUS'} height={14} className="lb-pmark-badge" />
              ) : (
                <i>{acc ? accKindLabel(acc.kind) : t('Войти')}</i>
              )}
            </span>
            <Icon id="i-chev-d" />
          </div>
          {/* Отзыв и баги — зелёный «жучок» между чатом и настройками (16:41). */}
          <button
            className={'lb-btn lb-fb' + (fbReward ? ' has-gift' : '')}
            data-sound="open"
            data-track="nav_feedback"
            aria-label={t('Отзыв о лаунчере')}
            onClick={() => setFbOpen(true)}
          >
            <BugPx size={26} light />
            {fbReward ? <span className="lb-fb-gift">+{FEEDBACK_SHARDS}</span> : null}
          </button>
          {fbOpen ? (
            <Suspense fallback={null}>
              <FeedbackModal onClose={() => setFbOpen(false)} />
            </Suspense>
          ) : null}
          <span className="lb-vol lb-quick">
            <button
              className="lb-btn"
              aria-label={t('Настройки')}
              data-notip
              data-track="nav_settings"
              data-screen="settings"
              onMouseEnter={() => preloadScreen('settings')}
              onClick={() => onNav('settings')}
            >
              <Icon id="i-settings" />
            </button>
            <QuickSound />
          </span>
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
          {topBack ? t('Назад') : t('Лобби')}
        </button>
        {frAlerts ? (
          <span className="tb-badge" aria-label={t('Новые сообщения и заявки')}>
            {frAlerts > 99 ? '99+' : frAlerts}
          </span>
        ) : null}
      </span>
      {/* «Библиотека | Ресурсы» — в самой верхней полосе, по центру
          (владелец 24.09.2026, 17:24). */}
      {screen === 'playhub' && !topBare ? <HubTopTabs /> : null}
      <div className="tb-right">
        {screen === 'playhub' && !topBare ? <PlayhubBar /> : null}
        {screen === 'skins' ? (
          <span className="ph-bar">
            <button className="btn md secondary" data-sound="open" data-track="skin_import" onClick={() => window.dispatchEvent(new Event(SKINS_IMPORT_EVENT))}>
              <Icon id="i-download" /> {t('Импорт')}
            </button>
            <button className="btn md primary" data-sound="open" data-track="skin_upload" onClick={() => window.dispatchEvent(new Event(SKINS_UPLOAD_EVENT))}>
              <Icon id="i-upload" /> {t('Загрузить скин')}
            </button>
          </span>
        ) : null}
        {/* Слот верхней полосы: магазин и хостинг ставят сюда баланс и действия,
            на один уровень с «← Лобби» (владелец 25.09.2026: убрать крупный
            заголовок, кошелёк — наверх). Экран заполняет его через TopbarPortal. */}
        <span className="tb-slot" id="tbSlot" />
      </div>
    </header>
  )
}

/**
 * Огоньки серии — у ника в плашке аккаунта (владелец 11.10.2026: «огоньки
 * около никнейма»). Сегодня день ещё не засчитан — огонь погашен.
 */
function NickStreak() {
  const t = useT()
  const status = useDaily((s) => s.status)
  const n = status?.streak ?? 0
  if (n <= 0) return null
  return (
    <span className={'acc-streak' + (status?.activeToday === false ? ' pending' : '')} data-tip={t('Серия: {n} дн.', { n })}>
      <Icon id="i-flame" />
      {n}
    </span>
  )
}
