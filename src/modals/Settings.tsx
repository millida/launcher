import { useEffect, useState } from 'react'
import { useLayout, type Layout } from '../state/layout'
import type { ReactNode } from 'react'
import { showToast, useUi } from '../state/ui'
import type { SettingsTab } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import {
  appVersion,
  cacheSize,
  clearCache,
  defaultJava,
  discordClear,
  downloadJavaRuntime,
  javaMajors,
  listJavaRuntimes,
  openGameFolder,
  openUrl,
  overlaySetCardMs,
  overlaySetEnabled,
  overlayState,
  convertFileSrc,
  pickGameDir,
  pickJavaPath,
  removeJavaRuntime,
  setDefaultJava,
  setGameDir,
} from '../ipc/commands'
import { useMcVersionList } from '../state/mcVersionList'
import { refreshProfiles, useProfiles } from '../state/profiles'
import { openBuildSettings } from '../state/instance'
import { useLobby } from '../state/lobbyMode'
import type { JavaInfo, JavaRuntime, OverlayState } from '../ipc/commands'
import { CARD_TTL_CHOICES, CARD_TTL_MS } from '../lib/overlayCards'
import { apiErrorText } from '../lib/apiError'
import { Icon } from '../components/Icon'
import { Block, Group, Query, Row, Segs, Toggle } from '../components/SetKit'
import { CloudSync } from '../components/CloudSync'
import { SharedStore } from '../components/SharedStore'
import { BackupsFolderRow } from '../components/BackupsFolderRow'
import { AmbienceRows } from '../components/lobby/AmbienceRows'
import { openMcNews } from '../components/McNews'
import { A11yRows } from '../components/A11yRows'
import { uiChoice, uiConfirm } from '../state/confirm'
import { ColorPicker } from '../components/ColorPicker'
import { AppIconPicker } from '../components/AppIconPicker'
import { AudioSettings } from '../components/AudioSettings'
import { RewindClips } from '../components/RewindClips'
import { GlobalPresetPicker } from '../components/GfxPresets'
import { globalChoice, setGlobalChoice, type GfxChoice } from '../lib/gfxPresets'
import { GRAPHICS_PRESETS_PUBLIC } from '../lib/graphicsRelease'
import { MusicPlayer, RadioCredits } from '../components/radio'
import { betaChannel, checkForUpdate, pendingUpdate } from '../lib/updater'
import { useUpdate } from '../state/update'
import { discordPresence } from '../lib/launch'
import { radioOn, useMusic } from '../state/music'
import { fetchSounds, playSound, setSoundMode, soundMode, soundVolume } from '../lib/sound'
import type { SoundMode } from '../lib/sound'
import { notifyLevel, setNotifyLevel } from '../state/notifyPrefs'
import { setDesktopToasts } from '../lib/desktopToast'
import { setStreakRemind, streakRemindOn } from '../lib/streakReminder'
import { autostartOn, setAutostart } from '../lib/autostart'
import type { NotifyKind, NotifyLevel } from '../state/notifyPrefs'
import { Slider } from '../components/Slider'
import { Select } from '../components/Select'
import { type MarketFeature, marketOffers, t, useMarket, useT } from '../i18n'
import { LangPicker } from '../components/LangPicker'
import { writePref } from '../lib/prefs'
import { musicAutostartOn, setMusicAutostart } from '../state/music'
import { setTelemetryEnabled, telemetryEnabled, track, trackFailure } from '../lib/telemetry'
import { getAccount, getMillidaAccount, useAccounts } from '../state/accounts'
import { balanceText, openTopup, useMoney } from '../lib/useMoney'
// Наличие аккаунта берём из стора, а не вызовом hasMillidaAccount(): вызов не
// реактивен, и вкладка «Приватность», открытая до готовности хранилища сессий
// (или до входа в аккаунт), навсегда застревала на «Нужен аккаунт Millida».
import { useHasMillida } from '../state/auth'
import { setSkinSource, skinSource } from '../lib/gameProfile'
import { millidaModEnabled, setMillidaModEnabled } from '../ipc/commands'
import { startTour } from '../state/tour'
import { buildDiagnostics } from '../lib/diag'
import { copyText } from '../lib/clipboard'
import { loadPrivacy, usePrivacy } from '../lib/privacy'
import type { PrivacyFlag, PrivacySettings } from '../lib/privacy'
import { DUO_INVITE_OPTIONS, type DuoInvites } from '../lib/duoEmotes'
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
import { logoutToLogin } from '../lib/session'
import { PremiumSwatches, ThemeRow } from '../components/premium/ThemeRow'
import { leavePremiumLook, markThemeChoice } from '../lib/premiumTheme'
import { accentFromHex, computeAccent, paintAccent, saveAccent, withColorFade } from '../lib/accent'
import type { Accent } from '../lib/accent'
import { canPickBackdrop, pickBackdrop } from '../lib/pickBackdrop'
import { STILLS } from '../lib/wallpaper'
import { useWallpaper } from '../state/wallpaper'
import { TAB_MS_DEFAULT, useViewPrefs } from '../state/viewPrefs'
import type { PerfMode } from '../state/viewPrefs'

/* ============================================================
   НАСТРОЙКИ — упрощены 23.09.2026 по правкам владельца:
   «вместо тем — цвет кнопок», «не левая панель — сверху кнопки»,
   «настройки попроще».

   - Шесть вкладок сверху: Вид · Звук · Игра · Файлы · Аккаунт · Лаунчер.
     Уведомления — в «Звуке», приватность — в «Аккаунте», трей — в «Лаунчере».
   - Строка = название и управление. Пояснение — одна строка и только там,
     где без него непонятно, или живое число (размер кэша, версия Java).
   - Поиск по всем вкладкам сразу: строка сама решает, подходит ли она (Row → keys).
   ============================================================ */

