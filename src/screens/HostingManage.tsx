import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { formatFixed, intlTag, t, useT } from '../i18n'
import { Select } from '../components/Select'
import { api } from '../lib/api'
import { track } from '../lib/telemetry'
import { consoleParts, logLevelClass } from '../lib/ansi'
import { showToast } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import { hostConsoleStart, hostConsoleStop, openUrl, pickTexture } from '../ipc/commands'
import { uiConfirm } from '../state/confirm'
import {
  beginConsoleReplay,
  consoleLines,
  endConsoleReplay,
  pushConsoleLine,
  useHostConsole,
} from '../state/hostConsole'
import { listenHostConsole, listenHostConsoleReplayEnd } from '../ipc/events'
import { usePolling } from '../lib/usePolling'
import type { HostServer } from './Hosting'
import { Head } from '../components/Head'
import { ApplyField, Cap, Empty, NumField, Row, Seg, TextField, Toggle } from './hosting/kit'
import { host, errText, P } from './hosting/api'
import type { HostingSubscription } from './hosting/api'
import { TabContent } from './hosting/TabContent'
import { TabWorld } from './hosting/TabWorld'
import { TabFiles } from './hosting/TabFiles'
import { TabSchedule } from './hosting/TabSchedule'
import { TabNetwork } from './hosting/TabNetwork'
import { TabAccess } from './hosting/TabAccess'
import { Journal, TabPlan } from './hosting/TabPlan'
import { HostScene, HostStat, PixMeter } from '../components/hosting/HostScene'
import { BalancePill } from '../components/hosting/HostKit'
import { hostingPlanPrice, moneyText, useMoney } from '../lib/useMoney'

// Console error prefix: a word, not a "⚠" dingbat (rule 5.1 — Lucide icons only).
// The .err class is applied by matching this same prefix.
const LOG_ERR = () => t('Ошибка: ')

/// How long the replayed history is held back before it is shown as ordinary
/// output: the marker that ends it arrives right after the tail, and a node that
/// sends none must not leave the console blank.
const REPLAY_WAIT_MS = 3_000

interface Rules {
  gamemode?: string
  difficulty?: string
  pvp?: boolean
  keepInventory?: boolean
  alwaysDay?: boolean
  whitelist?: boolean
  motd?: string
  motdLine2?: string
  maxPlayers?: number
  levelType?: string
  levelSeed?: string
  levelName?: string
  worldBorder?: number
  viewDistance?: number
  simulationDistance?: number
  spawnProtection?: number
  allowFlight?: boolean
  onlineMode?: boolean
  millidaAuth?: boolean
  hardcore?: boolean
  commandBlocks?: boolean
  spawnMonsters?: boolean
  spawnAnimals?: boolean
  spawnNpcs?: boolean
  mobGriefing?: boolean
  allowNether?: boolean
  generateStructures?: boolean
  forceGamemode?: boolean
  playerIdleTimeout?: number
  enableStatus?: boolean
  hideOnlinePlayers?: boolean
  enforceSecureProfile?: boolean
  entityBroadcastRange?: number
  networkCompressionThreshold?: number
  maxTickTime?: number
  opPermissionLevel?: number
  functionPermissionLevel?: number
  broadcastConsoleToOps?: boolean
  resourcePack?: string
  resourcePackSha1?: string
  requireResourcePack?: boolean
  syncChunkWrites?: boolean
  useNativeTransport?: boolean
  rateLimit?: number
  paperNoPhantoms?: boolean
  paperAntiXray?: boolean
  javaVersion?: number
  jvmProfile?: string
}

interface RosterPlayer {
  id: string
  nickname: string
  role: string
  banned: boolean
  lastJoinAt: string | null
}

interface Detail extends HostServer {
  rules?: Rules | null
  players?: RosterPlayer[]
  customDomain?: string | null
  iconLocked?: boolean
  subscription?: HostingSubscription | null
  canDelete?: boolean
  crashReason?: string | null
}

interface Stats {
  running: boolean
  memoryUsedMb: number
  memoryLimitMb: number
  cpuPercent: number
  diskUsedMb: number
  diskLimitMb: number
}

interface OnlinePlayer {
  name: string
  uuid: string
}

interface Backup {
  id: string
  kind: string
  sizeMb: number
  locked: boolean
  status?: string
  createdAt: string
}

const BACKUP_ST = (): Record<string, string> => ({
  pending: t('собирается'),
  ready: t('готова'),
  failed: t('не собралась'),
})

const ROLE_LABEL = (): Record<string, string> => ({
  OWNER: t('владелец'),
  ADMIN: t('админ'),
  MODERATOR: t('модератор'),
  PLAYER: t('игрок'),
})

// Подсказки в консоли: нажал — команда встала в поле. Раньше это была строка текста.
const CMD_HINTS = () => [t('say привет'), 'time set day', 'weather clear']

const gb = (mb: number) => formatFixed(mb / 1024, mb % 1024 === 0 ? 0 : 1)

const JAVA_OPTIONS = () => [
  { value: '0', label: t('Автоматически') },
  { value: '8', label: 'Java 8' },
  { value: '11', label: 'Java 11' },
  { value: '16', label: 'Java 16' },
  { value: '17', label: 'Java 17' },
  { value: '21', label: 'Java 21' },
  { value: '25', label: 'Java 25' },
]

const clockAt = (msAgo: number) =>
  new Date(Date.now() - msAgo).toLocaleTimeString(intlTag(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

/// Живой график нагрузки: столбики из клеток плотным акцентом, по одному на
/// замер (раз в 5 с). Линия с градиентной заливкой снята — градиенты запрещены
/// контрактом, а ровная линия на 26% выглядела пустой плашкой (23.09.2026).
function PixBars({ data: all, stepMs = 5000, slots = 24 }: { data: number[]; stepMs?: number; slots?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = all.slice(-slots)
  const pad = Math.max(0, slots - data.length)
  const tipLeft = hover != null ? ((pad + hover + 0.5) / slots) * 100 : 0
  return (
    <div className="hsx-bars" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: slots }, (_, i) => {
        const k = i - pad
        const v = k >= 0 ? data[k] : null
        return (
          <span
            key={i}
            className={'hsx-bar' + (v == null ? ' is-empty' : '') + (hover === k ? ' is-hover' : '')}
            onMouseEnter={() => (v != null ? setHover(k) : setHover(null))}
          >
            {v != null ? <i style={{ height: Math.max(4, Math.min(100, v)) + '%' }}></i> : null}
          </span>
        )
      })}
      {hover != null && hover < data.length ? (
        <div
          className="hsx-bars-tip"
          style={{ left: tipLeft + '%', transform: `translateX(${tipLeft > 70 ? '-100%' : tipLeft < 30 ? '0' : '-50%'})` }}
        >
          <b>{Math.round(data[hover]) + '%'}</b>
          <span>{clockAt((data.length - 1 - hover) * stepMs)}</span>
        </div>
      ) : null}
    </div>
  )
}

