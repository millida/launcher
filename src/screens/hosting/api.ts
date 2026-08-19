import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiError'

export const P = (id: string) => '/hosting/servers/' + encodeURIComponent(id)

export const errText = (e: unknown) => apiErrorText(e, 'Сервис хостинга не ответил, попробуй позже')

export interface CatalogCore {
  id: string
  name: string
  task: string
  family: 'vanilla' | 'plugins' | 'mods' | 'proxy'
  recommended: boolean
  versions: string[]
  latest: string | null
}

export interface CatalogHit {
  id: string
  slug: string
  name: string
  summary: string
  iconUrl: string | null
  downloads: number
  author: string
  categories: string[]
  versions: string[]
  latestVersion: string | null
  serverSide: string
  projectType: string
}

export interface CurseHit {
  id: number
  slug: string
  name: string
  summary: string
  iconUrl: string | null
  downloads: number
  classId: number
  source: 'curseforge'
}

export interface FtbVersion {
  id: number
  name: string
  channel: string
  minRamMb: number
  recommendedRamMb: number
  gameVersion: string | null
  loader: string | null
}

export interface FtbPack {
  id: number
  name: string
  summary: string
  iconUrl: string | null
  installs: number
  tags: string[]
  versions: FtbVersion[]
}

export interface HostingInstall {
  id: string
  kind: 'MOD' | 'PLUGIN' | 'MODPACK' | 'DATAPACK' | 'MAP'
  source: string
  projectId: string
  versionId: string | null
  name: string
  versionName: string | null
  iconUrl: string | null
  status: 'PENDING' | 'INSTALLED' | 'FAILED'
  error: string | null
  createdAt: string
}

export interface InstallUpdate {
  installId: string
  name: string
  current: string | null
  latest: string | null
  latestVersionId: string | null
  updateAvailable: boolean
  compatible: boolean
}

export interface HostingWorld {
  name: string
  sizeMb: number
  dimension: boolean
  active: boolean
}

export interface HostingFileEntry {
  name: string
  size: number
  dir: boolean
  modTime: string
}

export interface HostingScheduleStep {
  kind: ScheduleKind
  delaySec: number
  command?: string
}

export type ScheduleKind = 'restart' | 'command' | 'stop' | 'backup'

export interface HostingSchedule {
  id: string
  kind: ScheduleKind
  enabled: boolean
  minute: number
  days: number
  command?: string
  steps?: HostingScheduleStep[]
  lastRunAt?: string
}

export interface HostingDatabaseInfo {
  host: string
  port: number
  database: string
  user: string
  password: string
  createdAt: string
}

export interface HostingSftp {
  active: boolean
  host: string | null
  port: number
  login: string
  expiresAt: string | null
}

export interface HostingSftpCredentials {
  host: string
  port: number
  login: string
  password: string
  expiresAt: string
}

export interface HostingShare {
  userId: string
  email: string | null
  nickname: string | null
  permissions: string[]
  createdAt: string
}

export interface HostingApiKey {
  id: string
  name: string
  prefix: string
  permissions: string[]
  lastUsedAt: string | null
  createdAt: string
}

export interface HostingEvent {
  id: string
  kind: string
  message: string | null
  actorLabel?: string | null
  createdAt: string
}

export interface HostingFeatures {
  compatible: boolean
  core: string
  bedrock: { enabled: boolean; address: string | null; port: number | null }
  map: { enabled: boolean; url: string | null; port: number | null }
}

export interface HostingUsage {
  days: number
  points: { date: string; runningMinutes: number; peakPlayers: number; crashes: number }[]
  summary: { runningHours: number; ramGbHours: number; peakPlayers: number; crashes: number; uptimePercent: number }
}

export interface HostingSubscription {
  status: string
  autoRenew: boolean
  paidUntil: string
  periodDays: number
  priceKopecks: number
}

export const HOST_PERMISSIONS: [string, string][] = [
  ['control', 'Запуск и остановка'],
  ['console', 'Консоль и команды'],
  ['settings', 'Настройки сервера'],
  ['content', 'Плагины, моды и версия'],
  ['players', 'Игроки, баны и вайтлист'],
  ['world', 'Мир: скачать и пересоздать'],
  ['backups', 'Резервные копии'],
  ['files', 'Файлы и конфиги'],
  ['database', 'База данных'],
  ['network', 'Адрес, домен и порты'],
  ['schedule', 'Расписание'],
]

export const NOTIFY_EVENTS: [string, string][] = [
  ['crash', 'Сервер упал'],
  ['sleep', 'Сервер уснул'],
  ['wake', 'Сервер проснулся'],
  ['backup_ok', 'Копия создана'],
  ['backup_fail', 'Копию сделать не удалось'],
  ['plan_expiring', 'Тариф кончается'],
  ['suspended', 'Приостановлен за неоплату'],
  ['world_delete', 'Мир будет удалён'],
]

