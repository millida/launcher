import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Icon } from '../components/Icon'
import { Select } from '../components/Select'
import { api } from '../lib/api'
import { track } from '../lib/telemetry'
import { consoleParts, logLevelClass } from '../lib/ansi'
import { showToast } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import { hostConsoleStart, hostConsoleStop, openUrl, pickTexture } from '../ipc/commands'
import { uiConfirm } from '../state/confirm'
import { listenHostConsole } from '../ipc/events'
import { usePolling } from '../lib/usePolling'
import type { HostServer } from './Hosting'
import { Head } from '../components/Head'
import { ApplyField, Cap, NumField, Row, Seg, TextField, Toggle } from './hosting/kit'
import { host, errText, P } from './hosting/api'
import type { HostingSubscription } from './hosting/api'
import { TabContent } from './hosting/TabContent'
import { TabWorld } from './hosting/TabWorld'
import { TabFiles } from './hosting/TabFiles'
import { TabSchedule } from './hosting/TabSchedule'
import { TabNetwork } from './hosting/TabNetwork'
import { TabAccess } from './hosting/TabAccess'
import { TabPlan } from './hosting/TabPlan'

// Console error prefix: a word, not a "⚠" dingbat (rule 5.1 — Lucide icons only).
// The .err class is applied by matching this same prefix.
const LOG_ERR = 'Ошибка: '

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

const HOST_ST: Record<string, [string, string]> = {
  RUNNING: ['Работает', 'acc'],
  STARTING: ['Запускается', 'warn'],
  STOPPING: ['Останавливается', 'warn'],
  STOPPED: ['Остановлен', 'off'],
  SUSPENDED: ['Приостановлен', 'danger'],
  QUEUED: ['В очереди', 'warn'],
  SLEEPING: ['Спит', 'off'],
  CRASHED: ['Упал', 'danger'],
  INSTALLING: ['Устанавливается', 'warn'],
}

const BACKUP_ST: Record<string, string> = {
  pending: 'собирается',
  ready: 'готова',
  failed: 'не собралась',
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'владелец',
  ADMIN: 'админ',
  MODERATOR: 'модератор',
  PLAYER: 'игрок',
}

