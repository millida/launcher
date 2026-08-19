import { useEffect, useState } from 'react'
import { showToast, useUi } from '../state/ui'
import type { SettingsTab } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import {
  appVersion,
  cacheSize,
  clearCache,
  convertFileSrc,
  defaultJava,
  discordClear,
  downloadJavaRuntime,
  javaMajors,
  listJavaRuntimes,
  openGameFolder,
  overlaySetEnabled,
  overlayState,
  pickGameDir,
  pickJavaPath,
  pickWallpaper,
  removeJavaRuntime,
  setDefaultJava,
  setGameDir,
} from '../ipc/commands'
import { refreshProfiles } from '../state/profiles'
import type { JavaInfo, JavaRuntime, OverlayState } from '../ipc/commands'
import { Icon } from '../components/Icon'
import { CloudSync } from '../components/CloudSync'
import { SharedStore } from '../components/SharedStore'
import { uiConfirm } from '../state/confirm'
import { ColorPicker } from '../components/ColorPicker'
import { AudioSettings } from '../components/AudioSettings'
import { checkForUpdate, pendingUpdate } from '../lib/updater'
import { useUpdate } from '../state/update'
import { discordPresence } from '../lib/launch'
import { fetchSounds, playSound, setSoundMode, soundMode, soundVolume } from '../lib/sound'
import type { SoundMode } from '../lib/sound'
import { notifyLevel, setNotifyLevel } from '../state/notifyPrefs'
import { setDesktopToasts } from '../lib/desktopToast'
import type { NotifyKind, NotifyLevel } from '../state/notifyPrefs'
import { Slider } from '../components/Slider'
import { Select } from '../components/Select'
import { writePref } from '../lib/prefs'
import { setMusicAutostart } from '../state/music'
import { useWallpaper } from '../state/wallpaper'
import { setTelemetryEnabled, telemetryEnabled, track } from '../lib/telemetry'
import { VIDEOS } from '../lib/wallpaper'
import { getAccount, getMillidaAccount, useAccounts } from '../state/accounts'
import { accKindLabel } from '../lib/format'
import { WALLET_URL, openExt } from '../lib/api'
// Наличие аккаунта берём из стора, а не вызовом hasMillidaAccount(): вызов не
// реактивен, и вкладка «Приватность», открытая до готовности хранилища сессий
// (или до входа в аккаунт), навсегда застревала на «Нужен аккаунт Millida».
import { useHasMillida } from '../state/auth'
import { setSkinSource, skinSource } from '../lib/gameProfile'
import { applyTheme, storedTheme, themeBasePinned, withColorFade } from '../lib/theme'
import { ThemeGallery } from '../components/ThemeGallery'
import type { ThemeId } from '../lib/theme'
import { startTour } from '../state/tour'
import { buildDiagnostics } from '../lib/diag'
import { copyText } from '../lib/clipboard'
import { loadPrivacy, usePrivacy } from '../lib/privacy'
import type { PrivacySettings } from '../lib/privacy'
import {
  hasTray,
  launchWindowMode,
  restoreOnGameExit,
  setLaunchWindowMode,
  setRestoreOnGameExit,
  setTrayClose,
  trayCloseEnabled,
} from '../lib/window'
import type { LaunchWindowMode } from '../lib/window'
import type { SkinSource } from '../lib/gameProfile'
import { accentFromHex, computeAccent, paintAccent, saveAccent } from '../lib/accent'
import type { Accent } from '../lib/accent'

const ACCENTS: Accent[] = [
  { id: 'green', c: '#5EC64D', h: '#70D55F', s: 'rgba(94,198,77,.13)' },
  { id: 'lime', c: '#9BD628', h: '#ACE23F', s: 'rgba(155,214,40,.14)' },
  { id: 'teal', c: '#22C7A9', h: '#3ADBBD', s: 'rgba(34,199,169,.14)' },
  { id: 'cyan', c: '#2CB6E8', h: '#48C6F2', s: 'rgba(44,182,232,.14)' },
  { id: 'blue', c: '#4C8DFF', h: '#639BFF', s: 'rgba(76,141,255,.14)' },
  { id: 'indigo', c: '#6C6BFF', h: '#8180FF', s: 'rgba(108,107,255,.14)' },
  { id: 'purple', c: '#9B6BFF', h: '#AC80FF', s: 'rgba(155,107,255,.14)' },
  { id: 'pink', c: '#FF6BAA', h: '#FF80B8', s: 'rgba(255,107,170,.14)' },
  { id: 'red', c: '#FF6B5E', h: '#FF8073', s: 'rgba(255,107,94,.14)' },
  { id: 'orange', c: '#F5923B', h: '#FFA24F', s: 'rgba(245,146,59,.14)' },
  { id: 'yellow', c: '#F5C93B', h: '#FFD65A', s: 'rgba(245,201,59,.14)' },
]

function applyAccent(raw: Accent) {
  const a = computeAccent(raw)
  paintAccent(a)
  saveAccent(a)
}

