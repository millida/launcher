import { api, hasMillidaAccount } from './api'
import { useAccounts } from '../state/accounts'
import { syncAuth } from '../state/auth'
import { loadFriends } from '../state/friends'
import { refreshPlayStats } from '../state/playStats'
import { refreshProfiles } from '../state/profiles'
import { useUi } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import { millidaLogout } from '../ipc/commands'
import { refreshSessionState } from './secure'
import { playSound } from './sound'

export interface MillidaProfile {
  nickname?: string
  avatarUrl?: string
}

export let MILLIDA_PROFILE: MillidaProfile | null = null

export async function loadMillidaProfile(): Promise<MillidaProfile | null> {
  if (!hasMillidaAccount()) return null
  try {
    const [me, wallet] = await Promise.all([
      api<MillidaProfile>('/users/me'),
      api<{ availableKopecks?: number }>('/core/wallet/me/display').catch(() => null),
    ])
    MILLIDA_PROFILE = me
    const { list, save } = useAccounts.getState()
    const l = list.slice()
    const a = l.find((x) => x.kind === 'millida' || x.kind === 'tg')
    if (a) {
      if (me.nickname) a.nick = me.nickname
      if (me.avatarUrl) a.avatar = me.avatarUrl
      if (wallet && wallet.availableKopecks != null) a.balance = wallet.availableKopecks
      save(l)
    }
    return me
  } catch {
    return null
  }
}

export function enterApp() {
  playSound('login')
  useUi.getState().setLogged(true)
  syncAuth()
  void refreshProfiles()
  void loadMillidaProfile()
  void loadFriends()
  void refreshPlayStats()
}

function dropMillidaSession() {
  MILLIDA_PROFILE = null
  if (!hasTauri()) return
  void millidaLogout()
    .catch(() => {})
    .then(() => refreshSessionState())
}

export function forgetMillidaIfGone() {
  const has = useAccounts.getState().list.some((a) => a.kind === 'millida' || a.kind === 'tg')
  if (has) return
  dropMillidaSession()
}

export function logoutToLogin() {
  dropMillidaSession()
  const acc = useAccounts.getState()
  acc.list
    .filter((a) => a.kind === 'millida' || a.kind === 'tg')
    .forEach((a) => acc.remove(a.id))
  useUi.getState().setLogged(false)
  syncAuth()
}