/// Backend expects a square 64x64 PNG icon, so convert it here.
async function iconFromDataUrl(src: string): Promise<string> {
  const img = new Image()
  img.src = src
  await img.decode()
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 64
  const g = cv.getContext('2d')
  if (!g) throw new Error(t('не удалось обработать картинку'))
  g.imageSmoothingEnabled = false
  g.drawImage(img, 0, 0, 64, 64)
  return cv.toDataURL('image/png')
}

export function HostingManage({
  server,
  onBack,
  onRefreshList,
  onUpgrade,
  onPlay,
}: {
  server: HostServer
  onBack: () => void
  /// Войти в игру на этот сервер — та же логика, что у «Играть» в списке.
  onPlay?: () => void
  onRefreshList: () => void
  onUpgrade?: (serverId: string, planCode?: string | null) => void
}) {
  const t = useT()
  useMoney()
  const [tab, setTab] = useState('overview')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [memHist, setMemHist] = useState<number[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const [online, setOnline] = useState<OnlinePlayer[]>([])
  const [backups, setBackups] = useState<Backup[]>([])
  const [cmd, setCmd] = useState('')
  const [busyPower, setBusyPower] = useState(false)
  const [newPlayer, setNewPlayer] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [advOpen, setAdvOpen] = useState(false)
  const [statsWait, setStatsWait] = useState(true)
  const [crash, setCrash] = useState<{ reason: string | null; hint: { title: string; advice: string } | null; lines: string[] } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const log = useHostConsole((s) => consoleLines(s, server.id))

  const reload = () => {
    void api(P(server.id))
      .then((d) => setDetail(d))
      .catch(() => {})
  }
  useEffect(reload, [server.id])

  useEffect(() => {
    setCpuHist([])
    setMemHist([])
    setTab('overview')
    setStatsWait(true)
    const t = setTimeout(() => setStatsWait(false), 15_000)
    return () => clearTimeout(t)
  }, [server.id])

  useEffect(() => {
    if (!moreOpen) return
    const close = () => setMoreOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [moreOpen])

  const pullStats = () => {
    void api(P(server.id) + '/stats')
      .then((s: Stats) => {
        setStats(s)
        const mem = s.memoryLimitMb ? Math.min(100, (s.memoryUsedMb / s.memoryLimitMb) * 100) : 0
        setCpuHist((h) => [...h.slice(-47), Math.max(0, Math.min(100, s.cpuPercent))])
        setMemHist((h) => [...h.slice(-47), mem])
      })
      .catch(() => {})
  }
  usePolling(pullStats, 5000, { hiddenMs: 0 })

  // Status, address and plan change without the owner touching this page (the
  // server finishes starting, crashes, gets stopped from the site), so the card
  // is re-read on its own instead of only after an action here.
  usePolling(reload, 10_000, { immediate: false, realtime: 'hosting' })

  const refreshAll = () => {
    reload()
    pullStats()
    onRefreshList()
  }

  usePolling(
    () => {
      void api(P(server.id) + '/online')
        .then((r) => setOnline((r && r.players) || []))
        .catch(() => {})
    },
    8000,
    { enabled: tab === 'players', hiddenMs: 0 },
  )

  const loadBackups = () => {
    void api(P(server.id) + '/backups')
      .then((b) => setBackups(Array.isArray(b) ? b : []))
      .catch(() => {})
  }
  useEffect(() => {
    if (tab === 'world') loadBackups()
  }, [tab, server.id])

  const status = (detail || server).status || ''
  const running = status === 'RUNNING'
  const rules = (detail?.rules || {}) as Rules
  const free = !(detail || server).planPriceKopecks

  useEffect(() => {
    if (status !== 'CRASHED') {
      setCrash(null)
      return
    }
    void host
      .crash(server.id)
      .then(setCrash)
      .catch(() => setCrash(null))
  }, [status, server.id])

  // Rust reads the SSE stream and re-emits console lines as the "host-console" event.
  useEffect(() => {
    if (tab !== 'console' || !hasTauri()) return
    const subs: Array<() => void> = []
    let alive = true
    const keep = (u: (() => void) | null) => {
      if (!alive && u) u()
      else if (u) subs.push(u)
    }
    const toBottom = () => setTimeout(() => logRef.current?.scrollTo(0, 1e9), 20)
    beginConsoleReplay(server.id)
    // A node that never sends the marker must not leave its replay invisible.
    const noMarker = setTimeout(() => endConsoleReplay(server.id, false), REPLAY_WAIT_MS)
    listenHostConsole((line) => {
      pushConsoleLine(server.id, line)
      toBottom()
    }).then(keep)
    listenHostConsoleReplayEnd(() => {
      clearTimeout(noMarker)
      endConsoleReplay(server.id, true)
      toBottom()
    }).then(keep)
    void hostConsoleStart(server.id).catch(() => {})
    // Coming back to the tab lands on the lines that were already there, and a
    // restored buffer scrolled to its top hides exactly what the player left on.
    toBottom()
    return () => {
      alive = false
      clearTimeout(noMarker)
      endConsoleReplay(server.id, false)
      subs.forEach((u) => u())
      void hostConsoleStop().catch(() => {})
    }
  }, [tab, server.id])

  const power = (path: string, label: string, ok: string) => {
    setBusyPower(true)
    track('hosting_action', { action: path.replace('/', '') })
    showToast(label)
    api(P(server.id) + path, { method: 'POST' })
      .then(() => {
        showToast(ok)
        setTimeout(() => {
          reload()
          onRefreshList()
        }, 1200)
      })
      .catch((e) => {
        console.error('[hosting] ' + path, e)
        showToast(t('Не получилось — попробуй ещё раз'), 'error')
      })
      .finally(() => setBusyPower(false))
  }

  const save = (patch: Partial<Rules>, key: string) => {
    setSaving(key)
    track('hosting_action', { action: 'settings', field: key })
    api(P(server.id) + '/settings', { method: 'PATCH', body: JSON.stringify(patch) })
      .then(() => {
        showToast(running ? t('Сохранено — применится после перезапуска') : t('Настройки сохранены'))
        reload()
      })
      .catch((e) => showToast(t('Не удалось сохранить: {error}', { error: errText(e) }), 'error'))
      .finally(() => setSaving(null))
  }

  const rename = async (name: string) => {
    setSaving('name')
    try {
      await host.rename(server.id, name)
      showToast(t('Сервер переименован'))
      reload()
      onRefreshList()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setSaving(null)
    }
  }

  const changeIcon = async () => {
    if (!hasTauri()) {
      showToast(t('Смена иконки — в приложении'), 'error')
      return
    }
    if ((detail || server) && detail?.iconLocked) {
      showToast(t('На бесплатном тарифе иконка наша — она же метка Millida'), 'error')
      return
    }
    setSaving('icon')
    try {
      const picked = await pickTexture()
      if (!picked) return
      const icon = await iconFromDataUrl(picked.data)
      await host.setIcon(server.id, icon)
      showToast(t('Иконка обновлена'))
      reload()
      onRefreshList()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setSaving(null)
    }
  }

  const clearIcon = async () => {
    setSaving('icon')
    try {
      await host.setIcon(server.id, null)
      showToast(t('Иконка убрана'))
      reload()
      onRefreshList()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setSaving(null)
    }
  }

  const playerAction = (nickname: string, action: string, progress: string) => {
    track('hosting_action', { action })
    showToast(progress)
    host
      .playerAction(server.id, nickname, action)
      .then(() => showToast(t('Готово')))
      .catch((e) => showToast(t('Ошибка: {error}', { error: errText(e) }), 'error'))
  }

  const addPlayer = async () => {
    const nick = newPlayer.trim()
    if (!nick) return
    try {
      await host.addPlayer(server.id, nick)
      setNewPlayer('')
      showToast(t('{nick} добавлен в команду', { nick }))
      reload()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const changeRole = async (p: RosterPlayer, role: string) => {
    try {
      await host.changeRole(server.id, p.id, role)
      reload()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const banRoster = async (p: RosterPlayer) => {
    try {
      await host.banPlayer(server.id, p.id, !p.banned)
      showToast(p.banned ? t('Разбанен') : t('Забанен'))
      reload()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const removeRoster = async (p: RosterPlayer) => {
    if (!(await uiConfirm(t('Убрать {nick} из команды сервера?', { nick: p.nickname }), { confirmLabel: t('Убрать') }))) return
    try {
      await host.removePlayer(server.id, p.id)
      reload()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const sendCmd = () => {
    const c = cmd.trim()
    if (!c) return
    track('hosting_action', { action: 'console' })
    pushConsoleLine(server.id, '> ' + c)
    api(P(server.id) + '/console/command', { method: 'POST', body: JSON.stringify({ command: c }) })
      .then(() => {
        setCmd('')
        setTimeout(() => logRef.current?.scrollTo(0, 1e9), 30)
      })
      .catch((e) => {
        pushConsoleLine(server.id, LOG_ERR() + t('команда не ушла — {error}', { error: errText(e) }))
        showToast(t('Не удалось отправить команду'), 'error')
      })
  }

  const runBackup = () => {
    track('hosting_action', { action: 'backup' })
    showToast(t('Создаём резервную копию…'))
    api(P(server.id) + '/backups', { method: 'POST' })
      .then(() => {
        showToast(t('Копия ставится в очередь'))
        setTimeout(loadBackups, 1500)
      })
      .catch((e) => showToast(t('Ошибка: {error}', { error: errText(e) }), 'error'))
  }

  const restoreBackup = async (b: Backup) => {
    if (
      !(await uiConfirm(t('Восстановить сервер из копии от {date}? Текущий мир заменится.', { date: new Date(b.createdAt).toLocaleString(intlTag()) }), {
        confirmLabel: t('Восстановить'),
      }))
    )
      return
    track('hosting_action', { action: 'restore' })
    showToast(t('Восстанавливаем из копии…'))
    api(P(server.id) + '/backups/' + b.id + '/restore', { method: 'POST' })
      .then(() => showToast(t('Восстановление запущено')))
      .catch((e) => showToast(t('Ошибка: {error}', { error: errText(e) }), 'error'))
  }

  const deleteBackup = async (b: Backup) => {
    if (!(await uiConfirm(t('Удалить копию безвозвратно?'), { confirmLabel: t('Удалить') }))) return
    api(P(server.id) + '/backups/' + b.id, { method: 'DELETE' })
      .then(() => setBackups((arr) => arr.filter((x) => x.id !== b.id)))
      .catch((e) => showToast(t('Ошибка: {error}', { error: errText(e) }), 'error'))
  }

  const kill = async () => {
    if (!(await uiConfirm(t('Принудительно завершить процесс сервера? Несохранённые чанки потеряются.'), { confirmLabel: t('Завершить') })))
      return
    try {
      await host.kill(server.id)
      showToast(t('Процесс завершён'))
      setTimeout(() => {
        reload()
        onRefreshList()
      }, 1200)
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  // Пять крупных вкладок самого нужного, остальное — в «Ещё» (правка владельца
  // 23.09.2026: «всё то же, что в веб-панели, только проще»). Все разделы
  // веб-панели на месте: Консоль, Моды, Игроки, Мир и копии — на виду;
  // Настройки, Файлы, Сеть, Автоматика и журнал, Доступ, Тариф — в «Ещё».
  const MAIN_TABS: [string, string, string][] = [
    ['overview', 'i-play', t('Обзор')],
    ['console', 'i-list', t('Консоль')],
    ['content', 'i-blocks', /^(paper|spigot|bukkit|purpur|folia|pufferfish|leaf|velocity|bungee|waterfall)/i.test((detail || server).core || '') ? t('Плагины') : t('Моды')],
    ['players', 'i-users', t('Игроки')],
    ['world', 'i-map', t('Мир')],
  ]
  const MORE_TABS: [string, string, string][] = [
    ['settings', 'i-settings', t('Настройки')],
    ['files', 'i-folder', t('Файлы')],
    ['network', 'i-link', t('Сеть')],
    ['schedule', 'i-clock', t('Автоматика')],
    ['access', 'i-key', t('Доступ')],
    ['plan', 'i-star', t('Тариф')],
  ]
  const moreCur = MORE_TABS.find((m) => m[0] === tab)

  const memPct = stats && stats.memoryLimitMb ? Math.min(100, Math.round((stats.memoryUsedMb / stats.memoryLimitMb) * 100)) : 0
  const diskPct = stats && stats.diskLimitMb ? Math.min(100, Math.round((stats.diskUsedMb / stats.diskLimitMb) * 100)) : 0
  const cur = detail || server
  const maxSlots = server.planMaxPlayers && server.planMaxPlayers > 0 ? server.planMaxPlayers : 1000
  const onl = cur.playersOnline || 0
  const maxP = cur.maxPlayers || cur.planMaxPlayers || 0
  const ramCap = stats?.memoryLimitMb || cur.planRamMb || cur.ramMb || 0
  const canKill = status === 'CRASHED' || status === 'STOPPING' || running
  const coreTag = [cur.core, cur.version].filter(Boolean).join(' ')

  const stop = async () => {
    if (
      !(await uiConfirm(t('Игроков выкинет из игры, мир сохранится.'), {
        title: t('Остановить сервер?'),
        confirmLabel: t('Остановить'),
        cancelLabel: t('Отмена'),
      }))
    )
      return
    power('/stop', t('Останавливаем…'), t('Сервер остановлен'))
  }

  return (
    <div className="host-manage hsx-manage">
      <div className="hsx-manage-top">
        <button className="btn sm ghost hsx-back" onClick={onBack}>
          <Icon id="i-chev-l" /> {t('К серверам')}
        </button>
        <span className="hsx-manage-top-r">
          <button className="btn sm secondary" data-track="host_refresh" onClick={refreshAll}>
            <Icon id="i-restart" /> {t('Обновить')}
          </button>
          <BalancePill />
        </span>
      </div>

      <HostScene
        name={cur.name || server.slug || t('Мой сервер')}
        status={status}
        address={cur.address || ''}
        icon={cur.icon}
        free={free}
        tag={coreTag}
        compact
        actions={
          running ? (
            <>
              <button className="btn lg primary hsx-main" onClick={() => onPlay && onPlay()}>
                <Icon id="i-play" /> {t('Играть')}
              </button>
              <button
                className="btn lg secondary"
                disabled={busyPower}
                onClick={() => power('/restart', t('Перезапускаем…'), t('Перезапуск запущен'))}
              >
                <Icon id="i-restart" /> {t('Перезапустить')}
              </button>
            </>
          ) : (
            <button
              className="btn lg primary hsx-main hs-power"
              disabled={busyPower || status === 'STARTING' || status === 'INSTALLING' || status === 'STOPPING'}
              onClick={() => power('/start', t('Запускаем…'), t('Сервер запускается'))}
            >
              <Icon id="i-power" /> {t('Запустить сервер')}
            </button>
          )
        }
        stats={
          <>
            <HostStat
              block={32}
              big={
                <>
                  {onl}
                  {maxP ? <small> / {maxP}</small> : null}
                </>
              }
              small={t('игроков в сети')}
              pct={maxP ? (onl / maxP) * 100 : null}
            />
            <HostStat
              block={20}
              big={
                stats && running ? (
                  <>
                    {gb(stats.memoryUsedMb)}
                    <small> / {t('{n} ГБ', { n: gb(stats.memoryLimitMb) })}</small>
                  </>
                ) : ramCap ? (
                  <>
                    {gb(ramCap)}
                    <small> {t('ГБ')}</small>
                  </>
                ) : (
                  '—'
                )
              }
              small={stats && running ? t('памяти занято') : t('памяти')}
              pct={stats && running ? memPct : null}
            />
            {stats && running ? (
              <HostStat block={19} big={Math.round(stats.cpuPercent) + '%'} small={t('процессор')} pct={stats.cpuPercent} />
            ) : null}
            <HostStat
              block={1}
              big={free ? (moneyText(0, null) ?? '') : (hostingPlanPrice(cur.planCode) ?? '—')}
              small={free ? cur.planName || t('Бесплатный') : cur.planName ? t('в месяц · {plan}', { plan: cur.planName }) : t('в месяц')}
              onClick={() => setTab('plan')}
            />
          </>
        }
      />

      <nav className="hsx-tabs" aria-label={t('Разделы сервера')}>
        {MAIN_TABS.map(([id, ic, label]) => (
          <button key={id} className={'hsx-tab' + (tab === id ? ' on' : '')} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon id={ic} /> {label}
          </button>
        ))}
        <div className="hsx-more">
          <button
            className={'hsx-tab' + (moreCur ? ' on' : '')}
            aria-expanded={moreOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMoreOpen(!moreOpen)
            }}
          >
            <Icon id={moreCur ? moreCur[1] : 'i-dots'} /> {moreCur ? moreCur[2] : t('Ещё')}
            <Icon id="i-chev-d" />
          </button>
          {moreOpen ? (
            <div className="hsx-more-pop" role="menu" onClick={(e) => e.stopPropagation()}>
              {MORE_TABS.map(([id, ic, label]) => (
                <button
                  key={id}
                  role="menuitem"
                  className={'hsx-more-item' + (tab === id ? ' on' : '')}
                  onClick={() => {
                    setTab(id)
                    setMoreOpen(false)
                  }}
                >
                  <Icon id={ic} /> {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </nav>

      <div className="host-manage-body">
        {tab === 'overview' ? (
          <div className="hsx-overview">
            {crash ? (
              <div className="host-crash">
                <Icon id="i-alert" />
                <div>
                  <div className="host-crash-t">{crash.hint?.title || t('Сервер упал')}</div>
                  <div className="host-crash-s">{crash.hint?.advice || crash.reason || t('Причина — в консоли')}</div>
                </div>
              </div>
            ) : null}

            {cur.pendingRestart && cur.pendingRestart.length ? (
              <div className="hs-banner">
                <Icon id="i-restart" />
                <b>{t('Нужен перезапуск')}</b>
                {running ? (
                  <button className="btn sm secondary" disabled={busyPower} onClick={() => power('/restart', t('Перезапускаем…'), t('Перезапуск запущен'))}>
                    {t('Перезапустить')}
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* График — только из живых замеров. Пока замеров нет, 15 секунд
                стоит скелетон; не пришли — блока нет совсем: пустой серой
                плашки на экране быть не должно (приказ 23.09.2026). */}
            {running && cpuHist.length > 1 ? (
              <div className="hsx-graphs">
                <div className="hsx-graph">
                  <div className="hsx-graph-head">
                    <span>{t('Процессор')}</span>
                    <b>{stats ? Math.round(stats.cpuPercent) + '%' : '—'}</b>
                  </div>
                  <PixBars data={cpuHist} />
                </div>
                <div className="hsx-graph">
                  <div className="hsx-graph-head">
                    <span>{t('Память')}</span>
                    <b>{memPct + '%'}</b>
                  </div>
                  <PixBars data={memHist} />
                </div>
                {stats && stats.diskLimitMb ? (
                  <div className="hsx-graph hsx-disk">
                    <img src="/block-icons/Block38Millida.png" alt="" width={48} height={48} />
                    <b>
                      {gb(stats.diskUsedMb)}
                      <small> / {t('{n} ГБ', { n: gb(stats.diskLimitMb) })}</small>
                    </b>
                    <span>{t('на диске')}</span>
                    <PixMeter pct={diskPct} tone={diskPct >= 90 ? 'danger' : diskPct >= 75 ? 'warn' : undefined} />
                  </div>
                ) : null}
              </div>
            ) : running && statsWait ? (
              <div className="hsx-graphs" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <span className="skel hsx-graph-skel" key={i}></span>
                ))}
              </div>
            ) : null}

            {!running && !crash ? (
              <div className="hsx-off">
                <img src="/block-icons/Block24Millida.png" alt="" width={56} height={56} />
                <b>{status === 'STARTING' || status === 'INSTALLING' ? t('Сервер запускается') : t('Сервер выключен')}</b>
              </div>
            ) : null}

            {canKill ? (
              <div className="hsx-danger">
                <div className="hsx-danger-t">
                  <Icon id="i-power" />
                  <b>{t('Выключение')}</b>
                </div>
                {running ? (
                  <button className="btn md danger" disabled={busyPower} onClick={() => void stop()}>
                    <Icon id="i-power" /> {t('Остановить')}
                  </button>
                ) : null}
                <button className="btn md ghost hsx-kill" onClick={() => void kill()}>
                  <Icon id="i-zap" /> {t('Завершить процесс')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="hsx-settings">
            <div className="card set-group hsx-plate hsx-main-set">
              <Row k={t('Название')}>
                <ApplyField value={cur.name || ''} label={t('Сохранить')} busy={saving === 'name'} onApply={rename} />
              </Row>
              <Row k={t('Режим')}>
                <Seg
                  value={rules.gamemode || 'survival'}
                  busy={saving === 'gamemode'}
                  options={[
                    ['survival', t('Выживание')],
                    ['creative', t('Творческий')],
                    ['adventure', t('Приключение')],
                  ]}
                  onPick={(v) => save({ gamemode: v }, 'gamemode')}
                />
              </Row>
              <Row k={t('Сложность')}>
                <Seg
                  value={rules.difficulty || 'normal'}
                  busy={saving === 'difficulty'}
                  options={[
                    ['peaceful', t('Мирная')],
                    ['easy', t('Лёгкая')],
                    ['normal', t('Норм')],
                    ['hard', t('Сложная')],
                  ]}
                  onPick={(v) => save({ difficulty: v }, 'difficulty')}
                />
              </Row>
              <Row k="PvP">
                <Toggle on={!!rules.pvp} busy={saving === 'pvp'} onChange={(v) => save({ pvp: v }, 'pvp')} />
              </Row>
              <Row k={t('Вайтлист')} sub={t('Только приглашённые')}>
                <Toggle on={!!rules.whitelist} busy={saving === 'whitelist'} onChange={(v) => save({ whitelist: v }, 'whitelist')} />
              </Row>
              <Row k={t('Максимум игроков')}>
                <NumField
                  value={rules.maxPlayers ?? (server.planMaxPlayers && server.planMaxPlayers > 0 ? server.planMaxPlayers : 20)}
                  min={1}
                  max={maxSlots}
                  busy={saving === 'maxPlayers'}
                  onSave={(v) => save({ maxPlayers: v }, 'maxPlayers')}
                />
              </Row>
            </div>
            <button className={'hsx-adv' + (advOpen ? ' open' : '')} aria-expanded={advOpen} onClick={() => setAdvOpen(!advOpen)}>
              <Icon id="i-settings" />
              <b>{t('Для опытных')}</b>
              <Icon id="i-chev-d" />
            </button>
            {advOpen ? (
              <div className="card set-group host-set-grid hsx-plate">
                <Cap first>{t('Сервер')}</Cap>
                <Row k={t('Иконка')} sub={detail?.iconLocked ? t('На бесплатном — логотип Millida') : 'PNG, 64×64'}>
                  {cur.icon ? (
                    <img
                      src={cur.icon}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.src = '/millida-logo.svg'
                      }}
                      style={{ width: 28, height: 28, borderRadius: 6 }}
                    />
                  ) : null}
                  <button className="btn sm secondary" disabled={saving === 'icon' || detail?.iconLocked} onClick={() => void changeIcon()}>
                    {t('Выбрать')}
                  </button>
                  {cur.icon && !detail?.iconLocked ? (
                    <button className="btn sm ghost" disabled={saving === 'icon'} onClick={() => void clearIcon()}>
                      {t('Убрать')}
                    </button>
                  ) : null}
                </Row>
                <Row k={t('Описание в списке серверов')}>
                  <TextField value={rules.motd || ''} placeholder={cur.name || t('Мой сервер')} busy={saving === 'motd'} onSave={(v) => save({ motd: v }, 'motd')} />
                </Row>
                <Row k={t('Вторая строка описания')} sub={free ? t('На бесплатном — подпись Millida') : undefined}>
                  <TextField value={rules.motdLine2 || ''} placeholder="—" busy={saving === 'motdLine2' || free} onSave={(v) => save({ motdLine2: v }, 'motdLine2')} />
                </Row>

                <Cap>{t('Режим игры')}</Cap>
                <Row k={t('Сохранять инвентарь')} sub={t('Предметы остаются после смерти')}>
                  <Toggle on={!!rules.keepInventory} busy={saving === 'keepInventory'} onChange={(v) => save({ keepInventory: v }, 'keepInventory')} />
                </Row>
                <Row k={t('Вечный день')}>
                  <Toggle on={!!rules.alwaysDay} busy={saving === 'alwaysDay'} onChange={(v) => save({ alwaysDay: v }, 'alwaysDay')} />
                </Row>
                <Row k={t('Мобы ломают блоки')}>
                  <Toggle on={rules.mobGriefing !== false} busy={saving === 'mobGriefing'} onChange={(v) => save({ mobGriefing: v }, 'mobGriefing')} />
                </Row>
                <Row k={t('Хардкор')} sub={t('Одна жизнь на всех')}>
                  <Toggle on={!!rules.hardcore} busy={saving === 'hardcore'} onChange={(v) => save({ hardcore: v }, 'hardcore')} />
                </Row>
                <Row k={t('Возвращать режим при входе')}>
                  <Toggle on={!!rules.forceGamemode} busy={saving === 'forceGamemode'} onChange={(v) => save({ forceGamemode: v }, 'forceGamemode')} />
                </Row>

                <Cap>{t('Игроки и доступ')}</Cap>
                <Row k={t('Только с лицензией')}>
                  <Toggle on={rules.onlineMode !== false} busy={saving === 'onlineMode'} onChange={(v) => save({ onlineMode: v }, 'onlineMode')} />
                </Row>
                {rules.onlineMode === false ? (
                  <Row k={t('Авторизация Millida')} sub={t('Пускать игроков Millida по нику')}>
                    <Toggle on={rules.millidaAuth === true} busy={saving === 'millidaAuth'} onChange={(v) => save({ millidaAuth: v }, 'millidaAuth')} />
                  </Row>
                ) : null}
                <Row k={t('Подписанный чат')} sub={t('Сообщения с подписью Mojang')}>
                  <Toggle
                    on={rules.enforceSecureProfile !== false}
                    busy={saving === 'enforceSecureProfile'}
                    onChange={(v) => save({ enforceSecureProfile: v }, 'enforceSecureProfile')}
                  />
                </Row>
                <Row k={t('Кик за простой, минут')} sub={t('0 — не кикать')}>
                  <NumField value={rules.playerIdleTimeout ?? 0} min={0} max={180} busy={saving === 'playerIdleTimeout'} onSave={(v) => save({ playerIdleTimeout: v }, 'playerIdleTimeout')} />
                </Row>
                <Row k={t('Уровень прав оператора')} sub={t('1–4, стандарт 4')}>
                  <NumField value={rules.opPermissionLevel ?? 4} min={1} max={4} width="80px" busy={saving === 'opPermissionLevel'} onSave={(v) => save({ opPermissionLevel: v }, 'opPermissionLevel')} />
                </Row>
                <Row k={t('Уровень прав функций')} sub={t('1–4, стандарт 2')}>
                  <NumField value={rules.functionPermissionLevel ?? 2} min={1} max={4} width="80px" busy={saving === 'functionPermissionLevel'} onSave={(v) => save({ functionPermissionLevel: v }, 'functionPermissionLevel')} />
                </Row>
                <Row k={t('Команды видны операторам')}>
                  <Toggle on={rules.broadcastConsoleToOps !== false} busy={saving === 'broadcastConsoleToOps'} onChange={(v) => save({ broadcastConsoleToOps: v }, 'broadcastConsoleToOps')} />
                </Row>

                <Cap>{t('Мир')}</Cap>
                <Row k={t('Тип мира')}>
                  <Seg
                    value={rules.levelType || 'normal'}
                    busy={saving === 'levelType'}
                    options={[
                      ['normal', t('Обычный')],
                      ['flat', t('Плоский')],
                      ['large_biomes', t('Большие биомы')],
                      ['amplified', t('Гористый')],
                    ]}
                    onPick={(v) => save({ levelType: v }, 'levelType')}
                  />
                </Row>
                <Row k={t('Сид мира')}>
                  <TextField value={rules.levelSeed || ''} placeholder={t('случайный')} busy={saving === 'levelSeed'} onSave={(v) => save({ levelSeed: v }, 'levelSeed')} />
                </Row>
                <Row k={t('Папка мира')}>
                  <TextField value={rules.levelName || ''} placeholder="world" busy={saving === 'levelName'} onSave={(v) => save({ levelName: v }, 'levelName')} />
                </Row>
                <Row k={t('Граница мира, блоков')} sub={t('0 — без ограничения')}>
                  <NumField value={rules.worldBorder ?? 0} min={0} max={100000} busy={saving === 'worldBorder'} onSave={(v) => save({ worldBorder: v }, 'worldBorder')} />
                </Row>
                <Row k={t('Ад и Край')}>
                  <Toggle on={rules.allowNether !== false} busy={saving === 'allowNether'} onChange={(v) => save({ allowNether: v }, 'allowNether')} />
                </Row>
                <Row k={t('Деревни и постройки')}>
                  <Toggle on={rules.generateStructures !== false} busy={saving === 'generateStructures'} onChange={(v) => save({ generateStructures: v }, 'generateStructures')} />
                </Row>
                <Row k={t('Монстры')}>
                  <Toggle on={rules.spawnMonsters !== false} busy={saving === 'spawnMonsters'} onChange={(v) => save({ spawnMonsters: v }, 'spawnMonsters')} />
                </Row>
                <Row k={t('Животные')}>
                  <Toggle on={rules.spawnAnimals !== false} busy={saving === 'spawnAnimals'} onChange={(v) => save({ spawnAnimals: v }, 'spawnAnimals')} />
                </Row>
                <Row k={t('Жители деревень')}>
                  <Toggle on={rules.spawnNpcs !== false} busy={saving === 'spawnNpcs'} onChange={(v) => save({ spawnNpcs: v }, 'spawnNpcs')} />
                </Row>
                <Row k={t('Защита спавна, блоков')}>
                  <NumField value={rules.spawnProtection ?? 0} min={0} max={10000} busy={saving === 'spawnProtection'} onSave={(v) => save({ spawnProtection: v }, 'spawnProtection')} />
                </Row>
                <Row k={t('Полёт')} sub={t('Не кикать за полёт')}>
                  <Toggle on={!!rules.allowFlight} busy={saving === 'allowFlight'} onChange={(v) => save({ allowFlight: v }, 'allowFlight')} />
                </Row>
                <Row k={t('Командные блоки')}>
                  <Toggle on={!!rules.commandBlocks} busy={saving === 'commandBlocks'} onChange={(v) => save({ commandBlocks: v }, 'commandBlocks')} />
                </Row>

                <Cap>{t('Производительность')}</Cap>
                <Row k={t('Прорисовка, чанков')} sub={t('Сильнее всего грузит сервер')}>
                  <NumField value={rules.viewDistance ?? 10} min={3} max={32} busy={saving === 'viewDistance'} onSave={(v) => save({ viewDistance: v }, 'viewDistance')} />
                </Row>
                <Row k={t('Дальность активности, чанков')}>
                  <NumField value={rules.simulationDistance ?? 10} min={3} max={32} busy={saving === 'simulationDistance'} onSave={(v) => save({ simulationDistance: v }, 'simulationDistance')} />
                </Row>
                <Row k={t('Видимость сущностей, %')}>
                  <NumField value={rules.entityBroadcastRange ?? 100} min={10} max={1000} busy={saving === 'entityBroadcastRange'} onSave={(v) => save({ entityBroadcastRange: v }, 'entityBroadcastRange')} />
                </Row>
                <Row k={t('Сжатие пакетов, байт')} sub={t('-1 — выключить')}>
                  <NumField value={rules.networkCompressionThreshold ?? 256} min={-1} max={65536} busy={saving === 'networkCompressionThreshold'} onSave={(v) => save({ networkCompressionThreshold: v }, 'networkCompressionThreshold')} />
                </Row>
                <Row k={t('Сторож зависаний, мс')} sub={t('-1 — выключить')}>
                  <NumField value={rules.maxTickTime ?? 60000} min={-1} max={600000} width="130px" busy={saving === 'maxTickTime'} onSave={(v) => save({ maxTickTime: v }, 'maxTickTime')} />
                </Row>
                <Row k={t('Антифлуд, пакетов/с')} sub={t('0 — выключить')}>
                  <NumField value={rules.rateLimit ?? 0} min={0} max={10000} busy={saving === 'rateLimit'} onSave={(v) => save({ rateLimit: v }, 'rateLimit')} />
                </Row>
                <Row k={t('Синхронная запись чанков')} sub={t('Надёжнее, но медленнее')}>
                  <Toggle on={!!rules.syncChunkWrites} busy={saving === 'syncChunkWrites'} onChange={(v) => save({ syncChunkWrites: v }, 'syncChunkWrites')} />
                </Row>
                <Row k={t('Оптимизированная сеть')}>
                  <Toggle on={rules.useNativeTransport !== false} busy={saving === 'useNativeTransport'} onChange={(v) => save({ useNativeTransport: v }, 'useNativeTransport')} />
                </Row>
                <Row k={t('Фантомы только к бессонным')} sub={t('Только Paper')}>
                  <Toggle on={!!rules.paperNoPhantoms} busy={saving === 'paperNoPhantoms'} onChange={(v) => save({ paperNoPhantoms: v }, 'paperNoPhantoms')} />
                </Row>
                <Row k={t('Прятать руды от читов')} sub={t('Только Paper')}>
                  <Toggle on={!!rules.paperAntiXray} busy={saving === 'paperAntiXray'} onChange={(v) => save({ paperAntiXray: v }, 'paperAntiXray')} />
                </Row>

                <Cap>Java</Cap>
                <Row k={t('Версия Java')} sub={t('Авто — под версию игры')}>
                  <Select
                    value={String(rules.javaVersion || 0)}
                    options={JAVA_OPTIONS()}
                    width={180}
                    disabled={saving === 'javaVersion'}
                    onChange={(v) => save({ javaVersion: Number(v) || undefined }, 'javaVersion')}
                  />
                </Row>
                <Row k={t('Флаги JVM')}>
                  <Seg
                    value={rules.jvmProfile || 'shared'}
                    busy={saving === 'jvmProfile'}
                    options={[
                      ['shared', t('Общий')],
                      ['aikar', 'Aikar'],
                      ['vanilla', t('Без флагов')],
                    ]}
                    onPick={(v) => save({ jvmProfile: v }, 'jvmProfile')}
                  />
                </Row>

                <Cap>{t('Ресурспак и видимость')}</Cap>
                <Row k={t('Ссылка на ресурспак')}>
                  <TextField value={rules.resourcePack || ''} placeholder="https://…" busy={saving === 'resourcePack'} onSave={(v) => save({ resourcePack: v }, 'resourcePack')} />
                </Row>
                <Row k={t('SHA1 ресурспака')} sub={t('Без него клиент качает пак каждый вход')}>
                  <TextField value={rules.resourcePackSha1 || ''} placeholder="—" busy={saving === 'resourcePackSha1'} onSave={(v) => save({ resourcePackSha1: v }, 'resourcePackSha1')} />
                </Row>
                <Row k={t('Ресурспак обязателен')}>
                  <Toggle on={!!rules.requireResourcePack} busy={saving === 'requireResourcePack'} onChange={(v) => save({ requireResourcePack: v }, 'requireResourcePack')} />
                </Row>
                <Row k={t('Виден в списке серверов')}>
                  <Toggle on={rules.enableStatus !== false} busy={saving === 'enableStatus'} onChange={(v) => save({ enableStatus: v }, 'enableStatus')} />
                </Row>
                <Row k={t('Прятать список игроков')}>
                  <Toggle on={!!rules.hideOnlinePlayers} busy={saving === 'hideOnlinePlayers'} onChange={(v) => save({ hideOnlinePlayers: v }, 'hideOnlinePlayers')} />
                </Row>

              </div>
            ) : null}
            {cur.pendingRestart && cur.pendingRestart.length ? (
              <div className="hs-banner">
                <Icon id="i-restart" />
                <b>{t('Нужен перезапуск')}</b>
                {running ? (
                  <button className="btn sm secondary" disabled={busyPower} onClick={() => power('/restart', t('Перезапускаем…'), t('Перезапуск запущен'))}>
                    {t('Перезапустить')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'content' ? (
          <TabContent
            serverId={server.id}
            core={cur.core || ''}
            version={cur.version || ''}
            running={running}
            onChanged={() => {
              reload()
              onRefreshList()
            }}
          />
        ) : null}

        {tab === 'world' ? (
          <>
          <TabWorld
            serverId={server.id}
            running={running}
            full={cur.planFullAccess !== false}
            onTariff={() => setTab('plan')}
            onChanged={() => {
              reload()
              onRefreshList()
            }}
          />
          <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
              <div className="side-cap" style={{ padding: 0, flex: 1 }}>
                {t('Резервные копии')}
              </div>
              <button className="btn sm primary" onClick={runBackup}>
                <Icon id="i-plus" /> {t('Создать копию')}
              </button>
            </div>
            {backups.length ? (
              <div className="stack">
                {backups.map((b) => (
                  <div className="fr-row" key={b.id}>
                    <span className="host-ico" style={{ width: 34, height: 34 }}>
                      <Icon id="i-box2" />
                    </span>
                    <span className="fr-body">
                      <span className="fr-nick">{new Date(b.createdAt).toLocaleString(intlTag())}</span>
                      <span className="fr-status">
                        {b.sizeMb ? t('{n} ГБ', { n: gb(b.sizeMb) }) : '—'}
                        {b.status && b.status.toLowerCase() !== 'ready' ? ' · ' + (BACKUP_ST()[b.status.toLowerCase()] || b.status) : ''}
                        {b.locked ? ' · ' + t('защищена') : ''}
                      </span>
                    </span>
                    <button className="btn sm secondary" disabled={(b.status || '').toLowerCase() === 'pending'} onClick={() => restoreBackup(b)}>
                      <Icon id="i-restart" /> {t('Восстановить')}
                    </button>
                    {b.locked ? null : (
                      <button className="btn sm ghost" aria-label={t('Удалить копию')} data-tip={t('Удалить копию')} onClick={() => deleteBackup(b)}>
                        <Icon id="i-trash" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="i-box2" text={t('Копий пока нет')} />
            )}
          </div>
          </>
        ) : null}

        {tab === 'players' ? (
          <div className="card" style={{ padding: '18px' }}>
            <div className="side-cap" style={{ padding: '0 2px 8px' }}>
              {t('Сейчас на сервере — {n}', { n: online.length })}
            </div>
            {online.length ? (
              <div className="stack">
                {online.map((p) => (
                  <div className="fr-row" key={p.uuid || p.name}>
                    <Head nick={p.name} size={32} />
                    <span className="fr-body">
                      <span className="fr-nick">{p.name}</span>
                    </span>
                    {/* Семь одинаковых серых кнопок сливались в полосу. Теперь: что
                        сделать с игроком — тихие кнопки словами, наказания — иконками
                        в конце строки. */}
                    <span className="hs-row-acts">
                      <button className="btn sm ghost" onClick={() => playerAction(p.name, 'op', t('Выдаём права {nick}…', { nick: p.name }))}>
                        <Icon id="i-key" /> OP
                      </button>
                      <button className="btn sm ghost" onClick={() => playerAction(p.name, 'creative', t('Творческий для {nick}…', { nick: p.name }))}>
                        {t('Творческий')}
                      </button>
                      <button className="btn sm ghost" onClick={() => playerAction(p.name, 'survival', t('Выживание для {nick}…', { nick: p.name }))}>
                        {t('Выживание')}
                      </button>
                      <button className="btn sm ghost" onClick={() => playerAction(p.name, 'heal', t('Лечим {nick}…', { nick: p.name }))}>
                        {t('Лечить')}
                      </button>
                      <button className="btn sm ghost" onClick={() => playerAction(p.name, 'spawn', t('На спавн {nick}…', { nick: p.name }))}>
                        {t('На спавн')}
                      </button>
                      <button className="btn sm ghost" aria-label={t('Кикнуть')} data-tip={t('Кикнуть')} onClick={() => playerAction(p.name, 'kick', t('Кикаем {nick}…', { nick: p.name }))}>
                        <Icon id="i-logout" />
                      </button>
                      <button className="btn sm ghost hs-danger-ic" aria-label={t('Забанить')} data-tip={t('Забанить')} onClick={() => playerAction(p.name, 'ban', t('Баним {nick}…', { nick: p.name }))}>
                        <Icon id="i-ban" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon={running ? 'i-users' : 'i-power'} text={running ? t('Никого нет в игре') : t('Сервер выключен')} />
            )}

            <div className="side-cap" style={{ padding: '18px 2px 8px' }}>
              {t('Команда сервера')}
            </div>
            <div className="host-ask">
              <div className="input sm" style={{ flex: 1 }}>
                <input
                  placeholder={t('Ник в Minecraft')}
                  value={newPlayer}
                  onChange={(e) => setNewPlayer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addPlayer()}
                />
              </div>
              <button className="btn sm primary" disabled={!newPlayer.trim()} onClick={() => void addPlayer()}>
                <Icon id="i-plus" /> {t('Добавить')}
              </button>
            </div>
            {detail?.players && detail.players.length ? (
              <div className="stack" style={{ marginTop: '10px' }}>
                {detail.players.map((raw) => {
                  // Роль приходит заглавными (OWNER/ADMIN…); старые записи — строчными.
                  const p = { ...raw, role: (raw.role || '').toUpperCase() }
                  return (
                  <div className="fr-row" key={p.id}>
                    <Head nick={p.nickname} size={32} />
                    <span className="fr-body">
                      <span className="fr-nick">{p.nickname}</span>
                      <span className="fr-status">
                        {ROLE_LABEL()[p.role] || p.role}
                        {p.banned ? ' · ' + t('забанен') : ''}
                        {p.lastJoinAt ? ' · ' + t('заходил {date}', { date: new Date(p.lastJoinAt).toLocaleDateString(intlTag()) }) : ''}
                      </span>
                    </span>
                    {p.role !== 'OWNER' ? (
                      <>
                        <Select
                          value={p.role}
                          width={150}
                          options={[
                            { value: 'ADMIN', label: t('Админ') },
                            { value: 'MODERATOR', label: t('Модератор') },
                            { value: 'PLAYER', label: t('Игрок') },
                          ]}
                          onChange={(v) => void changeRole(p, v)}
                        />
                        <button
                          className="btn sm ghost"
                          aria-label={p.banned ? t('Разбанить') : t('Забанить')}
                          data-tip={p.banned ? t('Разбанить') : t('Забанить')}
                          onClick={() => void banRoster(p)}
                        >
                          <Icon id={p.banned ? 'i-check' : 'i-ban'} />
                        </button>
                        <button className="btn sm ghost" aria-label={t('Убрать из команды')} data-tip={t('Убрать из команды')} onClick={() => void removeRoster(p)}>
                          <Icon id="i-trash" />
                        </button>
                      </>
                    ) : null}
                  </div>
                  )
                })}
              </div>
            ) : (
              <Empty icon="i-users" text={t('Пока никого')} />
            )}
          </div>
        ) : null}

        {tab === 'console' ? (
          <div className="card" style={{ padding: '18px' }}>
            <div className="host-console" ref={logRef}>
              {log.length ? (
                log.map((l, i) => (
                  <div key={i} className={l.startsWith('>') ? 'cmd' : l.startsWith(LOG_ERR()) ? 'err' : logLevelClass(l)}>
                    {consoleParts(l).map((p, k) =>
                      p.link ? (
                        <a
                          key={k}
                          href={p.link}
                          className="console-link"
                          style={{ color: p.color, fontWeight: p.bold ? 700 : undefined }}
                          onClick={(e) => {
                            e.preventDefault()
                            if (hasTauri()) openUrl(p.link!)
                            else window.open(p.link!, '_blank', 'noopener')
                          }}
                        >
                          {p.text}
                        </a>
                      ) : (
                        <span key={k} style={{ color: p.color, fontWeight: p.bold ? 700 : undefined }}>
                          {p.text}
                        </span>
                      ),
                    )}
                  </div>
                ))
              ) : running && !hasTauri() ? (
                <Empty icon="i-monitor" text={t('Консоль — в приложении')} />
              ) : running ? (
                <div aria-busy="true">
                  {[62, 48, 71, 40].map((w, i) => (
                    <span key={i} className="skel skel-line" style={{ display: 'block', width: w + '%', margin: '6px 0' }}></span>
                  ))}
                </div>
              ) : (
                <Empty icon="i-power" text={t('Сервер выключен')} />
              )}
            </div>
            <div className="host-console-input">
              <div className="input sm" style={{ flex: 1 }}>
                <span style={{ color: 'var(--m-fg-faint)', fontWeight: 700 }}>/</span>
                <input
                  placeholder={t('команда сервера…')}
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendCmd()}
                />
              </div>
              <button className={'btn sm ' + (running ? 'primary' : 'secondary')} onClick={sendCmd} disabled={!running}>
                <Icon id="i-arrow-r" /> {t('Отправить')}
              </button>
            </div>
            <div className="hs-chips">
              {CMD_HINTS().map((c) => (
                <button key={c} className="hs-chip" onClick={() => setCmd(c)}>
                  <code>{c}</code>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {tab === 'files' ? (
          <TabFiles serverId={server.id} full={cur.planFullAccess !== false} onTariff={() => setTab('plan')} />
        ) : null}


        {tab === 'schedule' ? (
          <>
            <TabSchedule serverId={server.id} />
            <div style={{ marginTop: '14px' }}>
              <Journal serverId={server.id} />
            </div>
          </>
        ) : null}

        {tab === 'network' ? (
          <TabNetwork
            serverId={server.id}
            slug={cur.slug || ''}
            address={cur.address || ''}
            customDomain={detail?.customDomain ?? null}
            full={cur.planFullAccess !== false}
            onTariff={() => setTab('plan')}
            onChanged={() => {
              reload()
              onRefreshList()
            }}
          />
        ) : null}

        {tab === 'access' ? <TabAccess serverId={server.id} /> : null}

        {tab === 'plan' ? (
          <TabPlan
            serverId={server.id}
            planName={cur.planName}
            planCode={cur.planCode}
            planPriceKopecks={cur.planPriceKopecks}
            subscription={detail?.subscription ?? null}
            canDelete={detail?.canDelete}
            worldDeleteAt={cur.worldDeleteAt}
            onUpgrade={() => onUpgrade && onUpgrade(server.id, cur.planCode)}
            onDeleted={() => {
              onRefreshList()
              onBack()
            }}
            onChanged={() => {
              reload()
              onRefreshList()
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
