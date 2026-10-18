import { api, hasMillidaAccount } from './api'
import { getAccount, isMillidaKind, millidaGameNick, type Account } from '../state/accounts'
import { useGame } from '../state/game'

/// The control plane keeps a claim for at most a minute, so it is renewed a little earlier.
export const CLAIM_EVERY_MS = 50_000

/// Only a nick the Millida login owns is vouched for: the server takes the name from
/// the account's game profile, so an offline nick counts only when it is exactly that name.
export function claimsJoin(acc: Account | null, millidaSession: boolean, profileNick: string): boolean {
  if (!acc || !millidaSession) return false
  if (isMillidaKind(acc.kind)) return true
  return acc.kind === 'offline' && !!profileNick && acc.nick === profileNick
}

/// The claim names the server the game connects to; the control plane drops the port
/// and resolves custom domains itself, so only an address that cannot be one is refused.
export function claimHost(raw: string | null | undefined): string {
  const host = String(raw || '').trim().toLowerCase()
  if (!host || host.length > 255 || /\s/.test(host) || !/[a-z0-9]/.test(host)) return ''
  return host
}

let target = ''

/// A claim is good for one login, so each connection needs its own: the launch and every
/// server the game reports re-arm it, and the timer keeps the last one alive for a reconnect.
/// A reserve check that never hears from us only turns the player away as it would without
/// the claim, so an unreachable API is not worth telling the player about.
export async function claimJoin(server?: string | null): Promise<void> {
  if (server !== undefined) target = claimHost(server)
  if (!target || !claimsJoin(getAccount(), hasMillidaAccount(), millidaGameNick())) return
  await api('/hosting/auth-fallback/claim', { method: 'POST', body: JSON.stringify({ host: target }) }).catch(() => undefined)
}

export function watchJoinClaims(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const sync = (running: boolean) => {
    if (running && !timer) {
      timer = setInterval(() => void claimJoin(), CLAIM_EVERY_MS)
    } else if (!running && timer) {
      clearInterval(timer)
      timer = null
      target = ''
    }
  }
  sync(useGame.getState().list.length > 0)
  const unsubscribe = useGame.subscribe((s) => sync(s.list.length > 0))
  return () => {
    unsubscribe()
    sync(false)
  }
}
