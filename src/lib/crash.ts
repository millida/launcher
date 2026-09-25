import { api } from './api'
import { hasTauri } from '../ipc/tauri'
import {
  appVersion,
  readCrashes,
  clearCrashes,
  defaultJava,
  deviceSpecs,
  listJavaRuntimes,
  loadProfileSettings,
  onCoreFailure,
  testJava,
  tuneProfile,
} from '../ipc/commands'
import type { DeviceSpecs, JavaRuntime, Profile, ProfileSettings } from '../ipc/commands'
import type { CrashInfo } from '../ipc/events'
import { isUserEnvironmentError } from './userEnvError'
import { telemetryEnabled } from './telemetry'
import { buildTag, shortHash } from './telemetryPrivacy'
import {
  createReportGate,
  errorText,
  expectedFailure,
  failureDetails,
  failureMessage,
  gameCrashMessage,
  installTarget,
  javaMajorOf,
  maskValues,
  ramChoice,
  redactSecrets,
  safeArgs,
  tailForReport,
} from './errorReport'
import type { ReportChannel } from './errorReport'

const RELEASE = 'launcher'

interface ErrorReport {
  source: 'LAUNCHER'
  level: 'WARN' | 'ERROR' | 'FATAL'
  name?: string
  message: string
  stack?: string
  release?: string
  url?: string
  context?: Record<string, unknown>
}

let version = ''
let sent = 0

export interface RecentIssue {
  at: number
  kind: 'error' | 'crash'
  text: string
}

const MAX_ISSUES = 20
const ISSUE_TEXT_MAX = 300
const issues: RecentIssue[] = []

function remember(kind: RecentIssue['kind'], text: string) {
  issues.push({ at: Date.now(), kind, text: text.trim().slice(0, ISSUE_TEXT_MAX) })
  if (issues.length > MAX_ISSUES) issues.shift()
}

export function recentIssues(): RecentIssue[] {
  return issues.slice()
}

// Единственная дверь наружу для отчётов об ошибках: отказ от телеметрии
// выключает их все, а текст и стек уходят без путей с именем пользователя и
// без токенов (аудит 24.09.2026, CORE-9).
async function send(body: ErrorReport) {
  if (!telemetryEnabled()) return
  const clean: ErrorReport = {
    ...body,
    message: redactSecrets(body.message),
    stack: body.stack ? redactSecrets(body.stack) : undefined,
    url: body.url ? redactSecrets(body.url) : undefined,
  }
  try {
    await api('/errors', { method: 'POST', body: JSON.stringify(clean) })
  } catch {}
}

async function post(body: ErrorReport) {
  if (!telemetryEnabled() || sent >= 10) return
  if (isUserEnvironmentError(`${body.name ?? ''} ${body.message} ${body.stack ?? ''}`)) return
  sent += 1
  await send(body)
}

const gate = createReportGate()

async function releaseTag(): Promise<string> {
  if (!version && hasTauri()) version = await appVersion().catch(() => '')
  return RELEASE + '@' + (version || 'dev')
}

async function postScoped(channel: ReportChannel, body: ErrorReport) {
  if (!telemetryEnabled()) return
  if (isUserEnvironmentError(`${body.name ?? ''} ${body.message} ${body.stack ?? ''}`)) return
  if (!gate.admit(channel, (body.name ?? '') + '\n' + body.message)) return
  const release = await releaseTag()
  await send({ ...body, release })
}

function compact(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && !v.length) continue
    out[k] = typeof v === 'string' ? redactSecrets(v) : v
  }
  return out
}

let specs: Promise<DeviceSpecs | null> | null = null

function machine(): Promise<DeviceSpecs | null> {
  if (!specs) specs = deviceSpecs().catch(() => null)
  return specs
}

const inside = (file: string, dir: string) => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(file).startsWith(norm(dir) + '/')
}

async function javaAt(path: string, knownVersion?: string): Promise<{ major: number | null; origin: 'launcher' | 'system' }> {
  const runtimes = await listJavaRuntimes().catch((): JavaRuntime[] => [])
  const own = runtimes.find((r) => inside(path, r.path))
  if (own) return { major: own.major, origin: 'launcher' }
  const probed = knownVersion ?? (await testJava(path).catch(() => ''))
  return { major: javaMajorOf(probed), origin: 'system' }
}

