// Login state for the UI: is there a Millida or Microsoft session. The tokens live only in the core store (secrets.rs).
// Only the fact "a session exists" comes here. Old tokens from localStorage of earlier versions are deleted at start.
import { hasTauri } from '../ipc/tauri'
import { sessionStatus } from '../ipc/commands'
import { DEMO_USER } from './demo'

export const SECRETS_CHANGED_EVENT = 'millida-secrets-changed'

// Tokens live in the core vault only. The webview keeps nothing but the fact
// that a session exists, so an XSS has nothing to steal.
let millida = false
const accounts = new Map<string, boolean>()
let readyPromise: Promise<SessionCheck> | null = null

/** Ответ ядра о сессии: `ok` — ответ есть (вход есть или нет), `failed` — ядро не ответило. */
export type SessionCheck = 'ok' | 'failed'
/** Паузы между повторами проверки, мс: «не смогли спросить» — не «сессии нет» (04.11.2026). */
const CHECK_RETRY_MS = [300, 800, 1500]

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SECRETS_CHANGED_EVENT))
}

export function hasMillidaSession(): boolean {
  // Демо-просмотр в браузере (?preview=user, только dev): сессии Millida без
  // Tauri нет, и без этого половина экранов упирается в «Войти». В релизе
  // DEMO_USER — константа false, и ветка вырезается сборкой.
  if (import.meta.env.DEV && DEMO_USER) return true
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

/**
 * Спросить ядро, есть ли сессии. Сбой вызова — `failed`, и прежнее знание остаётся: раньше он молча
 * давал «входа нет», и старт уводил на вход, стирая живую сессию. `retries` — сколько раз повторить.
 */
export async function refreshSessionState(retries = 0): Promise<SessionCheck> {
  if (!hasTauri()) {
    millida = false
    accounts.clear()
    announce()
    return 'ok'
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const s = await sessionStatus(knownAccountIds())
      millida = !!s.millida
      accounts.clear()
      Object.entries(s.accounts || {}).forEach(([id, present]) => accounts.set(id, !!present))
      announce()
      return 'ok'
    } catch (e) {
      if (attempt >= retries) {
        console.warn('[secure] session status is unknown', e)
        return 'failed'
      }
      await new Promise((r) => setTimeout(r, CHECK_RETRY_MS[Math.min(attempt, CHECK_RETRY_MS.length - 1)]))
    }
  }
}

export function initSecrets(): Promise<SessionCheck> {
  if (readyPromise) return readyPromise
  dropLegacyTokens()
  readyPromise = refreshSessionState(CHECK_RETRY_MS.length)
  return readyPromise
}