const accents = (): (Accent & { name: string })[] => [
  { id: 'green', name: t('Зелёный'), c: '#5EC64D', h: '#70D55F', s: 'rgba(94,198,77,.13)' },
  { id: 'lime', name: t('Лайм'), c: '#9BD628', h: '#ACE23F', s: 'rgba(155,214,40,.14)' },
  { id: 'teal', name: t('Бирюзовый'), c: '#22C7A9', h: '#3ADBBD', s: 'rgba(34,199,169,.14)' },
  { id: 'cyan', name: t('Голубой'), c: '#2CB6E8', h: '#48C6F2', s: 'rgba(44,182,232,.14)' },
  { id: 'blue', name: t('Синий'), c: '#4C8DFF', h: '#639BFF', s: 'rgba(76,141,255,.14)' },
  { id: 'indigo', name: t('Индиго'), c: '#6C6BFF', h: '#8180FF', s: 'rgba(108,107,255,.14)' },
  { id: 'purple', name: t('Фиолетовый'), c: '#9B6BFF', h: '#AC80FF', s: 'rgba(155,107,255,.14)' },
  { id: 'pink', name: t('Розовый'), c: '#FF6BAA', h: '#FF80B8', s: 'rgba(255,107,170,.14)' },
  { id: 'red', name: t('Красный'), c: '#FF6B5E', h: '#FF8073', s: 'rgba(255,107,94,.14)' },
  { id: 'orange', name: t('Оранжевый'), c: '#F5923B', h: '#FFA24F', s: 'rgba(245,146,59,.14)' },
  { id: 'yellow', name: t('Жёлтый'), c: '#F5C93B', h: '#FFD65A', s: 'rgba(245,201,59,.14)' },
  // Больше готовых цветов (правка владельца 23.09.2026): «лучше больше цветов».
  ...(
    [
      ['emerald', t('Изумрудный'), '#2BB673'],
      ['mint', t('Мятный'), '#5FE0B0'],
      ['sky', t('Небесный'), '#6FC3FF'],
      ['azure', t('Лазурный'), '#3A6FE0'],
      ['lavender', t('Лавандовый'), '#B79CFF'],
      ['magenta', t('Малиновый'), '#E8457A'],
      ['coral', t('Коралловый'), '#FF8A65'],
      ['amber', t('Янтарный'), '#FFB020'],
      ['sand', t('Песочный'), '#D8B26E'],
      ['silver', t('Серебряный'), '#BFC7CF'],
    ] as const
  ).map(([id, name, hex]) => ({ ...accentFromHex(hex), id, name })),
]

