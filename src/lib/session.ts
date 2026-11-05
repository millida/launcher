// What happens after login: loading the profile, wallet, friends, modpacks. Requests go to the Millida API through api(), the core adds the token.
import { api, hasMillidaAccount } from './api'
import { MILLIDA_USER_KEY, useAccounts } from '../state/accounts'
import { syncAuth } from '../state/auth'
import { loadFriends } from '../state/friends'
import { loadRooms } from '../state/rooms'
import { refreshPlayStats } from '../state/playStats'
import { refreshProfiles } from '../state/profiles'
import { refreshGameNick } from '../state/gameNick'
import { showToast, useUi } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import { millidaLogout } from '../ipc/commands'
import { refreshSessionState } from './secure'
import { playSound } from './sound'
import { maybeStartOnboarding } from '../state/onboarding'
import { syncAppIcon } from './appIcon'
import { noteAppRun } from '../state/navHint'
import { loadPrivacy, usePrivacy } from './privacy'
import { loadMoney, refreshMoney, resetMoney } from './useMoney'
import { track } from './telemetry'
import { errorText } from './errorReport'
import { t } from '../i18n'

export interface MillidaProfile {
  nickname?: string
  avatarUrl?: string
}

export let MILLIDA_PROFILE: MillidaProfile | null = null

export async function loadMillidaProfile(): Promise<MillidaProfile | null> {
  if (!hasMillidaAccount()) return null
  try {
    const [me] = await Promise.all([api<MillidaProfile>('/users/me'), refreshMoney()])
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

/** `again` — оболочка уже открыта, сессия подтвердилась позже: только догрузить данные, без звука и подсчёта запуска. */
export function enterApp(again = false) {
  if (!again) playSound('login')
  useUi.getState().setLogged(true)
  syncAuth()
  void refreshProfiles()
  void loadMillidaProfile()
  void loadFriends()
  void loadRooms()
  void refreshPlayStats()
  void refreshGameNick()
  if (!again) void maybeStartOnboarding()
  void syncAppIcon()
  if (!again) noteAppRun()
  // Приватность живёт на сервере и общая с сайтом: тянем её сразу после входа,
  // чтобы настройка пережила переустановку лаунчера и правку на millida.net.
  void loadPrivacy(true)
  void loadMoney()
}

/** Забыть то, что вебвью знает о сессии Millida (профиль, кошелёк, приватность), и спросить ядро заново. */
function forgetSessionView() {
  MILLIDA_PROFILE = null
  localStorage.removeItem(MILLIDA_USER_KEY)
  // Приватность привязана к аккаунту: следующий вход не должен видеть чужие
  // тумблеры до ответа сервера.
  usePrivacy.setState({ loaded: false, error: '', saving: null })
  resetMoney()
}

/** Ядро доделывает отложенный выход при каждой проверке сессии: проверка прошла — токенов нет. */
const SIGN_OUT_RECHECK_MS = 3000
const SIGN_OUT_RECHECKS = 5

function recheckSignOut(left: number) {
  void refreshSessionState().then((check) => {
    if (check === 'failed' && left > 0) setTimeout(() => recheckSignOut(left - 1), SIGN_OUT_RECHECK_MS)
  })
}

function dropMillidaSession() {
  forgetSessionView()
  if (!hasTauri()) return
  void millidaLogout().then(
    () => refreshSessionState(),
    (e: unknown) => {
      showToast(t(errorText(e)), 'error')
      recheckSignOut(SIGN_OUT_RECHECKS)
    },
  )
}

/** Почему лаунчер открыл вход сам: по ним в телеметрии видно, откуда «выкидывает». */
export type LoginReason = 'button' | 'start-no-session' | 'start-no-account' | 'expired'

/**
 * Экран входа — и только он (04.11.2026: «разлогинивает», «забывает аккаунт»). Раньше вход и выход
 * были одной функцией: кнопка «Войти», проверка на старте и любая заминка проверки стирали
 * токены в ядре и строку аккаунта, хотя сессия была жива. Теперь ничего не стирается: настоящий
 * отказ сервера (401 на продлении) ядро уже обработало само, а новый вход займёт ту же строку.
 */
export function showLogin(reason: LoginReason = 'button') {
  if (reason !== 'button') track('error', { where: 'session_lost', code: reason }, { ok: false })
  // Ядро уже стёрло токены: флаг входа, профиль и кошелёк в вебвью тоже должны это знать, иначе
  // вход игровым аккаунтом поднял бы оболочку с мёртвой сессией Millida.
  if (reason === 'expired') {
    forgetSessionView()
    void refreshSessionState()
  }
  useUi.getState().setLogged(false)
  syncAuth()
}

/** Выйти по просьбе игрока: токены в ядре и аккаунт Millida/TG из списка. Игровые аккаунты остаются. */
export function signOut() {
  dropMillidaSession()
  const acc = useAccounts.getState()
  acc.list
    .filter((a) => a.kind === 'millida' || a.kind === 'tg')
    .forEach((a) => acc.remove(a.id))
  showLogin()
  track('error', { where: 'session_lost', code: 'user' }, { ok: false })
  void refreshGameNick()
}
