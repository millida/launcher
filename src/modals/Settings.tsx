import { useEffect, useState } from 'react'
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
  overlaySetCardMs,
  overlaySetEnabled,
  overlayState,
  pickGameDir,
  pickJavaPath,
  removeJavaRuntime,
  setDefaultJava,
  setGameDir,
} from '../ipc/commands'
import { useMcVersionList } from '../state/mcVersionList'
import { refreshProfiles } from '../state/profiles'
import type { JavaInfo, JavaRuntime, OverlayState } from '../ipc/commands'
import { CARD_TTL_CHOICES, CARD_TTL_MS } from '../lib/overlayCards'
import { apiErrorText } from '../lib/apiError'
import { Icon } from '../components/Icon'
import { Block, Group, Query, Row, Segs, Toggle } from '../components/SetKit'
import { CloudSync } from '../components/CloudSync'
import { SharedStore } from '../components/SharedStore'
import { uiConfirm } from '../state/confirm'
import { ColorPicker } from '../components/ColorPicker'
import { AudioSettings } from '../components/AudioSettings'
import { RadioCredits, RadioVolume } from '../components/radio'
import { betaChannel, checkForUpdate, pendingUpdate } from '../lib/updater'
import { openWhatsNew } from '../state/whatsNew'
import { useUpdate } from '../state/update'
import { discordPresence } from '../lib/launch'
import { radioOn, useMusic } from '../state/music'
import { fetchSounds, playSound, setSoundMode, soundMode, soundVolume } from '../lib/sound'
import type { SoundMode } from '../lib/sound'
import { notifyLevel, setNotifyLevel } from '../state/notifyPrefs'
import { setDesktopToasts } from '../lib/desktopToast'
import type { NotifyKind, NotifyLevel } from '../state/notifyPrefs'
import { Slider } from '../components/Slider'
import { Select } from '../components/Select'
import { writePref } from '../lib/prefs'
import { setMusicAutostart } from '../state/music'
import { setTelemetryEnabled, telemetryEnabled, track, trackFailure } from '../lib/telemetry'
import { getAccount, getMillidaAccount, useAccounts } from '../state/accounts'
import { WALLET_URL, openExt } from '../lib/api'
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
import { logoutToLogin } from '../lib/session'
import { accentFromHex, computeAccent, paintAccent, saveAccent, withColorFade } from '../lib/accent'
import type { Accent } from '../lib/accent'
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