function applyAccent(raw: Accent, settled = false) {
  markThemeChoice()
  leavePremiumLook()
  const a = computeAccent(raw)
  paintAccent(a, settled)
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

type SecId = 'look' | 'graphics' | 'sound' | 'game' | 'clips' | 'files' | 'account' | 'about'

const sections = (): { id: SecId; label: string }[] => [
  { id: 'look', label: t('Вид') },
  ...(GRAPHICS_PRESETS_PUBLIC ? [{ id: 'graphics' as const, label: t('Графика') }] : []),
  { id: 'sound', label: t('Звук') },
  { id: 'game', label: t('Игра') },
  { id: 'clips', label: t('Клипы') },
  { id: 'files', label: t('Файлы') },
  { id: 'account', label: t('Аккаунт') },
  { id: 'about', label: t('Лаунчер') },
]

/// Старые адреса вкладок (openSettings('notify') и сохранённый m-set-tab)
/// ведут туда, куда переехало их содержимое.
const MOVED: Record<string, SecId> = { window: 'game', notify: 'sound', privacy: 'account' }

function toSec(v: string | null | undefined): SecId | null {
  if (!v) return null
  if (MOVED[v]) return MOVED[v]
  return sections().some((s) => s.id === v) ? (v as SecId) : null
}

function initialSec(): SecId {
  try {
    return toSec(localStorage.getItem('m-set-tab')) || 'look'
  } catch {
    return 'look'
  }
}

/// Тумблеры приватности профиля. Те же поля правятся на millida.net —
/// подписи держим близкими к сайту, чтобы человек узнавал настройку.
const privacyRows = (): { key: PrivacyFlag; title: string; feature?: MarketFeature }[] => [
  { key: 'showActivity', title: t('Игровая активность') },
  { key: 'showServers', title: t('Серверы') },
  { key: 'showPlaytime', title: t('Часы в игре') },
  { key: 'showFriends', title: t('Список друзей') },
  { key: 'showAchievements', title: t('Достижения') },
  { key: 'showMarket', title: t('Маркет'), feature: 'market' },
]

const notifyRows = (): [NotifyKind, string][] => [
  ['msg', t('Личные сообщения')],
  ['room', t('Сообщения в группах')],
  ['play', t('Друг зашёл в игру')],
  ['online', t('Друг в сети')],
  ['request', t('Заявки в друзья')],
]

const notifyLevels = (): [NotifyLevel, string][] => [
  ['sound', t('Со звуком')],
  ['silent', t('Без звука')],
  ['off', t('Выкл')],
]

export function Settings({ on }: { on: boolean }) {
  const t = useT()
  const market = useMarket()
  const [sec, setSecState] = useState<SecId>(initialSec)
  const [query, setQuery] = useState('')
  const memProfiles = useProfiles((s) => s.profiles)
  const memPicked = useLobby((s) => s.picked)
  const wantTab = useUi((s) => s.settingsTab)
  const takeSettingsTab = useUi((s) => s.takeSettingsTab)
  const [gfx, setGfx] = useState<GfxChoice>(() => globalChoice() ?? 'auto')
  // «Авто — под мой ПК» по умолчанию; просмотр вкладки ничего не сохраняет.
  const [accent, setAccent] = useState(initialAccent)
  const [customHex, setCustomHex] = useState(initialCustomHex)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [overlay, setOverlay] = useState<OverlayState>({
    enabled: false,
    toasts: true,
    hotkey: 'Alt+M',
    cardMs: CARD_TTL_MS,
  })
  const [modOn, setModOn] = useState(true)
  const showSnapshots = useMcVersionList((s) => s.show)
  const [cacheMb, setCacheMb] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [winMode, setWinMode] = useState<LaunchWindowMode>(launchWindowMode)
  const [trayClose, setTrayCloseOn] = useState(trayCloseEnabled)
  const [telemetryOn, setTelemetryOn] = useState(telemetryEnabled)
  const [backAfterGame, setBackAfterGame] = useState(restoreOnGameExit)
  const [tray, setTray] = useState(hasTray)
  const [autostart, setAutostartOn] = useState(false)
  const [streakRemind, setStreakRemindOn] = useState(streakRemindOn)
  const [discord, setDiscord] = useState(() => localStorage.getItem('m-discord') !== '0')
  const [musicAuto, setMusicAuto] = useState(musicAutostartOn)
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
  const [beta, setBeta] = useState(betaChannel)
  const updStaged = useUpdate((s) => s.staged)
  const [skins, setSkins] = useState<SkinSource>(skinSource)
  const charAnim = useViewPrefs((s) => s.charAnim)
  const bgAnim = useViewPrefs((s) => s.bgAnim)
  const tabMs = useViewPrefs((s) => s.tabMs)
  const perf = useViewPrefs((s) => s.perf)
  const layout = useLayout((s) => s.layout)
  useAccounts()
  useMoney()
  const acc = getAccount()
  const millidaAcc = getMillidaAccount()

  useEffect(() => {
    if (!on || !hasTauri()) return
    setTray(hasTray())
    setTrayCloseOn(trayCloseEnabled())
    void autostartOn().then(setAutostartOn)
    if (!ver) void appVersion().then(setVer).catch(() => {})
    if (cacheMb === null)
      void cacheSize()
        .then((b) => setCacheMb(Math.round(b / 1024 / 1024)))
        .catch(() => setCacheMb(0))
    void overlayState().then(setOverlay).catch(() => {})
    void millidaModEnabled().then(setModOn).catch(() => {})
    void listJavaRuntimes().then(setJavas).catch(() => {})
    void defaultJava().then(setJavaDef).catch(() => {})
    void javaMajors()
      .then((m) => m.length && setMajors(m))
      .catch(() => {})
  }, [on])

  useEffect(() => {
    const want = toSec(wantTab as SettingsTab | null)
    if (!want) return
    setSec(want)
    takeSettingsTab()
  }, [wantTab])

  const setSec = (id: SecId) => {
    setSecState(id)
    setQuery('')
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

  const pickDuoInvites = (value: DuoInvites) => {
    if (value === privacy.settings.duoInvites || privacy.saving === 'duoInvites') return
    privacy
      .patch({ duoInvites: value })
      .then(() => showToast(t('Эмоции вдвоём: {who}', { who: t(DUO_INVITE_OPTIONS.find(([v]) => v === value)?.[1] ?? '').toLowerCase() })))
      .catch(() => showToast(t('Не удалось сохранить настройку приглашений'), 'error'))
  }

  const togglePrivacy = (key: PrivacyFlag) => {
    const next = !privacy.settings[key]
    const row = privacyRows().find((r) => r.key === key)
    privacy
      .patch({ [key]: next } as Partial<PrivacySettings>)
      .then(() => {
        const name = row ? row.title : t('Настройка')
        showToast(next ? t('{name} — видно всем', { name }) : t('{name} — скрыто', { name }))
      })
      .catch(() => showToast(t('Не удалось сохранить настройку приватности'), 'error'))
  }

  const onlyApp = (what: string) => {
    if (hasTauri()) return false
    showToast(t('{what} — в приложении лаунчера', { what }), 'error')
    return true
  }

  // Смена папки без переноса файлов означала «сделай все сборки заново»:
  // спрашиваем и по умолчанию переносим уже скачанное.
  const changeDir = async () => {
    if (onlyApp(t('Смена папки'))) return
    try {
      const p = await pickGameDir()
      if (!p) return
      // «Оставить на месте» is an action of its own: closing the question must
      // not switch the folder without the builds.
      const answer = await uiChoice(t('Перенести в новую папку уже скачанные сборки, версии, миры и ассеты?'), {
        confirmLabel: t('Перенести'),
        cancelLabel: t('Оставить на месте'),
        danger: false,
      })
      if (answer === 'dismiss') return
      const move = answer === 'yes'
      setMoving(true)
      showToast(move ? t('Переносим файлы игры…') : t('Меняем папку…'))
      await setGameDir(p, move)
      await refreshProfiles()
      showToast(move ? t('Папка игры сменилась, файлы перенесены') : t('Папка игры сменилась'))
    } catch (e) {
      console.error('[settings] game dir', e)
      const why = String((e as { message?: string } | null)?.message ?? e ?? '').trim()
      showToast(why ? t('Папка не сменилась') + ': ' + why : t('Папка не сменилась'), 'error')
    } finally {
      setMoving(false)
    }
  }

  const wp = useWallpaper()
  const ownPictures = wp.gallery.filter((c) => c.kind !== 'video')

  const uploadBackdrop = () => {
    if (!canPickBackdrop()) {
      onlyApp(t('Свой фон'))
      return
    }
    void pickBackdrop()
      .then((picked) => {
        if (!picked) return
        if (picked.kind === 'video') {
          showToast(t('Фоном ставится картинка: PNG, JPG или WebP'), 'error')
          return
        }
        wp.addCustom(picked)
      })
      .catch((e) => {
        console.error('[settings] backdrop', e)
        showToast(t('Фон не загрузился — попробуй другую картинку'), 'error')
      })
  }

  /* ================= Вкладки ================= */

  const look = (
    <>
      <Block keys="язык language интерфейс перевод">
        <Group title={t('Язык')}>
          <Row title={t('Язык интерфейса')} keys="язык language">
            <LangPicker variant="field" />
          </Row>
        </Group>
      </Block>

      <Block keys="цвет кнопок акцент цвет выделения палитра тема лаунчера plus diamond премиум">
        <Group title={t('Цвет кнопок')}>
          <div className="s2-swatches" id="accentSwatches" role="radiogroup" aria-label={t('Цвет кнопок')}>
            {accents().map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={a.id === accent}
                data-acc={a.id}
                aria-label={a.name}
                className={'s2-sw' + (a.id === accent ? ' on' : '')}
                style={{ background: a.c }}
                onClick={() => {
                  withColorFade(() => applyAccent(a, true))
                  setAccent(a.id)
                }}
              ></button>
            ))}
            <PremiumSwatches current={accent} onPick={setAccent} />
            <span className="s2-sw-wrap">
              <button
                aria-label={t('Свой цвет')}
                className={'s2-sw custom' + (accent === 'custom' ? ' on' : '')}
                style={accent === 'custom' ? { background: customHex } : undefined}
                onClick={() => setPickerOpen((o) => !o)}
              >
                {accent === 'custom' ? null : <Icon id="i-plus" />}
              </button>
              {pickerOpen ? (
                <ColorPicker
                  value={customHex}
                  onClose={() => setPickerOpen(false)}
                  onChange={(hex) => {
                    setCustomHex(hex)
                    applyAccent(accentFromHex(hex))
                    setAccent('custom')
                  }}
                />
              ) : null}
            </span>
          </div>
        </Group>
        <Group title={t('Тема лаунчера')}>
          <ThemeRow />
        </Group>
      </Block>

      <Block keys="фон лобби обои картинка фото свой фон загрузить сцена галерея">
        <Group title={t('Фон')}>
          <div className="s2-wp">
            <button
              aria-label={t('Сцена')}
              className={'s2-wp-tile' + (wp.wpCur === 'pixels' ? ' on' : '')}
              onClick={() => wp.pick('pixels', t('Сцена'))}
            >
              <i className="s2-wp-pixels" aria-hidden="true" />
              <span>{t('Сцена')}</span>
            </button>
            {STILLS.map((v) => (
              <button
                key={v.id}
                aria-label={v.name}
                className={'s2-wp-tile' + (wp.wpCur === v.id ? ' on' : '')}
                onClick={() => wp.pick(v.id, v.name)}
              >
                <img src={v.thumb} alt="" />
                <span>{v.name}</span>
              </button>
            ))}
            {ownPictures.map((c) => (
              <div
                key={c.path}
                role="button"
                tabIndex={0}
                aria-label={c.name || t('Свой фон')}
                className={
                  's2-wp-tile' + (wp.wpCur === 'custom' && wp.custom && wp.custom.path === c.path ? ' on' : '')
                }
                onClick={() => wp.setCustom(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') wp.setCustom(c)
                }}
              >
                <img src={convertFileSrc(c.path)} alt="" />
                <span>{c.name || t('Свой фон')}</span>
                <button
                  className="s2-wp-del"
                  aria-label={t('Удалить фон')}
                  onClick={(e) => {
                    e.stopPropagation()
                    wp.removeCustom(c.path)
                  }}
                >
                  <Icon id="i-trash" />
                </button>
              </div>
            ))}
            <button className="s2-wp-tile add" onClick={uploadBackdrop}>
              <span className="s2-wp-ph">
                <Icon id="i-upload" />
              </span>
              <span>{t('Свой фон')}</span>
            </button>
          </div>
        </Group>
      </Block>


      <Block keys="иконка приложения значок ярлык док панель задач искра пламя аметист легенда золото алмаз">
        <Group title={t('Иконка приложения')}>
          <AppIconPicker />
        </Group>
      </Block>

      <A11yRows />

      <Block keys="анимация движение персонаж танцует фон переход между вкладками скорость плавность оптимизация качество слабый пк производительность лаги fps">
        <Group title={t('Анимация')}>
          <Row title={t('Оптимизация')} keys="оптимизация качество слабый пк производительность лаги fps плавность">
            <Segs<PerfMode>
              value={perf}
              options={[
                ['auto', t('Авто')],
                ['high', t('Полное')],
                ['low', t('Слабый ПК')],
              ]}
              onPick={(v) => useViewPrefs.getState().setPerf(v)}
            />
          </Row>
          <Row title={t('Персонаж танцует')} keys="персонаж анимация танец движение">
            <Toggle label={t('Персонаж танцует')} on={charAnim} onChange={() => useViewPrefs.getState().setCharAnim(!charAnim)} />
          </Row>
          <Row title={t('Живой фон')} keys="фон анимация сцена лобби волна искры">
            <Toggle label={t('Живой фон')} on={bgAnim} onChange={() => useViewPrefs.getState().setBgAnim(!bgAnim)} />
          </Row>
          <AmbienceRows />
          <Row title={t('Переход между вкладками')} keys="переход вкладки скорость длительность плавность анимация">
            <Segs<number>
              value={tabMs}
              options={[
                [0, t('Выкл')],
                [TAB_MS_DEFAULT, t('Быстро')],
                [280, t('Обычно')],
                [640, t('Медленно')],
              ]}
              onPick={(v) => useViewPrefs.getState().setTabMs(v)}
            />
          </Row>
        </Group>
      </Block>

      {/* В самом конце «Вида» (владелец 07.10.2026: «чтобы мало кто видел»). */}
      <Block keys="старый вид старая версия новая версия раскладка меню боковая панель классика лобби интерфейс">
        <Group title={t('Версия интерфейса')}>
          <Row title={t('Вид лаунчера')} hint={t('Старый — разделы в панели слева')} keys="старый вид новая версия раскладка боковая панель классика лобби">
            <Segs<Layout>
              value={layout}
              options={[
                ['lobby', t('Новый')],
                ['classic', t('Старый')],
              ]}
              onPick={(v) => useLayout.getState().set(v)}
            />
          </Row>
        </Group>
      </Block>
    </>
  )

  const sound = (
    <>
      <Group title={t('Музыка')}>
        <Row title={t('Музыка сейчас')} keys="музыка радио включить выключить">
          <MusicNow />
        </Row>
        <Row title={t('Музыка при запуске')} keys="мелодия фоновая">
          <Toggle
            label={t('Музыка при запуске')}
            on={musicAuto}
            onChange={() => {
              const next = !musicAuto
              setMusicAuto(next)
              setMusicAutostart(next)
            }}
          />
        </Row>
        <MusicPlayer />
        <RadioCredits />
      </Group>

      <Group title={t('Звуки')}>
        <Row title={t('Звуки Minecraft')} keys="звуки интерфейса клики тишина">
          <Segs<SoundMode>
            value={soundMd}
            options={[
              ['off', t('Выкл')],
              ['notify', t('Уведомления')],
              ['all', t('Все')],
            ]}
            onPick={(v) => {
              setSoundMd(v)
              setSoundMode(v)
              if (v === 'notify') playSound('notify')
              if (v === 'all') playSound('click')
            }}
          />
        </Row>
        {soundMd !== 'off' ? (
          <Row title={t('Громкость звуков')} keys="громкость">
            <div className="s2-slider">
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
              <span className="s2-val">{soundVol + '%'}</span>
              <button className="btn sm ghost" data-nosound aria-label={t('Проверить звук')} onClick={() => playSound('achievement')}>
                <Icon id="i-play" />
              </button>
              <button
                className="btn sm ghost"
                disabled={soundBusy}
                aria-label={t('Скачать звуки из игры заново')}
                data-tip={t('Скачать звуки из игры заново')}
                onClick={() => {
                  setSoundBusy(true)
                  fetchSounds()
                    .then((n) =>
                      showToast(n ? t('Звуков из игры: {n}', { n }) : t('Не удалось скачать звуки'), n ? 'ok' : 'error', false),
                    )
                    .catch((e) => {
                      console.error('[settings] sounds', e)
                      showToast(t('Звуки не скачались'), 'error', false)
                    })
                    .finally(() => setSoundBusy(false))
                }}
              >
                {soundBusy ? <span className="spin"></span> : <Icon id="i-restart" />}
              </button>
            </div>
          </Row>
        ) : null}
      </Group>

      <Block keys="уведомления сообщения друг в сети заявки группы в игре со звуком без звука">
        <Group title={t('Уведомления')}>
          <div className="s2-matrix" role="table">
            <div className="s2-mx-head" role="row">
              <span></span>
              {notifyLevels().map(([v, label]) => (
                <span key={v} role="columnheader" className="s2-mx-col">
                  {label}
                </span>
              ))}
            </div>
            {notifyRows().map(([kind, label]) => (
              <div className="s2-mx-row" role="row" key={kind}>
                <span className="s2-mx-lab">{label}</span>
                {notifyLevels().map(([v, seg]) => (
                  <span key={v} className="s2-mx-cell">
                    <button
                      role="radio"
                      aria-checked={notifyLv[kind] === v}
                      aria-label={label + ': ' + seg}
                      data-nosound
                      className={'s2-dot' + (notifyLv[kind] === v ? ' on' : '') + (v === 'off' ? ' off' : '')}
                      onClick={() => {
                        setNotifyLv((prev) => ({ ...prev, [kind]: v }))
                        setNotifyLevel(kind, v)
                        if (v === 'sound') playSound('notify')
                      }}
                    ></button>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Group>
      </Block>
      <Group>
        <Row title={t('Карточки поверх всех окон')} hint={t('Даже когда лаунчер свёрнут')} keys="уведомления рабочий стол">
          <Toggle
            label={t('Карточки поверх всех окон')}
            on={overlay.toasts}
            onChange={() => {
              const next = !overlay.toasts
              setOverlay({ ...overlay, toasts: next })
              setDesktopToasts(next).catch((err) => {
                console.error('[settings] desktop toasts', err)
                setOverlay({ ...overlay, toasts: !next })
                showToast(t('Не получилось — попробуй ещё раз'), 'error', false)
              })
            }}
          />
        </Row>
        <Row title={t('Напоминать о серии')} hint={t('Вечером, если сундук не забран')} keys="серия сундук бонус напоминание уведомления">
          <Toggle
            label={t('Напоминать о серии')}
            on={streakRemind}
            onChange={() => {
              const next = !streakRemind
              setStreakRemindOn(next)
              setStreakRemind(next)
            }}
          />
        </Row>
        <Row title={t('Сколько висит карточка')} keys="время уведомления секунды">
          <Segs<number>
            value={overlay.cardMs}
            options={CARD_TTL_CHOICES.map((ms) => [ms, t('{n} с', { n: ms / 1000 })] as [number, string])}
            onPick={(ms) => {
              const prev = overlay.cardMs
              setOverlay({ ...overlay, cardMs: ms })
              overlaySetCardMs(ms).catch((err) => {
                console.error('[settings] card ttl', err)
                setOverlay({ ...overlay, cardMs: prev })
                showToast(t('Не сохранилось'), 'error', false)
              })
            }}
          />
        </Row>
      </Group>

      <Block keys="микрофон наушники динамики устройства звонок шумоподавление громкость голоса">
        <Group title={t('Микрофон и наушники')}>
          <AudioSettings />
        </Group>
      </Block>
    </>
  )

  // Общий пресет: выбор мгновенный, ставится в каждую сборку без своего перед её запуском.
  const graphics = (
    <Block keys="графика пресет fps фпс картошка низкие стандарт высокие эпические шейдеры дальность прорисовки лаги видеокарта">
      <Group title={t('Для всех сборок')}>
        <GlobalPresetPicker
          value={gfx}
          onPick={(c) => {
            setGfx(c)
            setGlobalChoice(c)
          }}
        />
      </Group>
    </Block>
  )

  const game = (
    <>
      <Group title={t('Скин')}>
        <Row title={t('Откуда брать скин')} keys="скины плащи лицензия millida mojang">
          <Segs<SkinSource>
            value={skins}
            options={[
              ['millida', 'Millida'],
              ['mojang', t('Лицензия')],
            ]}
            onPick={(v) => {
              // Без лицензии Mojang скин брать неоткуда: в игре остаётся
              // Стив, и по этому пути игрок уже приходил в поддержку.
              if (v === 'mojang' && (!acc || acc.kind !== 'microsoft')) {
                showToast(t('Скин из лицензии — только с аккаунтом Microsoft'), 'error')
                return
              }
              setSkins(v)
              setSkinSource(v)
            }}
          />
        </Row>
        <Row title={t('Мод Millida')} hint={t('Скины, плащи и эмоции в игре')} keys="мод эмоции плащи">
          <Toggle
            id="setMillidaMod"
            label={t('Мод Millida')}
            on={modOn}
            onChange={() => {
              const next = !modOn
              setModOn(next)
              setMillidaModEnabled(next)
                .then(() => showToast(next ? t('Мод вернётся при следующем запуске сборки') : t('Мод убран из сборок')))
                .catch((err) => {
                  console.error('[settings] millida mod', err)
                  setModOn(!next)
                  showToast(t('Не получилось — попробуй ещё раз'), 'error')
                })
            }}
          />
        </Row>
      </Group>

      <Group title={t('Во время игры')}>
        {/* Память — у каждой сборки своя: из настроек ведём в параметры выбранной сборки. */}
        <Row title={t('Память (RAM)')} hint={t('У каждой сборки своя')} keys="memory ram озу оперативная память выделить гигабайт java heap">
          <button
            className="btn sm secondary"
            data-track="settings_memory"
            disabled={!memProfiles.length}
            onClick={() => {
              const pick = memPicked && memPicked.kind === 'build' ? memProfiles.find((p) => p.name === memPicked.name) : null
              openBuildSettings((pick ?? memProfiles[0]).name, 'opts')
            }}
          >
            {t('Настроить')}
          </button>
        </Row>
        <Row title={t('Лаунчер при запуске игры')} keys="окно свернуть трей оставить">
          <Segs<LaunchWindowMode>
            value={winMode}
            options={[
              ['none', t('Оставить')],
              ['minimize', t('Свернуть')],
              ...(tray ? [['tray', t('В трей')] as [LaunchWindowMode, string]] : []),
            ]}
            onPick={(mode) => {
              setWinMode(mode)
              setLaunchWindowMode(mode)
            }}
          />
        </Row>
        <Row title={t('Вернуть лаунчер после игры')} keys="окно развернуть">
          <Toggle
            label={t('Вернуть лаунчер после игры')}
            on={backAfterGame}
            onChange={() => {
              const next = !backAfterGame
              setBackAfterGame(next)
              setRestoreOnGameExit(next)
            }}
          />
        </Row>
        <Row title={t('Чат друзей поверх игры')} hint={<kbd className="s2-kbd">{overlay.hotkey}</kbd>} keys="оверлей горячая клавиша">
          <Toggle
            id="setOverlay"
            label={t('Чат друзей поверх игры')}
            on={overlay.enabled}
            onChange={() => {
              const next = !overlay.enabled
              setOverlay({ ...overlay, enabled: next })
              overlaySetEnabled(next).catch((err) => {
                console.error('[settings] overlay', err)
                setOverlay({ ...overlay, enabled: !next })
                showToast(t('Оверлей не включился'), 'error')
              })
            }}
          />
        </Row>
        <Row title={t('Снапшоты в списке версий')} keys="версии тестовые снапшоты">
          <Toggle
            id="setSnapshots"
            label={t('Снапшоты в списке версий')}
            on={showSnapshots}
            onChange={() => useMcVersionList.getState().setShow(!showSnapshots)}
          />
        </Row>
      </Group>
    </>
  )

  const files = (
    <>
      <Group title={t('Папка игры')}>
        <Row title={t('Папка игры')} hint={moving ? t('Переносим — не закрывай лаунчер') : undefined} keys="директория путь сменить открыть">
          <button className="btn sm secondary" onClick={() => openGameFolder()} disabled={moving}>
            {t('Открыть')}
          </button>
          <button className="btn sm secondary" onClick={() => void changeDir()} disabled={moving}>
            {moving ? t('Переносим…') : t('Сменить')}
          </button>
        </Row>
        <Row title={t('Кэш')} hint={cacheMb === null ? undefined : t('{n} МБ', { n: cacheMb })} keys="временные файлы очистить место">
          <button
            className="btn sm secondary"
            disabled={clearing || !cacheMb}
            onClick={async () => {
              if (onlyApp(t('Очистка кэша'))) return
              if (
                !(await uiConfirm(t('Очистить кэш и временные файлы? Сборки, миры и версии не тронем.'), {
                  confirmLabel: t('Очистить'),
                  danger: false,
                }))
              )
                return
              setClearing(true)
              clearCache()
                .then((freed) => {
                  showToast(t('Освобождено {n} МБ', { n: Math.round(freed / 1024 / 1024) }))
                  setCacheMb(0)
                })
                .catch((e) => {
                  console.error('[settings] cache', e)
                  showToast(t('Не удалось очистить'), 'error')
                })
                .finally(() => setClearing(false))
            }}
          >
            {clearing ? t('Чистим…') : t('Очистить')}
          </button>
        </Row>
        <BackupsFolderRow />
        <Block keys="общее хранилище моды дубли место">
          <SharedStore />
        </Block>
      </Group>

      <Group title="Java">
        <Row title={t('Java для всех сборок')} hint={javaDef ? javaDef.version : t('Сама под каждую сборку')} keys="java джава путь авто">
          <button
            className="btn sm secondary"
            onClick={() => {
              if (onlyApp(t('Выбор Java'))) return
              pickJavaPath()
                .then((j) => {
                  if (!j) return
                  return setDefaultJava(j.path).then(() => {
                    setJavaDef(j)
                    showToast(t('Java для всех сборок: {version}', { version: j.version }))
                  })
                })
                .catch((e) => {
                  trackFailure('settings', e, { step: 'java_pick' })
                  showToast(apiErrorText(e, t('Не получилось — попробуй ещё раз')), 'error')
                })
            }}
          >
            {t('Указать')}
          </button>
          {javaDef ? (
            <button
              className="btn sm ghost"
              onClick={() => {
                setDefaultJava(null)
                  .then(() => {
                    setJavaDef(null)
                    showToast(t('Java снова выбирается сама'))
                  })
                  .catch((e) => {
                    trackFailure('settings', e, { step: 'java_reset' })
                    showToast(apiErrorText(e, t('Не получилось — попробуй ещё раз')), 'error')
                  })
              }}
            >
              {t('Сбросить')}
            </button>
          ) : null}
        </Row>
        <Row title={t('Скачать Java')} hint={javaBusy ? t('Качаем Java {n}…', { n: javaBusy }) : undefined} keys="java установить">
          <Select
            value={String(javaWant)}
            options={majors.map((m) => ({ value: String(m), label: 'Java ' + m }))}
            onChange={(v) => setJavaWant(Number(v))}
            width={120}
          />
          <button
            className="btn sm secondary"
            disabled={!!javaBusy}
            onClick={() => {
              if (onlyApp(t('Скачивание Java'))) return
              setJavaBusy(javaWant)
              downloadJavaRuntime(javaWant)
                .then((v) => {
                  showToast(t('Java готова: {version}', { version: v }))
                  void listJavaRuntimes().then(setJavas).catch(() => {})
                })
                .catch((e) => {
                  trackFailure('settings', e, { step: 'java_download', major: javaWant })
                  showToast(apiErrorText(e, t('Не получилось — попробуй ещё раз')), 'error')
                })
                .finally(() => setJavaBusy(0))
            }}
          >
            {javaBusy ? <span className="spin"></span> : null}
            {javaBusy ? t('Качаем…') : t('Скачать')}
          </button>
        </Row>
        {javas.map((j) => (
          <Row
            key={j.major}
            title={'Java ' + j.major}
            hint={(j.in_use ? t('{n} МБ · нужна сборкам', { n: Math.round(j.size / 1024 / 1024) }) : t('{n} МБ · не используется', { n: Math.round(j.size / 1024 / 1024) }))}
            keys="java установленная удалить"
          >
            <button
              className="btn sm ghost"
              aria-label={t('Удалить Java {n}', { n: j.major })}
              onClick={async () => {
                const question = j.in_use
                  ? t('Удалить Java {n}? Она нужна установленным сборкам — лаунчер скачает её заново при их запуске.', { n: j.major })
                  : t('Удалить Java {n}? Если понадобится, лаунчер скачает её сам.', { n: j.major })
                if (
                  !(await uiConfirm(question, {
                    confirmLabel: t('Удалить'),
                    danger: true,
                  }))
                )
                  return
                removeJavaRuntime(j.major)
                  .then((freed) => {
                    showToast(t('Освобождено {n} МБ', { n: Math.round(freed / 1024 / 1024) }))
                    void listJavaRuntimes().then(setJavas).catch(() => {})
                  })
                  .catch((e) => {
                    console.error('[settings] java remove', e)
                    showToast(apiErrorText(e, t('Не удалось удалить')), 'error')
                  })
              }}
            >
              <Icon id="i-trash" />
            </button>
          </Row>
        ))}
      </Group>

      <Block keys="облако облачный профиль синхронизация сборки выгрузить забрать">
        <Group title={t('Облако')}>
          <CloudSync />
        </Group>
      </Block>
    </>
  )

  const account = (
    <>
      {millidaAcc ? (
        <Group>
          <Row title={t('Баланс')} hint={balanceText() ?? '—'} keys="кошелёк деньги пополнить рубли">
            <button
              className="btn sm secondary"
              onClick={() => {
                track('store_open', { where: 'wallet_topup' })
                openTopup()
              }}
            >
              {t('Пополнить')}
            </button>
          </Row>
        </Group>
      ) : null}

      <Group title={t('Видно в профиле на millida.net')}>
        {!hasMillida ? (
          <Row title={t('Нужен аккаунт Millida')} keys="приватность профиль видно">
            <button className="btn sm primary" onClick={() => logoutToLogin()}>
              <Icon id="i-login" /> {t('Войти')}
            </button>
          </Row>
        ) : (
          privacyRows().filter((r) => !r.feature || marketOffers(market, r.feature)).map((r) => (
            <Row key={r.key} title={r.title} keys="приватность профиль видно скрыть">
              {!privacy.loaded && privacy.loading ? (
                <span className="skel" style={{ width: '42px', height: '24px' }}></span>
              ) : (
                <Toggle
                  label={r.title}
                  on={!!privacy.settings[r.key]}
                  busy={privacy.saving === r.key}
                  onChange={() => togglePrivacy(r.key)}
                />
              )}
            </Row>
          ))
        )}
        {privacy.error ? (
          <Row title={t('Не загрузилось')} keys="приватность ошибка">
            <span data-err={privacy.error} hidden></span>
            <button className="btn sm secondary" onClick={() => void loadPrivacy(true)}>
              <Icon id="i-restart" /> {t('Повторить')}
            </button>
          </Row>
        ) : null}
      </Group>

      {hasMillida ? (
        <Group title={t('Эмоции вдвоём')}>
          <Row title={t('Кто может звать')} keys="эмоции вдвоём приглашение приватность друзья">
            {!privacy.loaded && privacy.loading ? (
              <span className="skel" style={{ width: '180px', height: '28px' }}></span>
            ) : (
              <Segs<DuoInvites> value={privacy.settings.duoInvites} options={DUO_INVITE_OPTIONS.map(([v, label]) => [v, t(label)] as [DuoInvites, string])} onPick={pickDuoInvites} />
            )}
          </Row>
        </Group>
      ) : null}

      <Group title={t('Снаружи')}>
        <Row title={t('Активность в Discord')} keys="дискорд статус rich presence приватность">
          <Toggle
            label={t('Активность в Discord')}
            on={discord}
            onChange={() => {
              const next = !discord
              setDiscord(next)
              localStorage.setItem('m-discord', next ? '1' : '0')
              if (next) void discordPresence('lobby')
              else discordClear().catch(() => {})
            }}
          />
        </Row>
        <Row title={t('Статистика использования')} hint={t('Версия, железо, вылеты, клики. Без паролей и файлов')} keys="телеметрия данные приватность анонимная статистика">
          <Toggle
            id="setTelemetry"
            label={t('Статистика использования')}
            on={telemetryOn}
            onChange={() => {
              const next = !telemetryOn
              setTelemetryOn(next)
              setTelemetryEnabled(next)
            }}
          />
        </Row>
      </Group>
    </>
  )

  const about = (
    <>
      <Block keys="версия обновление обновить проверить">
        <div className="s2-hero">
          <img src="/millida-logo.svg" alt="" width={48} height={48} />
          <span className="s2-hero-txt">
            <b>Millida Launcher</b>
            <small>
              {upd
                ? updStaged
                  ? t('Обновление {version} встанет при выходе', { version: upd.version })
                  : t('Доступна {version}', { version: upd.version })
                : ver
                  ? t('Версия {version}', { version: ver })
                  : t('Версия приложения')}
            </small>
          </span>
          {upd ? (
            <button
              className="btn md primary"
              disabled={updBusy}
              onClick={() => {
                setUpdBusy(true)
                upd.install().catch((e) => {
                  console.error('[settings] update', e)
                  setUpdBusy(false)
                  showToast(t('Не удалось обновиться'), 'error')
                })
              }}
            >
              <Icon id="i-restart" /> {updBusy ? t('Обновляем…') : t('Обновить')}
            </button>
          ) : (
            <button
              className="btn md secondary"
              disabled={updBusy}
              onClick={() => {
                setUpdBusy(true)
                void checkForUpdate(true)
                  .then((u) => {
                    setUpd(u)
                    if (!u) showToast(t('Стоит последняя версия'))
                  })
                  .finally(() => setUpdBusy(false))
              }}
            >
              {updBusy ? <span className="spin"></span> : <Icon id="i-restart" />} {t('Проверить')}
            </button>
          )}
        </div>
      </Block>

      <Group>
        {/* Не верят, что лаунчер собран из открытого кода: ссылка на релиз именно этой версии на GitHub, там файлы, отпечатки и свидетельство сборки. */}
        <Row title={t('Собран на GitHub')} hint={ver ? 'v' + ver : undefined} keys="github исходный код открытый безопасность вирус проверить сборка">
          <button
            className="btn md secondary"
            onClick={() => void openUrl('https://github.com/millida/launcher/releases' + (ver ? '/tag/v' + ver : '')).catch(() => {})}
          >
            {t('Открыть')}
          </button>
        </Row>
        <Row title={t('Новости Minecraft')} keys="новости minecraft mojang обновления игры снапшоты">
          <button className="btn md secondary" onClick={openMcNews}>
            {t('Открыть')}
          </button>
        </Row>
        <Row title={t('Тестовые версии')} hint={beta ? t('Раньше всех, бывают поломки') : undefined} keys="бета тестирование обновления раньше">
          <Toggle
            label={t('Тестовые версии')}
            on={beta}
            onChange={() => {
              const next = !beta
              setBeta(next)
              writePref('m-beta', next ? '1' : '0')
            }}
          />
        </Row>
        <Row title={t('Запускать вместе с системой')} hint={t('Сразу в трей')} keys="автозапуск автозагрузка система windows трей включение">
          <Toggle
            label={t('Запускать вместе с системой')}
            on={autostart}
            onChange={() => {
              const next = !autostart
              setAutostartOn(next)
              if (!hasTauri()) return
              setAutostart(next)
                .then(setAutostartOn)
                .catch((err) => {
                  console.error('[settings] autostart', err)
                  setAutostartOn(!next)
                  showToast(t('Система не дала — попробуй ещё раз'), 'error', false)
                })
            }}
          />
        </Row>
        <Row title={t('Крестик прячет в трей')} hint={tray ? undefined : t('Трей недоступен в этой системе')} keys="трей закрывать окно свернуть">
          <Toggle
            label={t('Крестик прячет в трей')}
            on={trayClose}
            disabled={!tray}
            onChange={() => {
              if (!tray) {
                showToast(t('Трей недоступен в этой системе'), 'error')
                return
              }
              const next = !trayClose
              setTrayCloseOn(next)
              setTrayClose(next)
            }}
          />
        </Row>
        <Row title={t('Гайд по лаунчеру')} keys="обучение тур подсказки помощь">
          <button className="btn sm secondary" onClick={startTour}>
            {t('Показать')}
          </button>
        </Row>
        <Row
          title={t('Отчёт для поддержки')}
          hint={diagText ? t('Скопировано — вставь в чат поддержки') : undefined}
          keys="диагностика данные поддержка ошибка логи помощь"
        >
          <button
            className="btn sm secondary"
            disabled={diagBusy}
            onClick={() => {
              setDiagBusy(true)
              buildDiagnostics()
                .then(async (text) => {
                  setDiagText(text)
                  const ok = await copyText(text)
                  showToast(ok ? t('Отчёт скопирован') : t('Не скопировалось — выдели текст ниже'), ok ? 'ok' : 'error')
                  if (!ok) setDiagOpen(true)
                })
                .catch((e) => {
                  console.error('[settings] diag', e)
                  showToast(t('Отчёт не собрался'), 'error')
                })
                .finally(() => setDiagBusy(false))
            }}
          >
            {diagBusy ? t('Собираем…') : t('Копировать')}
          </button>
          {diagText ? (
            <button className="btn sm ghost" onClick={() => setDiagOpen((o) => !o)}>
              {diagOpen ? t('Скрыть') : t('Текст')}
            </button>
          ) : null}
        </Row>
        {diagText && diagOpen ? (
          <textarea className="s2-diag" readOnly value={diagText} onFocus={(e) => e.currentTarget.select()} />
        ) : null}
      </Group>
    </>
  )

  const views: Record<SecId, ReactNode> = { look, graphics, sound, game, clips: <RewindClips />, files, account, about }
  const q = query.trim()

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-settings">
      <div className="s2">
        <div className="s2-head">
          <h1 className="s2-title">{t('Настройки')}</h1>
          <label className="input sm s2-search">
            <Icon id="i-search" />
            <input
              value={query}
              placeholder={t('Найти')}
              aria-label={t('Найти настройку')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
            />
            {query ? (
              <button className="s2-search-x" aria-label={t('Очистить поиск')} onClick={() => setQuery('')}>
                <Icon id="i-x" />
              </button>
            ) : null}
          </label>
        </div>
        <nav className="set-tabs s2-tabs" role="tablist" aria-label={t('Разделы настроек')}>
          {sections().map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={!q && sec === s.id}
              className={'set-tab' + (!q && sec === s.id ? ' on' : '')}
              onClick={() => {
                // Новая вкладка — с начала: иначе страница прыгала на
                // прокрутку прошлой вкладки (владелец: «настройки дёрганые»).
                document.querySelector('.content')?.scrollTo({ top: 0 })
                setSec(s.id)
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <Query.Provider value={q}>
          <div className="s2-body">
            {q ? (
              <>
                {sections().map((s) => (
                  <div className="s2-found" key={s.id}>
                    <button className="s2-found-sec" onClick={() => setSec(s.id)}>
                      {s.label}
                      <Icon id="i-chev-r" />
                    </button>
                    {views[s.id]}
                  </div>
                ))}
                <div className="s2-empty">
                  <Icon id="i-search" />
                  <b>{t('Ничего не нашлось')}</b>
                </div>
              </>
            ) : (
              views[sec]
            )}
          </div>
        </Query.Provider>
      </div>
    </section>
  )
}

/** Музыка лобби вкл/выкл — переехала из лобби (правка владельца 23.09.2026). */
function MusicNow() {
  const t = useT()
  const on = useMusic((s) => radioOn(s))
  const toggle = useMusic((s) => s.toggleRadio)
  return <Toggle label={t('Музыка сейчас')} on={on} onChange={() => toggle()} />
}