function initialCustomHex(): string {
  try {
    const s = JSON.parse(localStorage.getItem('m-accent') || 'null')
    if (s && s.id === 'custom') return s.c
  } catch {}
  return '#5EC64D'
}

function initialAccent(): string {
  try {
    const s = JSON.parse(localStorage.getItem('m-accent') || 'null')
    if (s) return s.id
  } catch {}
  return 'green'
}

type TabId = SettingsTab

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'look', label: 'Оформление', icon: 'i-brush' },
  { id: 'sound', label: 'Звук', icon: 'i-volume' },
  { id: 'game', label: 'Игра', icon: 'i-blocks' },
  { id: 'window', label: 'Окно', icon: 'i-monitor' },
  { id: 'privacy', label: 'Приватность', icon: 'i-shield' },
  { id: 'about', label: 'О лаунчере', icon: 'i-info' },
]

function initialTab(): TabId {
  try {
    const v = localStorage.getItem('m-set-tab')
    if (TABS.some((t) => t.id === v)) return v as TabId
  } catch {}
  return 'look'
}

/// Тумблеры приватности профиля. Те же поля правятся на millida.net —
/// подписи держим близкими к сайту, чтобы человек узнавал настройку.
const PRIVACY_ROWS: { key: keyof PrivacySettings; title: string; on: string; off: string }[] = [
  {
    key: 'showActivity',
    title: 'Игровая активность',
    on: 'В профиле видно, когда ты последний раз заходил в игру',
    off: 'Вместо активности посторонние видят «Игрок скрыл активность»',
  },
  {
    key: 'showServers',
    title: 'Серверы',
    on: 'Видно, на каких серверах ты играешь',
    off: 'Список серверов скрыт от посторонних',
  },
  {
    key: 'showPlaytime',
    title: 'Часы в игре',
    on: 'Наигранное время в сборках видно друзьям и в профиле',
    off: 'Часы и статистика по сборкам скрыты',
  },
  {
    key: 'showFriends',
    title: 'Список друзей',
    on: 'Друзья видны в профиле',
    off: 'Список друзей скрыт',
  },
  {
    key: 'showAchievements',
    title: 'Достижения',
    on: 'Полученные достижения видно в профиле',
    off: 'Достижения скрыты',
  },
  {
    key: 'showMarket',
    title: 'Активность на Маркете',
    on: 'Покупки и объявления видно в профиле',
    off: 'Активность на Маркете скрыта',
  },
]