const gb = (mb: number) => (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')

const JAVA_OPTIONS = [
  { value: '0', label: 'Автоматически' },
  { value: '8', label: 'Java 8' },
  { value: '11', label: 'Java 11' },
  { value: '16', label: 'Java 16' },
  { value: '17', label: 'Java 17' },
  { value: '21', label: 'Java 21' },
  { value: '25', label: 'Java 25' },
]

const clockAt = (msAgo: number) =>
  new Date(Date.now() - msAgo).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

function Sparkline({ data, stepMs = 5000 }: { data: number[]; stepMs?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const w = (cv.width = cv.clientWidth * 2)
    const h = (cv.height = cv.clientHeight * 2)
    const g = cv.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, w, h)
    const css = getComputedStyle(document.documentElement)
    const color = css.getPropertyValue('--m-accent').trim() || '#5EC64D'
    const grid = css.getPropertyValue('--m-border').trim() || 'rgba(255,255,255,.08)'

    g.strokeStyle = grid
    g.lineWidth = 1
    for (let k = 1; k < 4; k++) {
      const gy = (h / 4) * k
      g.beginPath()
      g.moveTo(0, gy)
      g.lineTo(w, gy)
      g.stroke()
    }
    if (data.length < 2) return

    const n = data.length
    const x = (i: number) => (i / (n - 1)) * w
    const y = (v: number) => h - (Math.max(0, Math.min(100, v)) / 100) * h * 0.9 - h * 0.05
    const fill = g.createLinearGradient(0, 0, 0, h)
    fill.addColorStop(0, color)
    fill.addColorStop(1, 'transparent')
    g.beginPath()
    data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))))
    g.lineTo(x(n - 1), h)
    g.lineTo(x(0), h)
    g.closePath()
    g.globalAlpha = 0.16
    g.fillStyle = fill
    g.fill()
    g.globalAlpha = 1
    g.beginPath()
    data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))))
    g.strokeStyle = color
    g.lineWidth = 3
    g.lineJoin = 'round'
    g.stroke()

    if (hover == null || hover >= n) return
    g.strokeStyle = color
    g.globalAlpha = 0.45
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(x(hover), 0)
    g.lineTo(x(hover), h)
    g.stroke()
    g.globalAlpha = 1
    g.beginPath()
    g.arc(x(hover), y(data[hover]), 7, 0, Math.PI * 2)
    g.fillStyle = color
    g.fill()
  }, [data, hover])

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (data.length < 2 || !box.width) return
    const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))
    setHover(Math.round(ratio * (data.length - 1)))
  }

  const tipLeft = hover != null && data.length > 1 ? (hover / (data.length - 1)) * 100 : 0
  return (
    <div className="host-spark" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <canvas ref={ref} />
      {hover != null && hover < data.length ? (
        <div
          className="host-spark-tip"
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
  if (!g) throw new Error('не удалось обработать картинку')
  g.imageSmoothingEnabled = false
  g.drawImage(img, 0, 0, 64, 64)
  return cv.toDataURL('image/png')
}

export function HostingManage({
  server,
  onBack,
  onRefreshList,
  onUpgrade,
}: {
  server: HostServer
  onBack: () => void
  onRefreshList: () => void
  onUpgrade?: (serverId: string, planCode?: string | null) => void
}) {
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
  const [crash, setCrash] = useState<{ reason: string | null; hint: { title: string; advice: string } | null; lines: string[] } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [log, setLog] = useState<string[]>([])

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
  }, [server.id])

  usePolling(
    () => {
      void api(P(server.id) + '/stats')
        .then((s: Stats) => {
          setStats(s)
          const mem = s.memoryLimitMb ? Math.min(100, (s.memoryUsedMb / s.memoryLimitMb) * 100) : 0
          setCpuHist((h) => [...h.slice(-47), Math.max(0, Math.min(100, s.cpuPercent))])
          setMemHist((h) => [...h.slice(-47), mem])
        })
        .catch(() => {})
    },
    5000,
    { hiddenMs: 0 },
  )

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
    if (tab === 'backups') loadBackups()
  }, [tab, server.id])

  const status = (detail || server).status || ''
  const st = HOST_ST[status] || ['—', 'off']
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
    let unlisten: (() => void) | null = null
    let alive = true
    listenHostConsole((line) => {
      setLog((l) => [...l.slice(-400), line])
      setTimeout(() => logRef.current?.scrollTo(0, 1e9), 20)
    }).then((u) => {
      if (!alive && u) u()
      else unlisten = u
    })
    void hostConsoleStart(server.id).catch(() => {})
    return () => {
      alive = false
      if (unlisten) unlisten()
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
      .catch((e) => showToast('Ошибка: ' + errText(e), 'error'))
      .finally(() => setBusyPower(false))
  }

  const save = (patch: Partial<Rules>, key: string) => {
    setSaving(key)
    track('hosting_action', { action: 'settings', field: key })
    api(P(server.id) + '/settings', { method: 'PATCH', body: JSON.stringify(patch) })
      .then(() => {
        showToast(running ? 'Сохранено — применится после перезапуска' : 'Настройки сохранены')
        reload()
      })
      .catch((e) => showToast('Не удалось сохранить: ' + errText(e), 'error'))
      .finally(() => setSaving(null))
  }

  const rename = async (name: string) => {
    setSaving('name')
    try {
      await host.rename(server.id, name)
      showToast('Сервер переименован')
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
      showToast('Смена иконки — в приложении', 'error')
      return
    }
    if ((detail || server) && detail?.iconLocked) {
      showToast('На бесплатном тарифе иконка наша — она же метка Millida', 'error')
      return
    }
    setSaving('icon')
    try {
      const picked = await pickTexture()
      if (!picked) return
      const icon = await iconFromDataUrl(picked.data)
      await host.setIcon(server.id, icon)
      showToast('Иконка обновлена')
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
      showToast('Иконка убрана')
      reload()
      onRefreshList()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setSaving(null)
    }
  }

  const playerAction = (nickname: string, action: string, label: string) => {
    track('hosting_action', { action })
    showToast(label + ' ' + nickname + '…')
    host
      .playerAction(server.id, nickname, action)
      .then(() => showToast('Готово'))
      .catch((e) => showToast('Ошибка: ' + errText(e), 'error'))
  }

  const addPlayer = async () => {
    const nick = newPlayer.trim()
    if (!nick) return
    try {
      await host.addPlayer(server.id, nick)
      setNewPlayer('')
      showToast(nick + ' добавлен в команду')
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
      showToast(p.banned ? 'Разбанен' : 'Забанен')
      reload()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const removeRoster = async (p: RosterPlayer) => {
    if (!(await uiConfirm('Убрать ' + p.nickname + ' из команды сервера?', { confirmLabel: 'Убрать' }))) return
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
    setLog((l) => [...l.slice(-200), '> ' + c])
    api(P(server.id) + '/console/command', { method: 'POST', body: JSON.stringify({ command: c }) })
      .then(() => {
        setCmd('')
        setTimeout(() => logRef.current?.scrollTo(0, 1e9), 30)
      })
      .catch((e) => {
        setLog((l) => [...l.slice(-200), LOG_ERR + 'команда не ушла — ' + errText(e)])
        showToast('Не удалось отправить команду', 'error')
      })
  }

  const runBackup = () => {
    track('hosting_action', { action: 'backup' })
    showToast('Создаём резервную копию…')
    api(P(server.id) + '/backups', { method: 'POST' })
      .then(() => {
        showToast('Копия ставится в очередь')
        setTimeout(loadBackups, 1500)
      })
      .catch((e) => showToast('Ошибка: ' + errText(e), 'error'))
  }

  const restoreBackup = async (b: Backup) => {
    if (
      !(await uiConfirm('Восстановить сервер из копии от ' + new Date(b.createdAt).toLocaleString('ru') + '? Текущий мир заменится.', {
        confirmLabel: 'Восстановить',
      }))
    )
      return
    track('hosting_action', { action: 'restore' })
    showToast('Восстанавливаем из копии…')
    api(P(server.id) + '/backups/' + b.id + '/restore', { method: 'POST' })
      .then(() => showToast('Восстановление запущено'))
      .catch((e) => showToast('Ошибка: ' + errText(e), 'error'))
  }

  const deleteBackup = async (b: Backup) => {
    if (!(await uiConfirm('Удалить копию безвозвратно?', { confirmLabel: 'Удалить' }))) return
    api(P(server.id) + '/backups/' + b.id, { method: 'DELETE' })
      .then(() => setBackups((arr) => arr.filter((x) => x.id !== b.id)))
      .catch((e) => showToast('Ошибка: ' + errText(e), 'error'))
  }

  const kill = async () => {
    if (!(await uiConfirm('Принудительно завершить процесс сервера? Несохранённые чанки потеряются.', { confirmLabel: 'Завершить' })))
      return
    try {
      await host.kill(server.id)
      showToast('Процесс завершён')
      setTimeout(() => {
        reload()
        onRefreshList()
      }, 1200)
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const TABS: [string, string, string][] = [
    ['overview', 'i-monitor', 'Обзор'],
    ['settings', 'i-settings', 'Настройки'],
    ['content', 'i-blocks', 'Ядро и сборки'],
    ['world', 'i-grid', 'Мир'],
    ['players', 'i-users', 'Игроки'],
    ['console', 'i-list', 'Консоль'],
    ['files', 'i-box', 'Файлы'],
    ['backups', 'i-box2', 'Копии'],
    ['schedule', 'i-clock', 'Расписание'],
    ['network', 'i-link', 'Сеть и домен'],
    ['access', 'i-key', 'Доступ'],
    ['plan', 'i-star', 'Тариф'],
  ]

  const memPct = stats && stats.memoryLimitMb ? Math.min(100, Math.round((stats.memoryUsedMb / stats.memoryLimitMb) * 100)) : 0
  const diskPct = stats && stats.diskLimitMb ? Math.min(100, Math.round((stats.diskUsedMb / stats.diskLimitMb) * 100)) : 0
  const cur = detail || server
  const maxSlots = server.planMaxPlayers && server.planMaxPlayers > 0 ? server.planMaxPlayers : 1000

  return (
    <div className="host-manage">
      <div className="host-manage-head">
        <button className="inst-back" onClick={onBack}>
          <Icon id="i-chev-l" /> К серверам
        </button>
        <h2>{cur.name || server.slug}</h2>
        <span className={'pill ' + st[1]}>
          <span className="dot"></span> {st[0]}
        </span>
        <span style={{ flex: 1 }}></span>
        {running ? (
          <>
            <button className="btn sm secondary" disabled={busyPower} onClick={() => power('/restart', 'Перезапускаем…', 'Перезапуск запущен')}>
              <Icon id="i-restart" /> Перезапустить
            </button>
            <button className="btn sm secondary" disabled={busyPower} onClick={() => power('/stop', 'Останавливаем…', 'Сервер остановлен')}>
              <Icon id="i-power" /> Остановить
            </button>
          </>
        ) : (
          <button className="btn sm primary" disabled={busyPower} onClick={() => power('/start', 'Запускаем…', 'Сервер запускается')}>
            <Icon id="i-play" /> Запустить
          </button>
        )}
      </div>

      <div className="segs host-manage-tabs">
        {TABS.map(([id, ic, label]) => (
          <button key={id} className={'seg' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>
            <Icon id={ic} /> {label}
          </button>
        ))}
      </div>

      <div className="host-manage-body">
        {tab === 'overview' ? (
          <div className="card" style={{ padding: '20px' }}>
            {crash ? (
              <div className="host-crash">
                <Icon id="i-alert" />
                <div>
                  <div className="host-crash-t">{crash.hint?.title || 'Сервер упал'}</div>
                  <div className="host-crash-s">{crash.hint?.advice || crash.reason || 'Посмотри консоль — там причина.'}</div>
                </div>
              </div>
            ) : null}
            <div className="kpi-row">
              <div className="kpi">
                <div className="cap">Память</div>
                <div className="val">
                  {stats ? (
                    <>
                      {gb(stats.memoryUsedMb)} <span>/ {gb(stats.memoryLimitMb)} ГБ</span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="bar">
                  <i style={{ width: memPct + '%' }}></i>
                </div>
              </div>
              <div className="kpi">
                <div className="cap">Процессор</div>
                <div className="val">{stats ? Math.round(stats.cpuPercent) + '%' : '—'}</div>
                <div className="bar">
                  <i style={{ width: (stats ? Math.min(100, stats.cpuPercent) : 0) + '%' }}></i>
                </div>
              </div>
              <div className="kpi">
                <div className="cap">Диск</div>
                <div className="val">
                  {stats ? (
                    <>
                      {gb(stats.diskUsedMb)} <span>/ {gb(stats.diskLimitMb)} ГБ</span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="bar">
                  <i style={{ width: diskPct + '%' }}></i>
                </div>
              </div>
            </div>

            {cpuHist.length > 1 ? (
              <div className="host-graphs">
                <div className="host-graph">
                  <div className="host-graph-head">
                    <span>Процессор</span>
                    <b>{stats ? Math.round(stats.cpuPercent) + '%' : '—'}</b>
                  </div>
                  <Sparkline data={cpuHist} />
                </div>
                <div className="host-graph">
                  <div className="host-graph-head">
                    <span>Память</span>
                    <b>{Math.round(memPct) + '%'}</b>
                  </div>
                  <Sparkline data={memHist} />
                </div>
              </div>
            ) : (
              <p className="faint-note" style={{ marginTop: '16px' }}>
                Собираем данные нагрузки — график появится через несколько секунд…
              </p>
            )}

            <div className="host-cfg" style={{ marginTop: '18px' }}>
              {cur.address ? (
                <div className="host-cfg-row">
                  <Icon id="i-link" />
                  <span className="host-cfg-k">Адрес</span>
                  <span className="host-cfg-v">{cur.address}</span>
                </div>
              ) : null}
              {cur.core ? (
                <div className="host-cfg-row">
                  <Icon id="i-blocks" />
                  <span className="host-cfg-k">Ядро</span>
                  <span className="host-cfg-v">
                    {cur.core} {cur.version || ''}
                  </span>
                </div>
              ) : null}
              {cur.planName || cur.planCode ? (
                <div className="host-cfg-row">
                  <Icon id="i-star" />
                  <span className="host-cfg-k">Тариф</span>
                  <span className="host-cfg-v">{cur.planName || cur.planCode}</span>
                </div>
              ) : null}
              <div className="host-cfg-row">
                <Icon id="i-users" />
                <span className="host-cfg-k">Игроки</span>
                <span className="host-cfg-v">
                  {(cur.playersOnline || 0) + (cur.maxPlayers ? ' / ' + cur.maxPlayers : '')}
                </span>
              </div>
            </div>

            {cur.pendingRestart && cur.pendingRestart.length ? (
              <p className="faint-note" style={{ marginTop: '14px' }}>
                Часть изменений применится после перезапуска сервера.
              </p>
            ) : null}

            {status === 'CRASHED' || status === 'STOPPING' || running ? (
              <div style={{ marginTop: '16px' }}>
                <button className="btn sm ghost" onClick={() => void kill()}>
                  <Icon id="i-power" /> Принудительно завершить
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="card set-group" style={{ padding: '10px 20px 18px' }}>
            <Cap first>Сервер</Cap>
            <Row k="Название" sub="Видно в списке серверов и в панели">
              <ApplyField value={cur.name || ''} label="Сохранить" busy={saving === 'name'} onApply={rename} />
            </Row>
            <Row k="Иконка" sub={detail?.iconLocked ? 'На бесплатном тарифе стоит логотип Millida' : 'PNG, приведём к 64×64'}>
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
                Выбрать
              </button>
              {cur.icon && !detail?.iconLocked ? (
                <button className="btn sm ghost" disabled={saving === 'icon'} onClick={() => void clearIcon()}>
                  Убрать
                </button>
              ) : null}
            </Row>
            <Row k="Описание в списке серверов">
              <TextField value={rules.motd || ''} placeholder={cur.name || 'Мой сервер'} busy={saving === 'motd'} onSave={(v) => save({ motd: v }, 'motd')} />
            </Row>
            <Row k="Вторая строка описания" sub={free ? 'На бесплатном тарифе занята подписью Millida' : undefined}>
              <TextField value={rules.motdLine2 || ''} placeholder="—" busy={saving === 'motdLine2' || free} onSave={(v) => save({ motdLine2: v }, 'motdLine2')} />
            </Row>

            <Cap>Режим игры</Cap>
            <Row k="Режим">
              <Seg
                value={rules.gamemode || 'survival'}
                busy={saving === 'gamemode'}
                options={[
                  ['survival', 'Выживание'],
                  ['creative', 'Творческий'],
                  ['adventure', 'Приключение'],
                ]}
                onPick={(v) => save({ gamemode: v }, 'gamemode')}
              />
            </Row>
            <Row k="Сложность">
              <Seg
                value={rules.difficulty || 'normal'}
                busy={saving === 'difficulty'}
                options={[
                  ['peaceful', 'Мирная'],
                  ['easy', 'Лёгкая'],
                  ['normal', 'Норм'],
                  ['hard', 'Сложная'],
                ]}
                onPick={(v) => save({ difficulty: v }, 'difficulty')}
              />
            </Row>
            <Row k="PvP" sub="Драки между игроками">
              <Toggle on={!!rules.pvp} busy={saving === 'pvp'} onChange={(v) => save({ pvp: v }, 'pvp')} />
            </Row>
            <Row k="Сохранять инвентарь" sub="Предметы остаются после смерти">
              <Toggle on={!!rules.keepInventory} busy={saving === 'keepInventory'} onChange={(v) => save({ keepInventory: v }, 'keepInventory')} />
            </Row>
            <Row k="Вечный день" sub="Ночь и фазы луны не наступают">
              <Toggle on={!!rules.alwaysDay} busy={saving === 'alwaysDay'} onChange={(v) => save({ alwaysDay: v }, 'alwaysDay')} />
            </Row>
            <Row k="Гриферство мобов" sub="Крипер ломает блоки, эндермен таскает">
              <Toggle on={rules.mobGriefing !== false} busy={saving === 'mobGriefing'} onChange={(v) => save({ mobGriefing: v }, 'mobGriefing')} />
            </Row>
            <Row k="Хардкор" sub="Одна жизнь на всех">
              <Toggle on={!!rules.hardcore} busy={saving === 'hardcore'} onChange={(v) => save({ hardcore: v }, 'hardcore')} />
            </Row>
            <Row k="Всем режим по умолчанию" sub="Принудительно возвращать режим при входе">
              <Toggle on={!!rules.forceGamemode} busy={saving === 'forceGamemode'} onChange={(v) => save({ forceGamemode: v }, 'forceGamemode')} />
            </Row>

            <Cap>Игроки и доступ</Cap>
            <Row k="Максимум игроков">
              <NumField
                value={rules.maxPlayers ?? (server.planMaxPlayers && server.planMaxPlayers > 0 ? server.planMaxPlayers : 20)}
                min={1}
                max={maxSlots}
                busy={saving === 'maxPlayers'}
                onSave={(v) => save({ maxPlayers: v }, 'maxPlayers')}
              />
            </Row>
            <Row k="Вайтлист" sub="Только приглашённые">
              <Toggle on={!!rules.whitelist} busy={saving === 'whitelist'} onChange={(v) => save({ whitelist: v }, 'whitelist')} />
            </Row>
            <Row k="Лицензия Mojang" sub="online-mode: пускать только по лицензии">
              <Toggle on={rules.onlineMode !== false} busy={saving === 'onlineMode'} onChange={(v) => save({ onlineMode: v }, 'onlineMode')} />
            </Row>
            {rules.onlineMode === false ? (
              <Row k="Авторизация Millida" sub="Пускать игроков Millida по нику">
                <Toggle on={rules.millidaAuth === true} busy={saving === 'millidaAuth'} onChange={(v) => save({ millidaAuth: v }, 'millidaAuth')} />
              </Row>
            ) : null}
            <Row k="Подписанный чат" sub="enforce-secure-profile: сообщения с подписью Mojang">
              <Toggle
                on={rules.enforceSecureProfile !== false}
                busy={saving === 'enforceSecureProfile'}
                onChange={(v) => save({ enforceSecureProfile: v }, 'enforceSecureProfile')}
              />
            </Row>
            <Row k="Кик за простой, минут" sub="0 — не кикать">
              <NumField value={rules.playerIdleTimeout ?? 0} min={0} max={180} busy={saving === 'playerIdleTimeout'} onSave={(v) => save({ playerIdleTimeout: v }, 'playerIdleTimeout')} />
            </Row>
            <Row k="Уровень прав оператора" sub="1–4, стандарт 4">
              <NumField value={rules.opPermissionLevel ?? 4} min={1} max={4} width="80px" busy={saving === 'opPermissionLevel'} onSave={(v) => save({ opPermissionLevel: v }, 'opPermissionLevel')} />
            </Row>
            <Row k="Уровень прав функций" sub="1–4, стандарт 2">
              <NumField value={rules.functionPermissionLevel ?? 2} min={1} max={4} width="80px" busy={saving === 'functionPermissionLevel'} onSave={(v) => save({ functionPermissionLevel: v }, 'functionPermissionLevel')} />
            </Row>
            <Row k="Команды видны операторам" sub="broadcast-console-to-ops">
              <Toggle on={rules.broadcastConsoleToOps !== false} busy={saving === 'broadcastConsoleToOps'} onChange={(v) => save({ broadcastConsoleToOps: v }, 'broadcastConsoleToOps')} />
            </Row>

            <Cap>Мир</Cap>
            <Row k="Тип мира">
              <Seg
                value={rules.levelType || 'normal'}
                busy={saving === 'levelType'}
                options={[
                  ['normal', 'Обычный'],
                  ['flat', 'Плоский'],
                  ['large_biomes', 'Большие биомы'],
                  ['amplified', 'Гористый'],
                ]}
                onPick={(v) => save({ levelType: v }, 'levelType')}
              />
            </Row>
            <Row k="Сид мира" sub="Пусто — случайный">
              <TextField value={rules.levelSeed || ''} placeholder="случайный" busy={saving === 'levelSeed'} onSave={(v) => save({ levelSeed: v }, 'levelSeed')} />
            </Row>
            <Row k="Папка мира" sub="level-name: имя каталога с миром">
              <TextField value={rules.levelName || ''} placeholder="world" busy={saving === 'levelName'} onSave={(v) => save({ levelName: v }, 'levelName')} />
            </Row>
            <Row k="Граница мира, блоков" sub="0 — без ограничения">
              <NumField value={rules.worldBorder ?? 0} min={0} max={100000} busy={saving === 'worldBorder'} onSave={(v) => save({ worldBorder: v }, 'worldBorder')} />
            </Row>
            <Row k="Ад и Край">
              <Toggle on={rules.allowNether !== false} busy={saving === 'allowNether'} onChange={(v) => save({ allowNether: v }, 'allowNether')} />
            </Row>
            <Row k="Деревни и постройки" sub="generate-structures">
              <Toggle on={rules.generateStructures !== false} busy={saving === 'generateStructures'} onChange={(v) => save({ generateStructures: v }, 'generateStructures')} />
            </Row>
            <Row k="Монстры">
              <Toggle on={rules.spawnMonsters !== false} busy={saving === 'spawnMonsters'} onChange={(v) => save({ spawnMonsters: v }, 'spawnMonsters')} />
            </Row>
            <Row k="Животные">
              <Toggle on={rules.spawnAnimals !== false} busy={saving === 'spawnAnimals'} onChange={(v) => save({ spawnAnimals: v }, 'spawnAnimals')} />
            </Row>
            <Row k="Жители деревень">
              <Toggle on={rules.spawnNpcs !== false} busy={saving === 'spawnNpcs'} onChange={(v) => save({ spawnNpcs: v }, 'spawnNpcs')} />
            </Row>
            <Row k="Защита спавна" sub="Блоков вокруг точки появления">
              <NumField value={rules.spawnProtection ?? 0} min={0} max={10000} busy={saving === 'spawnProtection'} onSave={(v) => save({ spawnProtection: v }, 'spawnProtection')} />
            </Row>
            <Row k="Полёт" sub="Разрешить моды/плагины полёта">
              <Toggle on={!!rules.allowFlight} busy={saving === 'allowFlight'} onChange={(v) => save({ allowFlight: v }, 'allowFlight')} />
            </Row>
            <Row k="Командные блоки">
              <Toggle on={!!rules.commandBlocks} busy={saving === 'commandBlocks'} onChange={(v) => save({ commandBlocks: v }, 'commandBlocks')} />
            </Row>

            <Cap>Производительность</Cap>
            <Row k="Дальность прорисовки" sub="Чанки, влияет на нагрузку сильнее всего">
              <NumField value={rules.viewDistance ?? 10} min={3} max={32} busy={saving === 'viewDistance'} onSave={(v) => save({ viewDistance: v }, 'viewDistance')} />
            </Row>
            <Row k="Дальность активности" sub="simulation-distance">
              <NumField value={rules.simulationDistance ?? 10} min={3} max={32} busy={saving === 'simulationDistance'} onSave={(v) => save({ simulationDistance: v }, 'simulationDistance')} />
            </Row>
            <Row k="Видимость сущностей, %" sub="entity-broadcast-range-percentage">
              <NumField value={rules.entityBroadcastRange ?? 100} min={10} max={1000} busy={saving === 'entityBroadcastRange'} onSave={(v) => save({ entityBroadcastRange: v }, 'entityBroadcastRange')} />
            </Row>
            <Row k="Сжатие пакетов, байт" sub="-1 — выключить">
              <NumField value={rules.networkCompressionThreshold ?? 256} min={-1} max={65536} busy={saving === 'networkCompressionThreshold'} onSave={(v) => save({ networkCompressionThreshold: v }, 'networkCompressionThreshold')} />
            </Row>
            <Row k="Watchdog, мс" sub="max-tick-time, -1 — выключить">
              <NumField value={rules.maxTickTime ?? 60000} min={-1} max={600000} width="130px" busy={saving === 'maxTickTime'} onSave={(v) => save({ maxTickTime: v }, 'maxTickTime')} />
            </Row>
            <Row k="Антифлуд, пакетов/с" sub="0 — выключить">
              <NumField value={rules.rateLimit ?? 0} min={0} max={10000} busy={saving === 'rateLimit'} onSave={(v) => save({ rateLimit: v }, 'rateLimit')} />
            </Row>
            <Row k="Синхронная запись чанков" sub="Надёжнее при сбое питания, но медленнее">
              <Toggle on={!!rules.syncChunkWrites} busy={saving === 'syncChunkWrites'} onChange={(v) => save({ syncChunkWrites: v }, 'syncChunkWrites')} />
            </Row>
            <Row k="Оптимизированная сеть" sub="use-native-transport">
              <Toggle on={rules.useNativeTransport !== false} busy={saving === 'useNativeTransport'} onChange={(v) => save({ useNativeTransport: v }, 'useNativeTransport')} />
            </Row>
            <Row k="Фантомы только к бессонным" sub="Paper: не трогают тех, кто спит">
              <Toggle on={!!rules.paperNoPhantoms} busy={saving === 'paperNoPhantoms'} onChange={(v) => save({ paperNoPhantoms: v }, 'paperNoPhantoms')} />
            </Row>
            <Row k="Anti-Xray" sub="Paper: прячет руды от читерских клиентов">
              <Toggle on={!!rules.paperAntiXray} busy={saving === 'paperAntiXray'} onChange={(v) => save({ paperAntiXray: v }, 'paperAntiXray')} />
            </Row>

            <Cap>Java</Cap>
            <Row k="Версия Java" sub="Автоматически — подберём под версию игры">
              <Select
                value={String(rules.javaVersion || 0)}
                options={JAVA_OPTIONS}
                width={180}
                disabled={saving === 'javaVersion'}
                onChange={(v) => save({ javaVersion: Number(v) || undefined }, 'javaVersion')}
              />
            </Row>
            <Row k="Флаги JVM" sub="Общий профиль подходит почти всем">
              <Seg
                value={rules.jvmProfile || 'shared'}
                busy={saving === 'jvmProfile'}
                options={[
                  ['shared', 'Общий'],
                  ['aikar', 'Aikar'],
                  ['vanilla', 'Без флагов'],
                ]}
                onPick={(v) => save({ jvmProfile: v }, 'jvmProfile')}
              />
            </Row>

            <Cap>Ресурспак и видимость</Cap>
            <Row k="Ссылка на ресурспак">
              <TextField value={rules.resourcePack || ''} placeholder="https://…" busy={saving === 'resourcePack'} onSave={(v) => save({ resourcePack: v }, 'resourcePack')} />
            </Row>
            <Row k="SHA1 ресурспака" sub="Без него клиент качает пак каждый вход">
              <TextField value={rules.resourcePackSha1 || ''} placeholder="—" busy={saving === 'resourcePackSha1'} onSave={(v) => save({ resourcePackSha1: v }, 'resourcePackSha1')} />
            </Row>
            <Row k="Ресурспак обязателен">
              <Toggle on={!!rules.requireResourcePack} busy={saving === 'requireResourcePack'} onChange={(v) => save({ requireResourcePack: v }, 'requireResourcePack')} />
            </Row>
            <Row k="Отвечать на пинг" sub="enable-status: сервер виден в списке">
              <Toggle on={rules.enableStatus !== false} busy={saving === 'enableStatus'} onChange={(v) => save({ enableStatus: v }, 'enableStatus')} />
            </Row>
            <Row k="Прятать список игроков">
              <Toggle on={!!rules.hideOnlinePlayers} busy={saving === 'hideOnlinePlayers'} onChange={(v) => save({ hideOnlinePlayers: v }, 'hideOnlinePlayers')} />
            </Row>

            {cur.pendingRestart && cur.pendingRestart.length ? (
              <p className="faint-note" style={{ marginTop: '14px' }}>
                Часть изменений применится после перезапуска сервера.
              </p>
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
        ) : null}

        {tab === 'players' ? (
          <div className="card" style={{ padding: '18px' }}>
            <div className="side-cap" style={{ padding: '0 2px 8px' }}>
              Сейчас на сервере — {online.length}
            </div>
            {online.length ? (
              <div className="stack">
                {online.map((p) => (
                  <div className="fr-row" key={p.uuid || p.name}>
                    <Head nick={p.name} size={32} />
                    <span className="fr-body">
                      <span className="fr-nick">{p.name}</span>
                    </span>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'op', 'Выдаём права')}>
                      <Icon id="i-key" /> OP
                    </button>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'creative', 'Творческий для')}>
                      Творческий
                    </button>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'survival', 'Выживание для')}>
                      Выживание
                    </button>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'heal', 'Лечим')}>
                      Лечить
                    </button>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'spawn', 'На спавн')}>
                      На спавн
                    </button>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'kick', 'Кикаем')}>
                      <Icon id="i-logout" /> Кик
                    </button>
                    <button className="btn sm secondary" onClick={() => playerAction(p.name, 'ban', 'Баним')}>
                      <Icon id="i-shield" /> Бан
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint-note">
                {running ? 'Пока никто не в игре.' : 'Сервер выключен — запусти, чтобы видеть игроков.'}
              </p>
            )}

            <div className="side-cap" style={{ padding: '18px 2px 8px' }}>
              Команда сервера
            </div>
            <div className="host-ask">
              <div className="input sm" style={{ flex: 1 }}>
                <input
                  placeholder="Ник в Minecraft"
                  value={newPlayer}
                  onChange={(e) => setNewPlayer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addPlayer()}
                />
              </div>
              <button className="btn sm secondary" disabled={!newPlayer.trim()} onClick={() => void addPlayer()}>
                <Icon id="i-plus" /> Добавить
              </button>
            </div>
            {detail?.players && detail.players.length ? (
              <div className="stack" style={{ marginTop: '10px' }}>
                {detail.players.map((p) => (
                  <div className="fr-row" key={p.id}>
                    <Head nick={p.nickname} size={32} />
                    <span className="fr-body">
                      <span className="fr-nick">{p.nickname}</span>
                      <span className="fr-status">
                        {ROLE_LABEL[p.role] || p.role}
                        {p.banned ? ' · забанен' : ''}
                        {p.lastJoinAt ? ' · заходил ' + new Date(p.lastJoinAt).toLocaleDateString('ru-RU') : ''}
                      </span>
                    </span>
                    {p.role !== 'OWNER' ? (
                      <>
                        <Select
                          value={p.role}
                          width={150}
                          options={[
                            { value: 'ADMIN', label: 'Админ' },
                            { value: 'MODERATOR', label: 'Модератор' },
                            { value: 'PLAYER', label: 'Игрок' },
                          ]}
                          onChange={(v) => void changeRole(p, v)}
                        />
                        <button className="btn sm ghost" title={p.banned ? 'Разбанить' : 'Забанить'} onClick={() => void banRoster(p)}>
                          <Icon id={p.banned ? 'i-check' : 'i-ban'} />
                        </button>
                        <button className="btn sm ghost" title="Убрать" onClick={() => void removeRoster(p)}>
                          <Icon id="i-trash" />
                        </button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint-note">Пока никого. Добавь ник — игрок попадёт в вайтлист и получит роль.</p>
            )}
          </div>
        ) : null}

        {tab === 'console' ? (
          <div className="card" style={{ padding: '18px' }}>
            <div className="host-console" ref={logRef}>
              {log.length ? (
                log.map((l, i) => (
                  <div key={i} className={l.startsWith('>') ? 'cmd' : l.startsWith(LOG_ERR) ? 'err' : logLevelClass(l)}>
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
              ) : (
                <div className="faint-note">
                  {running ? 'Подключаемся к консоли сервера…' : 'Сервер выключен — запусти, чтобы видеть живой вывод.'}
                  <br />
                  Команды: <code>say привет</code>, <code>time set day</code>, <code>weather clear</code>.
                </div>
              )}
            </div>
            <div className="host-console-input">
              <div className="input sm" style={{ flex: 1 }}>
                <span style={{ color: 'var(--m-fg-faint)', fontWeight: 700 }}>/</span>
                <input
                  placeholder="команда сервера…"
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendCmd()}
                />
              </div>
              <button className="btn sm primary" onClick={sendCmd} disabled={!running}>
                <Icon id="i-arrow-r" /> Отправить
              </button>
            </div>
            {!running ? <p className="faint-note" style={{ marginTop: '8px' }}>Запусти сервер, чтобы отправлять команды.</p> : null}
          </div>
        ) : null}

        {tab === 'files' ? (
          <TabFiles serverId={server.id} full={cur.planFullAccess !== false} onTariff={() => setTab('plan')} />
        ) : null}

        {tab === 'backups' ? (
          <div className="card" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
              <div className="side-cap" style={{ padding: 0, flex: 1 }}>
                Резервные копии
              </div>
              <button className="btn sm primary" onClick={runBackup}>
                <Icon id="i-plus" /> Создать копию
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
                      <span className="fr-nick">{new Date(b.createdAt).toLocaleString('ru')}</span>
                      <span className="fr-status">
                        {b.sizeMb ? gb(b.sizeMb) + ' ГБ' : '—'}
                        {b.status && b.status !== 'ready' ? ' · ' + (BACKUP_ST[b.status] || b.status) : ''}
                        {b.locked ? ' · защищена' : ''}
                      </span>
                    </span>
                    <button className="btn sm secondary" disabled={b.status === 'pending'} onClick={() => restoreBackup(b)}>
                      <Icon id="i-restart" /> Восстановить
                    </button>
                    {b.locked ? null : (
                      <button className="btn sm secondary" onClick={() => deleteBackup(b)}>
                        <Icon id="i-trash" /> Удалить
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="faint-note">Копий пока нет. Создай первую — вернёшь мир в один клик.</p>
            )}
          </div>
        ) : null}

        {tab === 'schedule' ? <TabSchedule serverId={server.id} /> : null}

        {tab === 'network' ? (
          <TabNetwork
            serverId={server.id}
            slug={cur.slug || ''}
            address={cur.address || ''}
            customDomain={detail?.customDomain ?? null}
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
