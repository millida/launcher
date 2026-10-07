import { api, hasMillidaAccount } from './api'
import { MILLIDA_USER_KEY, useAccounts } from '../state/accounts'
import { syncAuth } from '../state/auth'
import { loadFriends } from '../state/friends'
import { loadRooms } from '../state/rooms'
import { refreshPlayStats } from '../state/playStats'
import { refreshProfiles } from '../state/profiles'
import { refreshGameNick } from '../state/gameNick'
import { useUi } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import { millidaLogout } from '../ipc/commands'
import { refreshSessionState } from './secure'
import { playSound } from './sound'
import { maybeStartOnboarding } from '../state/onboarding'
import { syncAppIcon } from './appIcon'
import { noteAppRun } from '../state/navHint'
import { loadPrivacy, usePrivacy } from './privacy'

export interface MillidaProfile {
  nickname?: string
  avatarUrl?: string
}

export let MILLIDA_PROFILE: MillidaProfile | null = null

/**
 * The wallet is topped up on the site, outside the launcher, so the cached
 * balance goes stale. Returns the fresh available amount, or null when the
 * wallet could not be read and the cached value must not be trusted.
 */
export async function refreshMillidaWallet(): Promise<number | null> {
  if (!hasMillidaAccount()) return null
  const wallet = await api<{ availableKopecks?: number }>('/core/wallet/me/display').catch(() => null)
  const kopecks = wallet?.availableKopecks
  if (typeof kopecks !== 'number') return null
  const { list, save } = useAccounts.getState()
  const i = list.findIndex((x) => x.kind === 'millida' || x.kind === 'tg')
  if (i < 0) return null
  const l = list.slice()
  l[i] = { ...l[i], balance: kopecks }
  save(l)
  return kopecks
}

export async function loadMillidaProfile(): Promise<MillidaProfile | null> {
  if (!hasMillidaAccount()) return null
  try {
    const [me] = await Promise.all([api<MillidaProfile>('/users/me'), refreshMillidaWallet()])
    MILLIDA_PROFILE = me
    const { list, save } = useAccounts.getState()
    const i = list.findIndex((x) => x.kind === 'millida' || x.kind === 'tg')
    if (i >= 0 && me.nickname) {
      const l = list.slice()
      l[i] = { ...l[i], nick: me.nickname }
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
  void loadRooms()
  void refreshPlayStats()
  void refreshGameNick()
  void maybeStartOnboarding()
  void syncAppIcon()
  noteAppRun()
  // Приватность живёт на сервере и общая с сайтом: тянем её сразу после входа,
  // чтобы настройка пережила переустановку лаунчера и правку на millida.net.
  void loadPrivacy(true)
}

function dropMillidaSession() {
  MILLIDA_PROFILE = null
  localStorage.removeItem(MILLIDA_USER_KEY)
  // Приватность привязана к аккаунту: следующий вход не должен видеть чужие
  // тумблеры до ответа сервера.
  usePrivacy.setState({ loaded: false, error: '', saving: null })
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
  // Убираем сам аккаунт Millida/TG из списка: иначе при следующем запуске
  // getAccount() снова true → enterApp() поднимает залогиненную оболочку без
  // токена (кошелёк/друзья/хостинг молча мертвы, вернуться на вход нельзя).
  // Microsoft/офлайн-аккаунты не трогаем — у них свои токены.
  const acc = useAccounts.getState()
  acc.list
    .filter((a) => a.kind === 'millida' || a.kind === 'tg')
    .forEach((a) => acc.remove(a.id))
  useUi.getState().setLogged(false)
  syncAuth()
  void refreshGameNick()
}