export function Settings({ on }: { on: boolean }) {
  const wp = useWallpaper()
  const [tab, setTabState] = useState<TabId>(initialTab)
  const wantTab = useUi((s) => s.settingsTab)
  const takeSettingsTab = useUi((s) => s.takeSettingsTab)
  const [theme, setTheme] = useState<ThemeId>(storedTheme)
  const [accent, setAccent] = useState(initialAccent)
  const [customHex, setCustomHex] = useState(initialCustomHex)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [overlay, setOverlay] = useState<OverlayState>({ enabled: false, toasts: true, hotkey: 'Alt+M' })
  const [cacheMb, setCacheMb] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [winMode, setWinMode] = useState<LaunchWindowMode>(launchWindowMode)
  const [trayClose, setTrayCloseOn] = useState(trayCloseEnabled)
  const [telemetryOn, setTelemetryOn] = useState(telemetryEnabled)
  const [backAfterGame, setBackAfterGame] = useState(restoreOnGameExit)
  const [tray, setTray] = useState(hasTray)
  const [discord, setDiscord] = useState(() => localStorage.getItem('m-discord') !== '0')
  const [musicAuto, setMusicAuto] = useState(() => localStorage.getItem('m-mus-auto') !== '0')
  const [soundMd, setSoundMd] = useState<SoundMode>(soundMode)
  const [soundVol, setSoundVol] = useState(soundVolume)
  const [soundBusy, setSoundBusy] = useState(false)
  const [notifyLv, setNotifyLv] = useState<Record<NotifyKind, NotifyLevel>>(() => ({
    msg: notifyLevel('msg'),
    play: notifyLevel('play'),
    online: notifyLevel('online'),
    request: notifyLevel('request'),
    room: notifyLevel('room'),
  }))
  const [ver, setVer] = useState('')
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagText, setDiagText] = useState('')
  const [diagOpen, setDiagOpen] = useState(false)
  const [javas, setJavas] = useState<JavaRuntime[]>([])
  const [javaDef, setJavaDef] = useState<JavaInfo | null>(null)
  const [majors, setMajors] = useState<number[]>([8, 11, 17, 21])
  const [javaWant, setJavaWant] = useState(21)
  const [javaBusy, setJavaBusy] = useState(0)
  const [upd, setUpd] = useState(pendingUpdate)
  const [updBusy, setUpdBusy] = useState(false)
  const updStaged = useUpdate((s) => s.staged)
  const [skins, setSkins] = useState<SkinSource>(skinSource)
  useAccounts()
  const acc = getAccount()
  const millidaAcc = getMillidaAccount()

  useEffect(() => {
    if (!on || !hasTauri()) return
    setTray(hasTray())
    setTrayCloseOn(trayCloseEnabled())
    if (!ver) void appVersion().then(setVer).catch(() => {})
    if (cacheMb === null)
      void cacheSize()
        .then((b) => setCacheMb(Math.round(b / 1024 / 1024)))
        .catch(() => setCacheMb(0))
    void overlayState().then(setOverlay).catch(() => {})
    void listJavaRuntimes().then(setJavas).catch(() => {})
    void defaultJava().then(setJavaDef).catch(() => {})
    void javaMajors()
      .then((m) => m.length && setMajors(m))
      .catch(() => {})
  }, [on])

  useEffect(() => {
    if (!wantTab) return
    setTabState(wantTab)
    try {
      localStorage.setItem('m-set-tab', wantTab)
    } catch {}
    takeSettingsTab()
  }, [wantTab])

  const setTab = (id: TabId) => {
    setTabState(id)
    try {
      localStorage.setItem('m-set-tab', id)
    } catch {}
    const c = document.querySelector('.content')
    if (c) c.scrollTop = 0
  }

  // Приватность серверная и общая с сайтом: при открытии раздела перечитываем
  // её, чтобы увидеть значение, выставленное на millida.net с другого места.
  const privacy = usePrivacy()
  const hasMillida = useHasMillida()
  useEffect(() => {
    if (!on || !hasMillida) return
    void loadPrivacy(true)
  }, [on, hasMillida])

  const togglePrivacy = (key: keyof PrivacySettings) => {
    const next = !privacy.settings[key]
    const row = PRIVACY_ROWS.find((r) => r.key === key)
    privacy
      .patch({ [key]: next } as Partial<PrivacySettings>)
      .then(() => showToast((row ? row.title : 'Настройка') + (next ? ' — видно всем' : ' — скрыто')))
      .catch(() => showToast('Не удалось сохранить настройку приватности', 'error'))
  }

  // Смена папки без переноса файлов означала «сделай все сборки заново»:
  // спрашиваем и по умолчанию переносим уже скачанное.
  const changeDir = async () => {
    if (!hasTauri()) {
      showToast('Смена папки доступна в приложении лаунчера', 'error')
      return
    }
    try {
      const p = await pickGameDir()
      if (!p) return
      const move = await uiConfirm('Перенести в новую папку уже скачанные сборки, версии, миры и ассеты?', {
        confirmLabel: 'Перенести',
        cancelLabel: 'Оставить на месте',
        danger: false,
      })
      setMoving(true)
      showToast(move ? 'Переносим файлы игры…' : 'Меняем папку…')
      await setGameDir(p, move)
      await refreshProfiles()
      showToast(move ? 'Папка игры сменилась, файлы перенесены' : 'Папка игры сменилась')
    } catch (e) {
      showToast('Не удалось сменить папку: ' + e, 'error')
    } finally {
      setMoving(false)
    }
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-settings">
      <div className="page-head">
        <h1>Настройки</h1>
        <div className="right">
          <span className="faint-note" style={{ margin: 0 }}>
            {acc ? acc.nick + ' · ' + accKindLabel(acc.kind) : 'Аккаунт не выбран'}
          </span>
        </div>
      </div>

      <div className="set-screen">
        <div className="set-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={'set-tab' + (tab === t.id ? ' on' : '')}
              onClick={() => setTab(t.id)}
            >
              <Icon id={t.icon} />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'about' && millidaAcc ? (
          <div className="set-group">
            <div className="cap">Аккаунт Millida</div>
            <div className="set-row">
              <span className="lab">
                Баланс<small>Средства на аккаунте Millida — оплата хостинга и сервисов</small>
              </span>
              <span className="set-val" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--m-accent)' }}>
                {(((millidaAcc.balance || 0) / 100) | 0).toLocaleString('ru-RU')} ₽
              </span>
              <button
                className="btn sm primary"
                onClick={() => {
                  track('store_open', { where: 'wallet_topup' })
                  openExt(WALLET_URL)
                }}
              >
                <Icon id="i-wallet" /> Пополнить
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'look' ? (
        <>
        <ThemeGallery />

        <div className="set-group">
          <div className="cap">Тема и цвет</div>
          <div className="set-row">
            <span className="lab">
              Тема
              {themeBasePinned() ? <small>Задана выбранным оформлением</small> : null}
            </span>
            <div className="segs">
              {([
                ['', 'Тёмная'],
                ['light', 'Светлая'],
                ['auto', 'Авто'],
              ] as [ThemeId, string][]).map(([v, label]) => (
                <button
                  key={label}
                  className={'seg' + (theme === v ? ' on' : '')}
                  style={{ height: '32px', fontSize: '12.5px', opacity: themeBasePinned() ? 0.5 : 1 }}
                  data-t={v}
                  onClick={() => {
                    setTheme(v)
                    applyTheme(v)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span className="lab">
              Акцент<small>Цвет кнопок и выделения</small>
            </span>
            <div id="accentSwatches" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 26px)', gap: '9px', justifyContent: 'flex-end' }}>
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  data-acc={a.id}
                  title={a.id}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: '2px solid ' + (a.id === accent ? 'var(--m-fg)' : 'transparent'),
                    background: a.c,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    withColorFade(() => applyAccent(a))
                    setAccent(a.id)
                  }}
                ></button>
              ))}
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  title="Свой цвет"
                  onClick={() => setPickerOpen((o) => !o)}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: '2px solid ' + (accent === 'custom' ? 'var(--m-fg)' : 'transparent'),
                    background:
                      accent === 'custom'
                        ? customHex
                        : 'conic-gradient(from 0deg,#ff6b5e,#f5c93b,#5ec64d,#2cb6e8,#9b6bff,#ff6baa,#ff6b5e)',
                    cursor: 'pointer',
                    display: 'inline-block',
                  }}
                ></button>
                {pickerOpen ? (
                  <ColorPicker
                    value={customHex}
                    onClose={() => setPickerOpen(false)}
                    onChange={(hex) => {
                      setCustomHex(hex)
                      const a = accentFromHex(hex)
                      applyAccent(a)
                      setAccent('custom')
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="set-group">
          <div className="cap">Фон</div>
          <div className="set-row">
            <span className="lab">
              Живые обои<small>Анимированный фон на главном экране</small>
            </span>
            <span
              className={'tgl' + (wp.wpAnimOn ? ' on' : '')}
              id="setAnim"
              onClick={(e) => {
                e.stopPropagation()
                wp.toggleAnim()
              }}
            ></span>
          </div>
          <div className="set-row">
            <span className="lab">
              Фон при запуске<small>Случайный — при каждом запуске одно из видео</small>
            </span>
            <div className="segs">
              {[
                ['random', 'Случайный'],
                ['fixed', 'Выбранный'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={'seg' + (wp.wpMode === v ? ' on' : '')}
                  data-wpmode={v}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => wp.setMode(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row" style={{ alignItems: 'flex-start' }}>
            <span className="lab">
              Выбрать фон<small>Одно из видео — станет фоном главного экрана</small>
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', width: '300px' }}>
              {VIDEOS.map((v) => (
                <button
                  key={v.id}
                  title={v.name}
                  onClick={() => wp.pick(v.id, v.name)}
                  style={{
                    aspectRatio: '16/10',
                    borderRadius: '9px',
                    overflow: 'hidden',
                    border:
                      '2px solid ' +
                      (wp.wpMode === 'fixed' && wp.wpCur === v.id ? 'var(--m-accent)' : 'transparent'),
                    padding: 0,
                    cursor: 'pointer',
                    background: 'var(--m-inset)',
                  }}
                >
                  <img
                    src={v.poster}
                    alt={v.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="set-row" style={{ alignItems: 'flex-start' }}>
            <span className="lab">
              Свои фоны<small>Картинка, гифка или видео — храним последние 4</small>
            </span>
            <div className="wp-gallery">
              {wp.gallery.map((c) => (
                <div
                  key={c.path}
                  className={'wp-tile' + (wp.wpCur === 'custom' && wp.custom && wp.custom.path === c.path ? ' on' : '')}
                  title={c.name || 'Свой фон'}
                  onClick={() => wp.setCustom(c)}
                >
                  {c.kind === 'video' ? (
                    <span className="wp-tile-ph">
                      <Icon id="i-play" />
                    </span>
                  ) : (
                    <img src={convertFileSrc(c.path)} alt="" />
                  )}
                  <span className="wp-tile-name">{c.name || 'Свой фон'}</span>
                  <button
                    className="wp-tile-del"
                    title="Удалить"
                    onClick={(e) => {
                      e.stopPropagation()
                      wp.removeCustom(c.path)
                    }}
                  >
                    <Icon id="i-trash" />
                  </button>
                </div>
              ))}
              <button
                className="wp-tile add"
                onClick={() => {
                  if (!hasTauri()) {
                    showToast('Загрузка своего фона доступна в приложении', 'error')
                    return
                  }
                  void pickWallpaper()
                    .then((w) => {
                      if (w) wp.addCustom({ kind: w.kind, path: w.path, name: w.name })
                    })
                    .catch((e) => showToast('Не удалось загрузить фон: ' + e, 'error'))
                }}
              >
                <Icon id="i-upload" />
                <span className="wp-tile-name">Загрузить</span>
              </button>
            </div>
          </div>
        </div>

        </>
        ) : null}

        {tab === 'game' ? (
        <>
        <div className="set-group">
          <div className="cap">В игре</div>
          <div className="set-row">
            <span className="lab">
              Скины и плащи
              <small>
                {skins === 'millida'
                  ? 'Через Millida: тебя и других игроков лаунчера видно даже без лицензии'
                  : 'Через Mojang: как в обычном лаунчере, скин берётся из аккаунта Microsoft'}
              </small>
            </span>
            <div className="segs">
              {[
                ['millida', 'Millida'],
                ['mojang', 'Лицензия'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={'seg' + (skins === v ? ' on' : '')}
                  data-skinsrc={v}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => {
                    setSkins(v as SkinSource)
                    setSkinSource(v as SkinSource)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span className="lab">
              Оверлей поверх игры
              <small>Сообщения друзей прямо в Minecraft. Вызов — {overlay.hotkey}. Нужен оконный или безрамочный режим</small>
            </span>
            <span
              className={'tgl' + (overlay.enabled ? ' on' : '')}
              id="setOverlay"
              onClick={(e) => {
                e.stopPropagation()
                const next = !overlay.enabled
                setOverlay({ ...overlay, enabled: next })
                overlaySetEnabled(next).catch((err) => {
                  setOverlay({ ...overlay, enabled: !next })
                  showToast('Оверлей не включился: ' + err, 'error')
                })
              }}
            ></span>
          </div>
        </div>

        <div className="set-group">
          <div className="cap">Java</div>
          <div className="set-row">
            <span className="lab">
              Java
              <small>
                {javaDef
                  ? javaDef.version + ' · ' + javaDef.path
                  : 'Авто — лаунчер сам скачает ту версию, которую просит сборка'}
              </small>
            </span>
            <button
              className="btn sm secondary"
              onClick={() => {
                if (!hasTauri()) {
                  showToast('Выбор Java доступен в приложении', 'error')
                  return
                }
                pickJavaPath()
                  .then((j) => {
                    if (!j) return
                    return setDefaultJava(j.path).then(() => {
                      setJavaDef(j)
                      showToast('Java для всех сборок: ' + j.version)
                    })
                  })
                  .catch((e) => showToast('' + e, 'error'))
              }}
            >
              <Icon id="i-list" /> Указать путь
            </button>
            <button
              className="btn sm secondary"
              disabled={!javaDef}
              title={javaDef ? 'Вернуться к автоматическому выбору' : 'Java и так выбирается автоматически'}
              onClick={() => {
                setDefaultJava(null)
                  .then(() => {
                    setJavaDef(null)
                    showToast('Java снова выбирается автоматически')
                  })
                  .catch((e) => showToast('' + e, 'error'))
              }}
            >
              Авто
            </button>
          </div>
          <div className="set-row">
            <span className="lab">
              Скачать Java
              <small>
                {javaBusy
                  ? 'Качаем Java ' + javaBusy + ', это займёт минуту…'
                  : 'Возьмём сборку Eclipse Temurin с проверкой контрольной суммы'}
              </small>
            </span>
            <Select
              value={String(javaWant)}
              options={majors.map((m) => ({ value: String(m), label: 'Java ' + m }))}
              onChange={(v) => setJavaWant(Number(v))}
              width={130}
            />
            <button
              className="btn sm secondary"
              disabled={!!javaBusy}
              onClick={() => {
                if (!hasTauri()) {
                  showToast('Скачивание Java доступно в приложении', 'error')
                  return
                }
                setJavaBusy(javaWant)
                downloadJavaRuntime(javaWant)
                  .then((v) => {
                    showToast('Java готова: ' + v)
                    void listJavaRuntimes().then(setJavas).catch(() => {})
                  })
                  .catch((e) => showToast('' + e, 'error'))
                  .finally(() => setJavaBusy(0))
              }}
            >
              {javaBusy ? <span className="spin"></span> : <Icon id="i-download" />}
              {javaBusy ? 'Качаем…' : 'Скачать'}
            </button>
          </div>
          {javas.map((j) => (
            <div className="set-row" key={j.major}>
              <span className="lab">
                Java {j.major}
                <small>
                  {Math.round(j.size / 1024 / 1024) + ' МБ · '}
                  {j.in_use ? 'нужна сборкам' : 'сборками не используется'}
                </small>
              </span>
              <button
                className="btn sm secondary"
                disabled={j.in_use}
                title={j.in_use ? 'Эту Java просит одна из сборок' : 'Удалить, освободится место'}
                onClick={async () => {
                  if (
                    !(await uiConfirm('Удалить Java ' + j.major + '? Если она снова понадобится, лаунчер скачает её сам.', {
                      confirmLabel: 'Удалить',
                      danger: true,
                    }))
                  )
                    return
                  removeJavaRuntime(j.major)
                    .then((freed) => {
                      showToast('Освобождено ' + Math.round(freed / 1024 / 1024) + ' МБ')
                      void listJavaRuntimes().then(setJavas).catch(() => {})
                    })
                    .catch((e) => showToast('Не удалось удалить: ' + e, 'error'))
                }}
              >
                <Icon id="i-trash" /> Удалить
              </button>
            </div>
          ))}
        </div>

        <div className="set-group">
          <div className="cap">Файлы</div>
          <div className="set-row">
            <span className="lab">
              Папка игры<small>{moving ? 'Переносим файлы, не закрывай лаунчер…' : 'Сборки, миры и ассеты игры'}</small>
            </span>
            <button className="btn sm secondary" onClick={() => openGameFolder()} disabled={moving}>
              Открыть
            </button>
            <button className="btn sm secondary" onClick={() => void changeDir()} disabled={moving}>
              {moving ? 'Переносим…' : 'Сменить'}
            </button>
          </div>
          <div className="set-row">
            <span className="lab">
              Кэш и временные файлы<small>{cacheMb === null ? 'Считаем размер…' : cacheMb + ' МБ можно освободить'}</small>
            </span>
            <button
              className="btn sm secondary"
              disabled={clearing || !cacheMb}
              onClick={async () => {
                if (!hasTauri()) {
                  showToast('Доступно в приложении', 'error')
                  return
                }
                if (!(await uiConfirm('Очистить кэш и временные файлы? Сборки, миры и версии не тронем.', { confirmLabel: 'Очистить', danger: false })))
                  return
                setClearing(true)
                clearCache()
                  .then((freed) => {
                    showToast('Освобождено ' + Math.round(freed / 1024 / 1024) + ' МБ')
                    setCacheMb(0)
                  })
                  .catch((e) => showToast('Не удалось очистить: ' + e, 'error'))
                  .finally(() => setClearing(false))
              }}
            >
              <Icon id="i-trash" /> {clearing ? 'Чистим…' : 'Очистить'}
            </button>
          </div>
          <SharedStore />
        </div>

        <div className="set-group">
          <div className="cap">Облако</div>
          <CloudSync />
        </div>
        </>
        ) : null}

        {tab === 'sound' ? (
        <>
        <div className="set-group">
          <div className="cap">Звуки лаунчера</div>
          <div className="set-row">
            <span className="lab">
              Музыка при запуске<small>Фоновый плеер включается сам, когда открываешь лаунчер</small>
            </span>
            <span
              className={'tgl' + (musicAuto ? ' on' : '')}
              onClick={() => {
                const next = !musicAuto
                setMusicAuto(next)
                setMusicAutostart(next)
                showToast(next ? 'Музыка будет играть при запуске' : 'Музыка при запуске выключена')
              }}
            ></span>
          </div>
          <div className="set-row">
            <span className="lab">
              Звуки Minecraft<small>Настоящие звуки игры: свой на кнопку, вкладку, сундук, ачивку</small>
            </span>
            <div className="segs">
              {(
                [
                  ['off', 'Выкл'],
                  ['notify', 'Уведомления'],
                  ['all', 'Все звуки'],
                ] as [SoundMode, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  data-nosound
                  className={'seg' + (soundMd === v ? ' on' : '')}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => {
                    setSoundMd(v)
                    setSoundMode(v)
                    if (v === 'notify') playSound('notify')
                    if (v === 'all') playSound('click')
                    showToast(
                      v === 'off'
                        ? 'Звуки выключены'
                        : v === 'notify'
                          ? 'Звучат только уведомления'
                          : 'Озвучен весь интерфейс',
                      'ok',
                      false,
                    )
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {soundMd !== 'off' ? (
            <>
              <div className="set-row">
                <span className="lab">
                  Громкость звуков<small>Уведомления, клики и сигналы установки</small>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 0 240px' }}>
                  <Slider
                    value={soundVol}
                    min={0}
                    max={100}
                    onChange={(v) => {
                      setSoundVol(v)
                      writePref('m-sound-vol', String(v))
                      playSound(soundMd === 'all' ? 'click' : 'notify')
                    }}
                  />
                  <span className="set-val" style={{ width: '38px', textAlign: 'right' }}>
                    {soundVol + '%'}
                  </span>
                </div>
              </div>
              <div className="set-row">
                <span className="lab">
                  Набор звуков<small>Один звук на действие, всё из ассетов игры — свои файлы Mojang не раздаём</small>
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn sm" data-nosound onClick={() => playSound('achievement')}>
                    <Icon id="i-volume" /> Проверить
                  </button>
                  <button
                    className="btn sm"
                    disabled={soundBusy}
                    onClick={() => {
                      setSoundBusy(true)
                      fetchSounds()
                        .then((n) =>
                          showToast(n ? 'Звуков из игры: ' + n : 'Не удалось скачать звуки', n ? 'ok' : 'error', false),
                        )
                        .catch((e) => showToast('' + e, 'error', false))
                        .finally(() => setSoundBusy(false))
                    }}
                  >
                    {soundBusy ? <span className="spin"></span> : <Icon id="i-download" />} Обновить
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="set-group">
          <div className="cap">Уведомления</div>
          <div className="set-row">
            <span className="lab">
              Показывать поверх всего
              <small>Карточка в углу экрана, даже когда лаунчер свёрнут или идёт игра — как в Steam</small>
            </span>
            <span
              className={'tgl' + (overlay.toasts ? ' on' : '')}
              onClick={() => {
                const next = !overlay.toasts
                setOverlay({ ...overlay, toasts: next })
                setDesktopToasts(next).catch((err) => {
                  setOverlay({ ...overlay, toasts: !next })
                  showToast('' + err, 'error', false)
                })
                showToast(next ? 'Карточки будут поверх всего' : 'Карточки только внутри лаунчера', 'ok', false)
              }}
            ></span>
          </div>
          {(
            [
              ['msg', 'Личные сообщения', 'Карточка, когда пишут в личку'],
              ['room', 'Сообщения в группах', 'Карточка по новым сообщениям в общих чатах'],
              ['play', 'Друг зашёл в игру', 'Карточка, когда друг начал играть'],
              ['online', 'Друг в сети', 'Карточка, когда друг появился в лаунчере'],
              ['request', 'Заявки в друзья', 'Карточка о новой входящей заявке'],
            ] as [NotifyKind, string, string][]
          ).map(([kind, label, hint]) => (
            <div className="set-row" key={kind}>
              <span className="lab">
                {label}
                <small>{hint}</small>
              </span>
              <div className="segs">
                {(
                  [
                    ['sound', 'Со звуком'],
                    ['silent', 'Без звука'],
                    ['off', 'Выкл'],
                  ] as [NotifyLevel, string][]
                ).map(([v, seg]) => (
                  <button
                    key={v}
                    data-nosound
                    className={'seg' + (notifyLv[kind] === v ? ' on' : '')}
                    style={{ height: '32px', fontSize: '12.5px' }}
                    onClick={() => {
                      setNotifyLv((prev) => ({ ...prev, [kind]: v }))
                      setNotifyLevel(kind, v)
                      if (v === 'sound') playSound('notify')
                    }}
                  >
                    {seg}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="set-group">
          <div className="cap">Устройства</div>
          <AudioSettings />
        </div>
        </>
        ) : null}

        {tab === 'privacy' ? (
        <>
        <div className="set-group">
          <div className="cap">Профиль на millida.net</div>
          {!hasMillida ? (
            <div className="set-row">
              <span className="lab">
                Что видно в профиле<small>Нужен аккаунт Millida — настройки хранятся на нём</small>
              </span>
            </div>
          ) : (
            PRIVACY_ROWS.map((r) => {
              const val = privacy.settings[r.key]
              return (
                <div className="set-row" key={r.key}>
                  <span className="lab">
                    {r.title}
                    <small>{val ? r.on : r.off}</small>
                  </span>
                  {!privacy.loaded && privacy.loading ? (
                    <span className="skel" style={{ width: '38px', height: '22px', borderRadius: '99px' }}></span>
                  ) : (
                    <span
                      className={'tgl' + (val ? ' on' : '') + (privacy.saving === r.key ? ' busy' : '')}
                      onClick={() => togglePrivacy(r.key)}
                    ></span>
                  )}
                </div>
              )
            })
          )}
          {privacy.error ? (
            <div className="set-row">
              <span className="lab" style={{ color: 'var(--m-danger)' }}>
                {privacy.error}
              </span>
              <button className="btn sm" onClick={() => void loadPrivacy(true)}>
                Повторить
              </button>
            </div>
          ) : null}
          <p className="faint-note" style={{ margin: '10px 0 0' }}>
            Настройки общие с сайтом millida.net — меняются в обоих местах сразу и остаются на аккаунте после
            переустановки лаунчера.
          </p>
        </div>

        <div className="set-group">
          <div className="cap">Видно другим</div>
          <div className="set-row">
            <span className="lab">
              Активность в Discord
              <small>
                Показывать друзьям, во что играешь. Опыт в Discord Minecraft RU начисляется за часы с включённой
                активностью — выключишь, и часы перестанут оплачиваться.
              </small>
            </span>
            <span
              className={'tgl' + (discord ? ' on' : '')}
              onClick={() => {
                const next = !discord
                setDiscord(next)
                localStorage.setItem('m-discord', next ? '1' : '0')
                if (next) void discordPresence('lobby')
                else discordClear().catch(() => {})
                showToast(next ? 'Активность в Discord включена' : 'Активность в Discord выключена')
              }}
            ></span>
          </div>
        </div>

        <div className="set-group">
          <div className="cap">Данные о работе</div>
          <div className="set-row">
            <span className="lab">
              Анонимная статистика
              <small>
                Помогает чинить лаги и падения: система, железо, версия лаунчера и что не запустилось.
                Ни ников, ни файлов, ни адреса — только цифры.
              </small>
            </span>
            <span
              className={'tgl' + (telemetryOn ? ' on' : '')}
              id="setTelemetry"
              onClick={(e) => {
                e.stopPropagation()
                const next = !telemetryOn
                setTelemetryOn(next)
                setTelemetryEnabled(next)
                showToast(next ? 'Статистика включена — спасибо' : 'Статистика выключена')
              }}
            ></span>
          </div>
        </div>
        </>
        ) : null}

        {tab === 'window' ? (
        <div className="set-group">
          <div className="cap">Окно и трей</div>
          <div className="set-row">
            <span className="lab">
              При запуске игры
              <small>
                {winMode === 'tray'
                  ? 'Лаунчер уходит в трей — иконка рядом с часами, клик по ней вернёт окно'
                  : winMode === 'minimize'
                    ? 'Лаунчер сворачивается в панель задач'
                    : 'Лаунчер остаётся на экране'}
              </small>
            </span>
            <div className="segs">
              {[
                ['none', 'Оставить'],
                ['minimize', 'Свернуть'],
                ['tray', 'В трей'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={'seg' + (winMode === v ? ' on' : '')}
                  data-winmode={v}
                  disabled={v === 'tray' && !tray}
                  title={v === 'tray' && !tray ? 'Трей недоступен в этой системе' : ''}
                  style={{ height: '32px', fontSize: '12.5px', opacity: v === 'tray' && !tray ? 0.45 : 1 }}
                  onClick={() => {
                    const mode = v as LaunchWindowMode
                    setWinMode(mode)
                    setLaunchWindowMode(mode)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span className="lab">
              Возвращать после игры<small>Игра закрылась — лаунчер снова открывается сам</small>
            </span>
            <span
              className={'tgl' + (backAfterGame ? ' on' : '')}
              onClick={() => {
                const next = !backAfterGame
                setBackAfterGame(next)
                setRestoreOnGameExit(next)
              }}
            ></span>
          </div>
          <div className="set-row">
            <span className="lab">
              Закрывать в трей
              <small>
                {tray
                  ? 'Крестик прячет лаунчер к часам, полный выход — из меню иконки в трее'
                  : 'Трей недоступен в этой системе'}
              </small>
            </span>
            <span
              className={'tgl' + (trayClose ? ' on' : '')}
              style={{ opacity: tray ? 1 : 0.45 }}
              onClick={() => {
                if (!tray) {
                  showToast('Трей недоступен в этой системе', 'error')
                  return
                }
                const next = !trayClose
                setTrayCloseOn(next)
                setTrayClose(next)
                showToast(next ? 'Крестик убирает лаунчер в трей' : 'Крестик закрывает лаунчер')
              }}
            ></span>
          </div>
        </div>
        ) : null}

        {tab === 'about' ? (
        <div className="set-group">
          <div className="cap">Лаунчер</div>
          <div className="set-row">
            <span className="lab">
              Гайд по лаунчеру<small>Короткие подсказки по разделам — те же, что при первом запуске</small>
            </span>
            <button className="btn sm secondary" onClick={startTour}>
              <Icon id="i-play" /> Показать гайд
            </button>
          </div>
          <div className="set-row">
            <span className="lab">
              Данные для поддержки
              <small>
                {diagText
                  ? 'Скопировано — просто вставь в чат поддержки'
                  : 'Система, железо, версия, сборки и последние ошибки — одним текстом'}
              </small>
            </span>
            <button
              className="btn sm secondary"
              disabled={diagBusy}
              onClick={() => {
                setDiagBusy(true)
                buildDiagnostics()
                  .then(async (text) => {
                    setDiagText(text)
                    const ok = await copyText(text)
                    showToast(
                      ok ? 'Данные скопированы — отправь их в поддержку' : 'Не удалось скопировать, текст ниже — выдели и скопируй',
                      ok ? 'ok' : 'error',
                    )
                    if (!ok) setDiagOpen(true)
                  })
                  .catch((e) => showToast('Не удалось собрать данные: ' + e, 'error'))
                  .finally(() => setDiagBusy(false))
              }}
            >
              <Icon id="i-copy" /> {diagBusy ? 'Собираем…' : 'Скопировать'}
            </button>
            {diagText ? (
              <button className="btn sm secondary" onClick={() => setDiagOpen((o) => !o)}>
                {diagOpen ? 'Скрыть' : 'Показать'}
              </button>
            ) : null}
          </div>
          {diagText && diagOpen ? (
            <div className="set-row" style={{ alignItems: 'flex-start' }}>
              <textarea
                readOnly
                value={diagText}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '100%',
                  minHeight: '220px',
                  resize: 'vertical',
                  fontFamily: 'var(--m-mono)',
                  fontSize: '11.5px',
                  lineHeight: 1.5,
                  color: 'var(--m-fg)',
                  background: 'var(--m-inset)',
                  border: '1px solid var(--m-border)',
                  borderRadius: 'var(--m-r-md)',
                  padding: '10px 12px',
                }}
              />
            </div>
          ) : null}
          <div className="set-row">
            <span className="lab">
              Версия лаунчера
              <small>
                {upd
                  ? updStaged
                    ? 'Обновление ' + upd.version + ' встанет при выходе'
                    : 'Доступна ' + upd.version + ' — качаем'
                  : ver
                    ? 'Установлена ' + ver
                    : 'Millida Launcher'}
              </small>
            </span>
            {upd ? (
              <button
                className="btn sm primary"
                disabled={updBusy}
                onClick={() => {
                  setUpdBusy(true)
                  upd.install().catch((e) => {
                    setUpdBusy(false)
                    showToast('Не удалось обновиться: ' + e, 'error')
                  })
                }}
              >
                {updBusy ? 'Обновляем…' : 'Обновить и перезапустить'}
              </button>
            ) : (
              <button
                className="btn sm secondary"
                disabled={updBusy}
                onClick={() => {
                  setUpdBusy(true)
                  void checkForUpdate(true)
                    .then((u) => setUpd(u))
                    .finally(() => setUpdBusy(false))
                }}
              >
                {updBusy ? 'Проверяем…' : 'Проверить обновления'}
              </button>
            )}
          </div>
        </div>
        ) : null}

        <p className="faint-note" style={{ marginTop: '18px' }}>
          Настройки применяются сразу — сохранять не нужно.
        </p>
      </div>
    </section>
  )
}