// Mirrors the core's pick (engine/game/launch.rs, resolve_profile_java): a
// pinned major, then the build's own path, then the default from settings, then
// the runtime the version asks for, which the UI cannot see without a new command.
async function javaFacts(s: ProfileSettings | null): Promise<{ javaMajor: number | null; javaSource: string }> {
  const pinned = Number(s?.javaMajor) || 0
  if (pinned) return { javaMajor: pinned, javaSource: 'pinned' }
  const own = (s?.javaPath || '').trim()
  if (own) {
    const j = await javaAt(own)
    return { javaMajor: j.major, javaSource: 'build-path:' + j.origin }
  }
  const def = await defaultJava().catch(() => null)
  if (def) {
    const j = await javaAt(def.path, def.version)
    return { javaMajor: j.major, javaSource: 'settings-default:' + j.origin }
  }
  return { javaMajor: null, javaSource: 'auto' }
}

export interface CrashMeta {
  profile: Profile | null
  ramRequestedMb: number
  nick?: string
}

export async function reportGameCrash(info: CrashInfo, meta: CrashMeta): Promise<void> {
  if (!telemetryEnabled() || !hasTauri() || !info) return
  const name = info.profile || ''
  const [settings, spec, tuning, release] = await Promise.all([
    name ? loadProfileSettings(name).catch(() => null) : Promise.resolve(null),
    machine(),
    name ? tuneProfile(name).catch(() => null) : Promise.resolve(null),
    releaseTag(),
  ])
  const hide = (text: string) =>
    maskValues(redactSecrets(text), [
      [meta.nick, '<nick>'],
      [name, '<build>'],
    ])
  const pack = (settings?.catalogPackSlug || '').trim()
  const java = await javaFacts(settings)
  const ram = ramChoice(meta.ramRequestedMb, Number(settings?.ramMb) || 0, settings?.autoTune !== false, tuning?.ramMb ?? null)
  const p = meta.profile
  await postScoped('crash', {
    source: 'LAUNCHER',
    level: pack ? 'ERROR' : 'WARN',
    name: 'GameCrash',
    message: hide(gameCrashMessage({ reason: info.reason, catalogPack: pack, culprits: info.culprits, tail: info.tail })),
    stack: tailForReport(hide(info.tail || '')) || undefined,
    url: pack ? 'catalog-pack:' + pack : undefined,
    context: compact({
      // Имя своей сборки — личное: слаг каталога или отпечаток (аудит 24.09.2026).
      profile: buildTag(name, pack),
      mc: p?.version,
      loader: p ? p.loader || (p.fabric ? 'fabric' : 'vanilla') : null,
      loaderVersion: p?.loader_version,
      catalogPack: pack,
      catalogPackVersion: settings?.catalogPackVersion,
      modpack: settings?.modpackSlug,
      javaMajor: java.javaMajor,
      javaSource: java.javaSource,
      ramMb: ram.ramMb,
      ramSource: ram.ramSource,
      machineRamMb: spec?.ram_mb || tuning?.totalRamMb,
      os: spec ? (spec.os + ' ' + spec.os_version).trim() : navigator.platform,
      arch: spec?.arch,
      launcher: release,
      culprits: (info.culprits || []).slice(0, 20).map(hide),
      actions: (info.actions || []).map((a) => a.kind),
    }),
  })
}

// Аргументы команды с именами сборок (profile, name, newName) уходят только
// отпечатком: одинаковые склеиваются, а само имя не видно. Имена импорта
// (import_instance name) — тоже.
const NAME_ARGS = ['profile', 'name', 'newName'] as const

function hashNames(cmd: string, args: Record<string, string | number>): Record<string, string | number> {
  const out = { ...args }
  // У импорта «версия» — имя папки версии из чужого лаунчера, его выбирал человек.
  const keys: readonly string[] = cmd === 'import_instance' ? [...NAME_ARGS, 'version'] : NAME_ARGS
  for (const k of keys) if (typeof out[k] === 'string' && out[k]) out[k] = 'h:' + shortHash(out[k] as string)
  return out
}

