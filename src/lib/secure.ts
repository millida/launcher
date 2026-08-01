import { hasTauri } from '../ipc/tauri'
import { sessionStatus } from '../ipc/commands'

export const SECRETS_CHANGED_EVENT = 'millida-secrets-changed'

// Tokens live in the core vault only. The webview keeps nothing but the fact
// that a session exists, so an XSS has nothing to steal.
let millida = false
const accounts = new Map<string, boolean>()
let readyPromise: Promise<void> | null = null

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SECRETS_CHANGED_EVENT))
}

export function hasMillidaSession(): boolean {
  return millida
}

export function hasAccountSession(id: string): boolean {
  return !!accounts.get(id)
}

function knownAccountIds(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem('m-accounts') || '[]')
    return Array.isArray(list) ? list.map((a: { id?: string }) => String(a && a.id ? a.id : '')).filter(Boolean) : []
  } catch {
    return []
  }
}

/// Plain-text tokens from launcher versions that predate the vault.
function dropLegacyTokens() {
  localStorage.removeItem('m-token')
  localStorage.removeItem('m-mc-token')
  try {
    const list = JSON.parse(localStorage.getItem('m-accounts') || '[]')
    if (!Array.isArray(list)) return
    const stripped = list.filter((a: { token?: string }) => a && a.token)
    if (!stripped.length) return
    stripped.forEach((a: { token?: string }) => delete a.token)
    localStorage.setItem('m-accounts', JSON.stringify(list))
  } catch {}
}

export async function refreshSessionState(): Promise<void> {
  if (!hasTauri()) {
    millida = false
    accounts.clear()
    announce()
    return
  }
  try {
    const s = await sessionStatus(knownAccountIds())
    millida = !!s.millida
    accounts.clear()
    Object.entries(s.accounts || {}).forEach(([id, present]) => accounts.set(id, !!present))
  } catch {
    return
  }
  announce()
}

export function initSecrets(): Promise<void> {
  if (readyPromise) return readyPromise
  dropLegacyTokens()
  readyPromise = refreshSessionState()
  return readyPromise
}
