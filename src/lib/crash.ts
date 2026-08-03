import { api } from './api'
import { hasTauri } from '../ipc/tauri'
import { appVersion, readCrashes, clearCrashes } from '../ipc/commands'
import { isUserEnvironmentError } from './userEnvError'

const RELEASE = 'launcher'

interface ErrorReport {
  source: 'LAUNCHER'
  level: 'ERROR' | 'FATAL'
  name?: string
  message: string
  stack?: string
  release?: string
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

async function post(body: ErrorReport) {
  if (sent >= 10) return
  if (isUserEnvironmentError(`${body.name ?? ''} ${body.message} ${body.stack ?? ''}`)) return
  sent += 1
  try {
    await api('/errors', { method: 'POST', body: JSON.stringify(body) })
  } catch {}
}

export async function reportError(where: string, err: unknown, fatal = false) {
  const e = err instanceof Error ? err : new Error(String(err))
  remember('error', (where ? where + ': ' : '') + (e.name && e.name !== 'Error' ? e.name + ' ' : '') + e.message)
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
    for (const c of crashes.slice(0, 5)) {
      await post({
        source: 'LAUNCHER',
        level: 'FATAL',
        name: 'RustPanic',
        message: c.message,
        stack: c.details,
        release: RELEASE + '@' + (version || 'dev'),
        context: { file: c.file, native: true },
      })
    }
    await clearCrashes()
  } catch {}
}

export function installErrorHandlers() {
  window.addEventListener('error', (e) => {
    void reportError('window', e.error || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    void reportError('promise', e.reason)
  })
}