const ACCENTS: (Accent & { name: string })[] = [
  { id: 'green', name: 'Зелёный', c: '#5EC64D', h: '#70D55F', s: 'rgba(94,198,77,.13)' },
  { id: 'lime', name: 'Лайм', c: '#9BD628', h: '#ACE23F', s: 'rgba(155,214,40,.14)' },
  { id: 'teal', name: 'Бирюзовый', c: '#22C7A9', h: '#3ADBBD', s: 'rgba(34,199,169,.14)' },
  { id: 'cyan', name: 'Голубой', c: '#2CB6E8', h: '#48C6F2', s: 'rgba(44,182,232,.14)' },
  { id: 'blue', name: 'Синий', c: '#4C8DFF', h: '#639BFF', s: 'rgba(76,141,255,.14)' },
  { id: 'indigo', name: 'Индиго', c: '#6C6BFF', h: '#8180FF', s: 'rgba(108,107,255,.14)' },
  { id: 'purple', name: 'Фиолетовый', c: '#9B6BFF', h: '#AC80FF', s: 'rgba(155,107,255,.14)' },
  { id: 'pink', name: 'Розовый', c: '#FF6BAA', h: '#FF80B8', s: 'rgba(255,107,170,.14)' },
  { id: 'red', name: 'Красный', c: '#FF6B5E', h: '#FF8073', s: 'rgba(255,107,94,.14)' },
  { id: 'orange', name: 'Оранжевый', c: '#F5923B', h: '#FFA24F', s: 'rgba(245,146,59,.14)' },
  { id: 'yellow', name: 'Жёлтый', c: '#F5C93B', h: '#FFD65A', s: 'rgba(245,201,59,.14)' },
  // Больше готовых цветов (правка владельца 23.09.2026): «лучше больше цветов».
  ...(
    [
      ['emerald', 'Изумрудный', '#2BB673'],
      ['mint', 'Мятный', '#5FE0B0'],
      ['sky', 'Небесный', '#6FC3FF'],
      ['azure', 'Лазурный', '#3A6FE0'],
      ['lavender', 'Лавандовый', '#B79CFF'],
      ['magenta', 'Малиновый', '#E8457A'],
      ['coral', 'Коралловый', '#FF8A65'],
      ['amber', 'Янтарный', '#FFB020'],
      ['sand', 'Песочный', '#D8B26E'],
      ['silver', 'Серебряный', '#BFC7CF'],
    ] as const
  ).map(([id, name, hex]) => ({ ...accentFromHex(hex), id, name })),
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

type SecId = 'look' | 'sound' | 'game' | 'files' | 'account' | 'about'

const SECTIONS: { id: SecId; label: string }[] = [
  { id: 'look', label: 'Вид' },
  { id: 'sound', label: 'Звук' },
  { id: 'game', label: 'Игра' },
  { id: 'files', label: 'Файлы' },
  { id: 'account', label: 'Аккаунт' },
  { id: 'about', label: 'Лаунчер' },
]

/// Старые адреса вкладок (openSettings('notify') и сохранённый m-set-tab)
/// ведут туда, куда переехало их содержимое.
const MOVED: Record<string, SecId> = { window: 'game', notify: 'sound', privacy: 'account' }

function toSec(v: string | null | undefined): SecId | null {
  if (!v) return null
  if (MOVED[v]) return MOVED[v]
  return SECTIONS.some((s) => s.id === v) ? (v as SecId) : null
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
const PRIVACY_ROWS: { key: keyof PrivacySettings; title: string }[] = [
  { key: 'showActivity', title: 'Игровая активность' },
  { key: 'showServers', title: 'Серверы' },
  { key: 'showPlaytime', title: 'Часы в игре' },
  { key: 'showFriends', title: 'Список друзей' },
  { key: 'showAchievements', title: 'Достижения' },
  { key: 'showMarket', title: 'Маркет' },
]

const NOTIFY_ROWS: [NotifyKind, string][] = [
  ['msg', 'Личные сообщения'],
  ['room', 'Сообщения в группах'],
  ['play', 'Друг зашёл в игру'],
  ['online', 'Друг в сети'],
  ['request', 'Заявки в друзья'],
]

const NOTIFY_LEVELS: [NotifyLevel, string][] = [
  ['sound', 'Со звуком'],
  ['silent', 'Без звука'],
  ['off', 'Выкл'],
]

export function Settings({ on }: { on: boolean }) {
  const [sec, setSecState] = useState<SecId>(initialSec)
  const [query, setQuery] = useState('')
  const wantTab = useUi((s) => s.settingsTab)
  const takeSettingsTab = useUi((s) => s.takeSettingsTab)
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
  const [beta, setBeta] = useState(betaChannel)
  const updStaged = useUpdate((s) => s.staged)
  const [skins, setSkins] = useState<SkinSource>(skinSource)
  const charAnim = useViewPrefs((s) => s.charAnim)
  const bgAnim = useViewPrefs((s) => s.bgAnim)
  const tabMs = useViewPrefs((s) => s.tabMs)
  const perf = useViewPrefs((s) => s.perf)
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

  const togglePrivacy = (key: keyof PrivacySettings) => {
    const next = !privacy.settings[key]
    const row = PRIVACY_ROWS.find((r) => r.key === key)
    privacy
      .patch({ [key]: next } as Partial<PrivacySettings>)
      .then(() => showToast((row ? row.title : 'Настройка') + (next ? ' — видно всем' : ' — скрыто')))
      .catch(() => showToast('Не удалось сохранить настройку приватности', 'error'))
  }

  const onlyApp = (what: string) => {
    if (hasTauri()) return false
    showToast(what + ' — в приложении лаунчера', 'error')
    return true
  }

  // Смена папки без переноса файлов означала «сделай все сборки заново»:
  // спрашиваем и по умолчанию переносим уже скачанное.
  const changeDir = async () => {
    if (onlyApp('Смена папки')) return
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
      console.error('[settings] game dir', e)
      showToast('Папка не сменилась', 'error')
    } finally {
      setMoving(false)
    }
  }


  /* ================= Вкладки ================= */

  const look = (
    <>
      <Block keys="цвет кнопок акцент цвет выделения палитра">
        <Group title="Цвет кнопок">
          <div className="s2-swatches" id="accentSwatches" role="radiogroup" aria-label="Цвет кнопок">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={a.id === accent}
                data-acc={a.id}
                aria-label={a.name}
                className={'s2-sw' + (a.id === accent ? ' on' : '')}
                style={{ background: a.c }}
                onClick={() => {
                  withColorFade(() => applyAccent(a))
                  setAccent(a.id)
                }}
              ></button>
            ))}
            <span className="s2-sw-wrap">
              <button
                aria-label="Свой цвет"
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
      </Block>

      <Block keys="анимация движение персонаж танцует фон переход между вкладками скорость плавность оптимизация качество слабый пк производительность лаги fps">
        <Group title="Анимация">
          <Row title="Оптимизация" keys="оптимизация качество слабый пк производительность лаги fps плавность">
            <Segs<PerfMode>
              value={perf}
              options={[
                ['auto', 'Авто'],
                ['high', 'Полное'],
                ['low', 'Слабый ПК'],
              ]}
              onPick={(v) => useViewPrefs.getState().setPerf(v)}
            />
          </Row>
          <Row title="Персонаж танцует" keys="персонаж анимация танец движение">
            <Toggle label="Персонаж танцует" on={charAnim} onChange={() => useViewPrefs.getState().setCharAnim(!charAnim)} />
          </Row>
          <Row title="Живой фон" keys="фон анимация сцена лобби волна искры">
            <Toggle label="Живой фон" on={bgAnim} onChange={() => useViewPrefs.getState().setBgAnim(!bgAnim)} />
          </Row>
          <Row title="Переход между вкладками" keys="переход вкладки скорость длительность плавность анимация">
            <Segs<number>
              value={tabMs}
              options={[
                [0, 'Выкл'],
                [190, 'Быстро'],
                [TAB_MS_DEFAULT, 'Обычно'],
                [640, 'Медленно'],
              ]}
              onPick={(v) => useViewPrefs.getState().setTabMs(v)}
            />
          </Row>
        </Group>
      </Block>
    </>
  )

  const sound = (
    <>
      <Group title="Музыка">
        <Row title="Музыка сейчас" keys="музыка радио включить выключить">
          <MusicNow />
        </Row>
        <Row title="Музыка при запуске" keys="мелодия фоновая">
          <Toggle
            label="Музыка при запуске"
            on={musicAuto}
            onChange={() => {
              const next = !musicAuto
              setMusicAuto(next)
              setMusicAutostart(next)
            }}
          />
        </Row>
        <Row title="Громкость радио" keys="музыка радио громкость">
          <RadioVolume />
        </Row>
        <RadioCredits />
      </Group>

      <Group title="Звуки">
        <Row title="Звуки Minecraft" keys="звуки интерфейса клики тишина">
          <Segs<SoundMode>
            value={soundMd}
            options={[
              ['off', 'Выкл'],
              ['notify', 'Уведомления'],
              ['all', 'Все'],
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
          <Row title="Громкость звуков" keys="громкость">
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
              <button className="btn sm ghost" data-nosound aria-label="Проверить звук" onClick={() => playSound('achievement')}>
                <Icon id="i-play" />
              </button>
              <button
                className="btn sm ghost"
                disabled={soundBusy}
                aria-label="Скачать звуки из игры заново"
                data-tip="Скачать звуки из игры заново"
                onClick={() => {
                  setSoundBusy(true)
                  fetchSounds()
                    .then((n) =>
                      showToast(n ? 'Звуков из игры: ' + n : 'Не удалось скачать звуки', n ? 'ok' : 'error', false),
                    )
                    .catch((e) => {
                      console.error('[settings] sounds', e)
                      showToast('Звуки не скачались', 'error', false)
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
        <Group title="Уведомления">
          <div className="s2-matrix" role="table">
            <div className="s2-mx-head" role="row">
              <span></span>
              {NOTIFY_LEVELS.map(([v, label]) => (
                <span key={v} role="columnheader" className="s2-mx-col">
                  {label}
                </span>
              ))}
            </div>
            {NOTIFY_ROWS.map(([kind, label]) => (
              <div className="s2-mx-row" role="row" key={kind}>
                <span className="s2-mx-lab">{label}</span>
                {NOTIFY_LEVELS.map(([v, seg]) => (
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
        <Row title="Карточки поверх всех окон" hint="Даже когда лаунчер свёрнут" keys="уведомления рабочий стол">
          <Toggle
            label="Карточки поверх всех окон"
            on={overlay.toasts}
            onChange={() => {
              const next = !overlay.toasts
              setOverlay({ ...overlay, toasts: next })
              setDesktopToasts(next).catch((err) => {
                console.error('[settings] desktop toasts', err)
                setOverlay({ ...overlay, toasts: !next })
                showToast('Не получилось — попробуй ещё раз', 'error', false)
              })
            }}
          />
        </Row>
        <Row title="Сколько висит карточка" keys="время уведомления секунды">
          <Segs<number>
            value={overlay.cardMs}
            options={CARD_TTL_CHOICES.map((ms) => [ms, ms / 1000 + ' с'] as [number, string])}
            onPick={(ms) => {
              const prev = overlay.cardMs
              setOverlay({ ...overlay, cardMs: ms })
              overlaySetCardMs(ms).catch((err) => {
                console.error('[settings] card ttl', err)
                setOverlay({ ...overlay, cardMs: prev })
                showToast('Не сохранилось', 'error', false)
              })
            }}
          />
        </Row>
      </Group>

      <Block keys="микрофон наушники динамики устройства звонок шумоподавление громкость голоса">
        <Group title="Микрофон и наушники">
          <AudioSettings />
        </Group>
      </Block>
    </>
  )

  const game = (
    <>
      <Group title="Скин">
        <Row title="Откуда брать скин" keys="скины плащи лицензия millida mojang">
          <Segs<SkinSource>
            value={skins}
            options={[
              ['millida', 'Millida'],
              ['mojang', 'Лицензия'],
            ]}
            onPick={(v) => {
              // Без лицензии Mojang скин брать неоткуда: в игре остаётся
              // Стив, и по этому пути игрок уже приходил в поддержку.
              if (v === 'mojang' && (!acc || acc.kind !== 'microsoft')) {
                showToast('Скин из лицензии — только с аккаунтом Microsoft', 'error')
                return
              }
              setSkins(v)
              setSkinSource(v)
            }}
          />
        </Row>
        <Row title="Мод Millida" hint="Скины, плащи и эмоции в игре" keys="мод эмоции плащи">
          <Toggle
            id="setMillidaMod"
            label="Мод Millida"
            on={modOn}
            onChange={() => {
              const next = !modOn
              setModOn(next)
              setMillidaModEnabled(next)
                .then(() => showToast(next ? 'Мод вернётся при следующем запуске сборки' : 'Мод убран из сборок'))
                .catch((err) => {
                  console.error('[settings] millida mod', err)
                  setModOn(!next)
                  showToast('Не получилось — попробуй ещё раз', 'error')
                })
            }}
          />
        </Row>
      </Group>

      <Group title="Во время игры">
        <Row title="Лаунчер при запуске игры" keys="окно свернуть трей оставить">
          <Segs<LaunchWindowMode>
            value={winMode}
            options={[
              ['none', 'Оставить'],
              ['minimize', 'Свернуть'],
              ...(tray ? [['tray', 'В трей'] as [LaunchWindowMode, string]] : []),
            ]}
            onPick={(mode) => {
              setWinMode(mode)
              setLaunchWindowMode(mode)
            }}
          />
        </Row>
        <Row title="Вернуть лаунчер после игры" keys="окно развернуть">
          <Toggle
            label="Вернуть лаунчер после игры"
            on={backAfterGame}
            onChange={() => {
              const next = !backAfterGame
              setBackAfterGame(next)
              setRestoreOnGameExit(next)
            }}
          />
        </Row>
        <Row title="Чат друзей поверх игры" hint={<kbd className="s2-kbd">{overlay.hotkey}</kbd>} keys="оверлей горячая клавиша">
          <Toggle
            id="setOverlay"
            label="Чат друзей поверх игры"
            on={overlay.enabled}
            onChange={() => {
              const next = !overlay.enabled
              setOverlay({ ...overlay, enabled: next })
              overlaySetEnabled(next).catch((err) => {
                console.error('[settings] overlay', err)
                setOverlay({ ...overlay, enabled: !next })
                showToast('Оверлей не включился', 'error')
              })
            }}
          />
        </Row>
        <Row title="Снапшоты в списке версий" keys="версии тестовые снапшоты">
          <Toggle
            id="setSnapshots"
            label="Снапшоты в списке версий"
            on={showSnapshots}
            onChange={() => useMcVersionList.getState().setShow(!showSnapshots)}
          />
        </Row>
      </Group>
    </>
  )

  const files = (
    <>
      <Group title="Папка игры">
        <Row title="Папка игры" hint={moving ? 'Переносим — не закрывай лаунчер' : undefined} keys="директория путь сменить открыть">
          <button className="btn sm secondary" onClick={() => openGameFolder()} disabled={moving}>
            Открыть
          </button>
          <button className="btn sm secondary" onClick={() => void changeDir()} disabled={moving}>
            {moving ? 'Переносим…' : 'Сменить'}
          </button>
        </Row>
        <Row title="Кэш" hint={cacheMb === null ? undefined : cacheMb + ' МБ'} keys="временные файлы очистить место">
          <button
            className="btn sm secondary"
            disabled={clearing || !cacheMb}
            onClick={async () => {
              if (onlyApp('Очистка кэша')) return
              if (
                !(await uiConfirm('Очистить кэш и временные файлы? Сборки, миры и версии не тронем.', {
                  confirmLabel: 'Очистить',
                  danger: false,
                }))
              )
                return
              setClearing(true)
              clearCache()
                .then((freed) => {
                  showToast('Освобождено ' + Math.round(freed / 1024 / 1024) + ' МБ')
                  setCacheMb(0)
                })
                .catch((e) => {
                  console.error('[settings] cache', e)
                  showToast('Не удалось очистить', 'error')
                })
                .finally(() => setClearing(false))
            }}
          >
            {clearing ? 'Чистим…' : 'Очистить'}
          </button>
        </Row>
        <Block keys="общее хранилище моды дубли место">
          <SharedStore />
        </Block>
      </Group>

      <Group title="Java">
        <Row title="Java для всех сборок" hint={javaDef ? javaDef.version : 'Сама под каждую сборку'} keys="java джава путь авто">
          <button
            className="btn sm secondary"
            onClick={() => {
              if (onlyApp('Выбор Java')) return
              pickJavaPath()
                .then((j) => {
                  if (!j) return
                  return setDefaultJava(j.path).then(() => {
                    setJavaDef(j)
                    showToast('Java для всех сборок: ' + j.version)
                  })
                })
                .catch((e) => {
                  trackFailure('settings', e, { step: 'java_pick' })
                  showToast(apiErrorText(e, 'Не получилось — попробуй ещё раз'), 'error')
                })
            }}
          >
            Указать
          </button>
          {javaDef ? (
            <button
              className="btn sm ghost"
              onClick={() => {
                setDefaultJava(null)
                  .then(() => {
                    setJavaDef(null)
                    showToast('Java снова выбирается сама')
                  })
                  .catch((e) => {
                    trackFailure('settings', e, { step: 'java_reset' })
                    showToast(apiErrorText(e, 'Не получилось — попробуй ещё раз'), 'error')
                  })
              }}
            >
              Сбросить
            </button>
          ) : null}
        </Row>
        <Row title="Скачать Java" hint={javaBusy ? 'Качаем Java ' + javaBusy + '…' : undefined} keys="java установить">
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
              if (onlyApp('Скачивание Java')) return
              setJavaBusy(javaWant)
              downloadJavaRuntime(javaWant)
                .then((v) => {
                  showToast('Java готова: ' + v)
                  void listJavaRuntimes().then(setJavas).catch(() => {})
                })
                .catch((e) => {
                  trackFailure('settings', e, { step: 'java_download', major: javaWant })
                  showToast(apiErrorText(e, 'Не получилось — попробуй ещё раз'), 'error')
                })
                .finally(() => setJavaBusy(0))
            }}
          >
            {javaBusy ? <span className="spin"></span> : null}
            {javaBusy ? 'Качаем…' : 'Скачать'}
          </button>
        </Row>
        {javas.map((j) => (
          <Row
            key={j.major}
            title={'Java ' + j.major}
            hint={Math.round(j.size / 1024 / 1024) + ' МБ · ' + (j.in_use ? 'нужна сборкам' : 'не используется')}
            keys="java установленная удалить"
          >
            <button
              className="btn sm ghost"
              disabled={j.in_use}
              aria-label={'Удалить Java ' + j.major}
              onClick={async () => {
                if (
                  !(await uiConfirm('Удалить Java ' + j.major + '? Если понадобится, лаунчер скачает её сам.', {
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
                  .catch((e) => {
                    console.error('[settings] java remove', e)
                    showToast('Не удалось удалить', 'error')
                  })
              }}
            >
              <Icon id="i-trash" />
            </button>
          </Row>
        ))}
      </Group>

      <Block keys="облако облачный профиль синхронизация сборки выгрузить забрать">
        <Group title="Облако">
          <CloudSync />
        </Group>
      </Block>
    </>
  )

  const account = (
    <>
      {millidaAcc ? (
        <Group>
          <Row title="Баланс" hint={(((millidaAcc.balance || 0) / 100) | 0).toLocaleString('ru-RU') + ' ₽'} keys="кошелёк деньги пополнить рубли">
            <button
              className="btn sm secondary"
              onClick={() => {
                track('store_open', { where: 'wallet_topup' })
                openExt(WALLET_URL)
              }}
            >
              Пополнить
            </button>
          </Row>
        </Group>
      ) : null}

      <Group title="Видно в профиле на millida.net">
        {!hasMillida ? (
          <Row title="Нужен аккаунт Millida" keys="приватность профиль видно">
            <button className="btn sm primary" onClick={() => logoutToLogin()}>
              <Icon id="i-login" /> Войти
            </button>
          </Row>
        ) : (
          PRIVACY_ROWS.map((r) => (
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
          <Row title="Не загрузилось" keys="приватность ошибка">
            <span data-err={privacy.error} hidden></span>
            <button className="btn sm secondary" onClick={() => void loadPrivacy(true)}>
              <Icon id="i-restart" /> Повторить
            </button>
          </Row>
        ) : null}
      </Group>

      <Group title="Снаружи">
        <Row title="Активность в Discord" keys="дискорд статус rich presence приватность">
          <Toggle
            label="Активность в Discord"
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
        <Row title="Анонимная статистика" hint="Без ников и файлов — только цифры" keys="телеметрия данные приватность">
          <Toggle
            id="setTelemetry"
            label="Анонимная статистика"
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
                  ? 'Обновление ' + upd.version + ' встанет при выходе'
                  : 'Доступна ' + upd.version
                : ver
                  ? 'Версия ' + ver
                  : 'Версия приложения'}
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
                  showToast('Не удалось обновиться', 'error')
                })
              }}
            >
              <Icon id="i-restart" /> {updBusy ? 'Обновляем…' : 'Обновить'}
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
                    if (!u) showToast('Стоит последняя версия')
                  })
                  .finally(() => setUpdBusy(false))
              }}
            >
              {updBusy ? <span className="spin"></span> : <Icon id="i-restart" />} Проверить
            </button>
          )}
        </div>
      </Block>

      <Group>
        <Row title="Что нового" keys="список изменений версия">
          <button className="btn sm secondary" id="setWhatsNew" onClick={() => void openWhatsNew()}>
            Открыть
          </button>
        </Row>
        <Row title="Тестовые версии" hint={beta ? 'Раньше всех, бывают поломки' : undefined} keys="бета тестирование обновления раньше">
          <Toggle
            label="Тестовые версии"
            on={beta}
            onChange={() => {
              const next = !beta
              setBeta(next)
              writePref('m-beta', next ? '1' : '0')
            }}
          />
        </Row>
        <Row title="Крестик прячет в трей" hint={tray ? undefined : 'Трей недоступен в этой системе'} keys="трей закрывать окно свернуть">
          <Toggle
            label="Крестик прячет в трей"
            on={trayClose}
            disabled={!tray}
            onChange={() => {
              if (!tray) {
                showToast('Трей недоступен в этой системе', 'error')
                return
              }
              const next = !trayClose
              setTrayCloseOn(next)
              setTrayClose(next)
            }}
          />
        </Row>
        <Row title="Гайд по лаунчеру" keys="обучение тур подсказки помощь">
          <button className="btn sm secondary" onClick={startTour}>
            Показать
          </button>
        </Row>
        <Row
          title="Отчёт для поддержки"
          hint={diagText ? 'Скопировано — вставь в чат поддержки' : undefined}
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
                  showToast(ok ? 'Отчёт скопирован' : 'Не скопировалось — выдели текст ниже', ok ? 'ok' : 'error')
                  if (!ok) setDiagOpen(true)
                })
                .catch((e) => {
                  console.error('[settings] diag', e)
                  showToast('Отчёт не собрался', 'error')
                })
                .finally(() => setDiagBusy(false))
            }}
          >
            {diagBusy ? 'Собираем…' : 'Копировать'}
          </button>
          {diagText ? (
            <button className="btn sm ghost" onClick={() => setDiagOpen((o) => !o)}>
              {diagOpen ? 'Скрыть' : 'Текст'}
            </button>
          ) : null}
        </Row>
        {diagText && diagOpen ? (
          <textarea className="s2-diag" readOnly value={diagText} onFocus={(e) => e.currentTarget.select()} />
        ) : null}
      </Group>
    </>
  )

  const views: Record<SecId, ReactNode> = { look, sound, game, files, account, about }
  const q = query.trim()

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-settings">
      <div className="s2">
        <div className="s2-head">
          <h1 className="s2-title">Настройки</h1>
          <label className="input sm s2-search">
            <Icon id="i-search" />
            <input
              value={query}
              placeholder="Найти"
              aria-label="Найти настройку"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
            />
            {query ? (
              <button className="s2-search-x" aria-label="Очистить поиск" onClick={() => setQuery('')}>
                <Icon id="i-x" />
              </button>
            ) : null}
          </label>
        </div>
        <nav className="set-tabs s2-tabs" role="tablist" aria-label="Разделы настроек">
          {SECTIONS.map((s) => (
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
                {SECTIONS.map((s) => (
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
                  <b>Ничего не нашлось</b>
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
  const on = useMusic((s) => radioOn(s))
  const toggle = useMusic((s) => s.toggleRadio)
  return <Toggle label="Музыка сейчас" on={on} onChange={() => toggle()} />
}