export async function reportCoreFailure(cmd: string, err: unknown, args?: Record<string, unknown>): Promise<void> {
  if (!telemetryEnabled()) return
  const text = errorText(err)
  if (!text || expectedFailure(text, cmd)) return
  const raw = (key: string) => (args && typeof args[key] === 'string' ? (args[key] as string) : null)
  // Отказ запуска сборки каталога помечается её слагом: по нему сервер
  // собирает логи для разбора «здоровья сборки» (как у GameCrash).
  const launched = cmd === 'launch_profile' ? raw('profile') : null
  const settings = launched ? await loadProfileSettings(launched).catch(() => null) : null
  const pack = (settings?.catalogPackSlug || '').trim()
  const masks: Array<[string | null, string]> = [
    [raw('profile'), '<profile>'],
    [raw('name'), '<name>'],
    [raw('newName'), '<name>'],
    [cmd === 'import_instance' ? raw('version') : null, '<version>'],
  ]
  await postScoped('core', {
    source: 'LAUNCHER',
    level: 'ERROR',
    name: 'CoreCommandFailed',
    message: failureMessage(cmd, text, masks),
    stack: failureDetails(maskValues(text, masks)),
    url: pack ? 'catalog-pack:' + pack : undefined,
    context: compact({
      command: cmd,
      ...hashNames(cmd, safeArgs(args)),
      catalogPack: pack,
      catalogPackVersion: pack ? settings?.catalogPackVersion : null,
      modpack: settings?.modpackSlug,
    }),
  })
}

export async function reportInstallFailure(key: string, title: string, err: unknown): Promise<void> {
  if (!telemetryEnabled()) return
  const text = errorText(err)
  if (!text || expectedFailure(text)) return
  const target = installTarget(key)
  await postScoped('install', {
    source: 'LAUNCHER',
    level: 'ERROR',
    name: 'InstallFailed',
    message: failureMessage(target.kind, text, [[target.profile, '<profile>']]),
    stack: failureDetails(maskValues(text, [[target.profile, '<profile>']])),
    url: target.catalogPack ? 'catalog-pack:' + target.catalogPack : undefined,
    context: compact({
      kind: target.kind,
      key: target.profile ? key.split(target.profile).join('<profile>') : key,
      title: target.profile && title ? maskValues(title, [[target.profile, '<profile>']]) : title,
      profile: buildTag(target.profile, target.catalogPack),
      catalogPack: target.catalogPack,
    }),
  })
}

export async function reportError(where: string, err: unknown, fatal = false) {
  const e = err instanceof Error ? err : new Error(String(err))
  remember('error', (where ? where + ': ' : '') + (e.name && e.name !== 'Error' ? e.name + ' ' : '') + e.message)
  if (!telemetryEnabled()) return
  if (!version && hasTauri()) version = await appVersion().catch(() => '')
  await post({
    source: 'LAUNCHER',
    level: fatal ? 'FATAL' : 'ERROR',
    name: e.name,
    message: (where ? where + ': ' : '') + e.message,
    stack: e.stack,
    release: RELEASE + '@' + (version || 'dev'),
    context: { platform: navigator.platform, where },
  })
}

export async function flushNativeCrashes() {
  if (!hasTauri()) return
  try {
    const crashes = await readCrashes()
    if (!crashes.length) return
    if (!version) version = await appVersion().catch(() => '')
    for (const c of crashes) remember('crash', c.file + ': ' + c.message)
    // Без согласия на телеметрию паники только показываются в диагностике и
    // стираются с диска — наружу не уходят.
    for (const c of telemetryEnabled() ? crashes.slice(0, 5) : []) {
      await post({
        source: 'LAUNCHER',
        level: 'FATAL',
        // Зависание интерфейса — не паника: раньше оно шло как RustPanic и
        // одной группой в 27 тыс. событий заслоняло настоящие падения ядра.
        name: c.kind === 'freeze' || /^freeze-/.test(c.file) ? 'UiFreeze' : 'RustPanic',
        message: c.message,
        stack: c.details,
        release: RELEASE + '@' + (version || 'dev'),
        context: { file: c.file, native: true, kind: c.kind || (/^freeze-/.test(c.file) ? 'freeze' : 'panic') },
      })
    }
    await clearCrashes()
  } catch {}
}

export function installErrorHandlers() {
  onCoreFailure(reportCoreFailure)
  window.addEventListener('error', (e) => {
    void reportError('window', e.error || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    void reportError('promise', e.reason)
  })
}