export const NOTIFY_CHANNELS: [string, string][] = [
  ['telegram', 'Telegram'],
  ['discord', 'Discord'],
  ['email', 'Почта'],
]

export const host = {
  cores: () => api<{ cores: CatalogCore[]; stale: boolean }>('/hosting/catalog/cores'),

  search: (params: { type: string; query?: string; loader?: string; version?: string; sort?: string; offset?: number }) => {
    const qs = new URLSearchParams({ type: params.type })
    if (params.query) qs.set('query', params.query)
    if (params.loader) qs.set('loader', params.loader)
    if (params.version) qs.set('version', params.version)
    if (params.sort) qs.set('sort', params.sort)
    if (params.offset) qs.set('offset', String(params.offset))
    return api<{ hits: CatalogHit[]; total: number; nextOffset: number; hasMore: boolean }>(
      '/hosting/catalog/search?' + qs.toString(),
    )
  },

  searchCurse: (params: { type: string; query?: string; loader?: string; version?: string; offset?: number }) => {
    const qs = new URLSearchParams({ type: params.type })
    if (params.query) qs.set('query', params.query)
    if (params.loader) qs.set('loader', params.loader)
    if (params.version) qs.set('version', params.version)
    if (params.offset) qs.set('offset', String(params.offset))
    return api<{ hits: CurseHit[]; enabled: boolean; hasMore: boolean; nextOffset: number }>(
      '/hosting/catalog/curseforge?' + qs.toString(),
    )
  },

  searchFtb: (query?: string) =>
    api<{ packs: FtbPack[]; stale: boolean }>('/hosting/catalog/ftb' + (query ? '?query=' + encodeURIComponent(query) : '')),

  ftbPack: (packId: number) => api<FtbPack>('/hosting/catalog/ftb/' + packId),

  changeCore: (id: string, body: { core?: string; version?: string }) =>
    api(P(id) + '/core', { method: 'PATCH', body: JSON.stringify(body) }),

  installs: (id: string) => api<HostingInstall[]>(P(id) + '/installs'),

  install: (id: string, body: { projectId: string; versionId?: string; source?: string }) =>
    api<HostingInstall>(P(id) + '/installs', { method: 'POST', body: JSON.stringify(body) }),

  removeInstall: (id: string, installId: string) =>
    api(P(id) + '/installs/' + encodeURIComponent(installId), { method: 'DELETE' }),

  installUpdates: (id: string) => api<InstallUpdate[]>(P(id) + '/installs/updates'),

  worlds: (id: string) => api<HostingWorld[]>(P(id) + '/worlds'),

  switchWorld: (id: string, name: string) =>
    api(P(id) + '/worlds/switch', { method: 'POST', body: JSON.stringify({ name }) }),

  importWorld: (id: string, path: string, name: string) =>
    api(P(id) + '/worlds/import', { method: 'POST', body: JSON.stringify({ path, name }) }),

  regenerateWorld: (id: string) => api(P(id) + '/world/regenerate', { method: 'POST' }),

  reinstall: (id: string) => api(P(id) + '/reinstall', { method: 'POST' }),

  features: (id: string) => api<HostingFeatures>(P(id) + '/features'),

  enableFeature: (id: string, feature: 'bedrock' | 'map') =>
    api<{ enabled: boolean; address: string; port: number | null; note: string }>(P(id) + '/features/' + feature, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  disableFeature: (id: string, feature: 'bedrock' | 'map') =>
    api(P(id) + '/features/' + feature, { method: 'DELETE' }),

  files: (id: string, path: string) => api<HostingFileEntry[]>(P(id) + '/files?path=' + encodeURIComponent(path)),

  readFile: (id: string, path: string) =>
    api<{ path: string; content: string }>(P(id) + '/files/content?path=' + encodeURIComponent(path)),

  writeFile: (id: string, path: string, content: string) =>
    api(P(id) + '/files/content?path=' + encodeURIComponent(path), { method: 'PUT', body: JSON.stringify({ content }) }),

  mkdir: (id: string, path: string) =>
    api(P(id) + '/files/mkdir?path=' + encodeURIComponent(path), { method: 'POST', body: JSON.stringify({}) }),

  deleteFile: (id: string, path: string) =>
    api(P(id) + '/files?path=' + encodeURIComponent(path), { method: 'DELETE' }),

  renameFile: (id: string, from: string, to: string) =>
    api(P(id) + '/files/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),

  extractFile: (id: string, path: string, dest = '.') =>
    api(P(id) + '/files/extract', { method: 'POST', body: JSON.stringify({ path, dest }) }),

  schedules: (id: string) => api<HostingSchedule[]>(P(id) + '/schedules'),

  saveSchedules: (id: string, schedules: HostingSchedule[]) =>
    api<HostingSchedule[]>(P(id) + '/schedules', { method: 'PUT', body: JSON.stringify({ schedules }) }),

  ports: (id: string) =>
    api<{ ports: { port: number; note?: string }[]; limit: number; address: string }>(P(id) + '/ports'),

  addPort: (id: string, note?: string) =>
    api<{ port: number; address: string }>(P(id) + '/ports', { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),

  removePort: (id: string, port: number) => api(P(id) + '/ports/' + port, { method: 'DELETE' }),

  database: (id: string) => api<HostingDatabaseInfo | null>(P(id) + '/database'),

  createDatabase: (id: string) => api<HostingDatabaseInfo>(P(id) + '/database', { method: 'POST' }),

  dropDatabase: (id: string) => api(P(id) + '/database', { method: 'DELETE' }),

  sftp: (id: string) => api<HostingSftp>(P(id) + '/sftp'),

  issueSftp: (id: string) => api<HostingSftpCredentials>(P(id) + '/sftp', { method: 'POST', body: JSON.stringify({}) }),

  revokeSftp: (id: string) => api(P(id) + '/sftp', { method: 'DELETE' }),

  shares: (id: string) => api<HostingShare[]>(P(id) + '/shares'),

  addShare: (id: string, email: string, permissions: string[]) =>
    api<HostingShare[]>(P(id) + '/shares', { method: 'POST', body: JSON.stringify({ email, permissions }) }),

  updateShare: (id: string, userId: string, permissions: string[]) =>
    api<HostingShare[]>(P(id) + '/shares/' + encodeURIComponent(userId), {
      method: 'PATCH',
      body: JSON.stringify({ permissions }),
    }),

  removeShare: (id: string, userId: string) =>
    api<HostingShare[]>(P(id) + '/shares/' + encodeURIComponent(userId), { method: 'DELETE' }),

  apiKeys: (id: string) => api<HostingApiKey[]>(P(id) + '/api-keys'),

  createApiKey: (id: string, name: string, permissions: string[]) =>
    api<{ id: string; token: string }>(P(id) + '/api-keys', { method: 'POST', body: JSON.stringify({ name, permissions }) }),

  revokeApiKey: (id: string, keyId: string) =>
    api(P(id) + '/api-keys/' + encodeURIComponent(keyId), { method: 'DELETE' }),

  notifyPrefs: (id: string) => api<{ events: Record<string, string[]> }>(P(id) + '/notifications'),

  setNotifyPrefs: (id: string, events: Record<string, string[]>) =>
    api<{ events: Record<string, string[]> }>(P(id) + '/notifications', {
      method: 'PUT',
      body: JSON.stringify({ events }),
    }),

  events: (id: string, limit = 30) => api<HostingEvent[]>(P(id) + '/events?limit=' + limit),

  usage: (id: string, days = 30) => api<HostingUsage>(P(id) + '/usage?days=' + days),

  rename: (id: string, name: string) => api(P(id) + '/name', { method: 'PATCH', body: JSON.stringify({ name }) }),

  changeAddress: (id: string, slug: string) =>
    api(P(id) + '/address', { method: 'PATCH', body: JSON.stringify({ slug }) }),

  setDomain: (id: string, domain: string) =>
    api<{ dnsTarget: string }>(P(id) + '/domain', { method: 'PATCH', body: JSON.stringify({ domain }) }),

  setIcon: (id: string, icon: string | null) =>
    api(P(id) + '/icon', { method: 'POST', body: JSON.stringify({ icon }) }),

  setAutoRenew: (id: string, enabled: boolean) =>
    api<{ autoRenew: boolean; paidUntil: string }>(P(id) + '/plan/auto-renew', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  remove: (id: string) => api(P(id), { method: 'DELETE' }),

  addPlayer: (id: string, nickname: string, role?: string) =>
    api(P(id) + '/players', { method: 'POST', body: JSON.stringify(role ? { nickname, role } : { nickname }) }),

  removePlayer: (id: string, playerId: string) =>
    api(P(id) + '/players/' + encodeURIComponent(playerId), { method: 'DELETE' }),

  changeRole: (id: string, playerId: string, role: string) =>
    api(P(id) + '/players/' + encodeURIComponent(playerId) + '/role', {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  banPlayer: (id: string, playerId: string, banned: boolean) =>
    api(P(id) + '/players/' + encodeURIComponent(playerId) + '/ban', {
      method: 'POST',
      body: JSON.stringify({ banned }),
    }),

  playerAction: (id: string, nickname: string, action: string, reason?: string) =>
    api(P(id) + '/online/action', {
      method: 'POST',
      body: JSON.stringify(reason ? { nickname, action, reason } : { nickname, action }),
    }),

  kill: (id: string) => api(P(id) + '/kill', { method: 'POST' }),

  crash: (id: string) =>
    api<{ reason: string | null; hint: { title: string; advice: string } | null; lines: string[] }>(P(id) + '/crash'),
}
