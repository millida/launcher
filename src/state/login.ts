import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { millidaLoginPoll, openUrl } from '../ipc/commands'
import { useAccounts } from './accounts'
import { showToast } from './ui'
import { enterApp } from '../lib/session'
import { refreshSessionState } from '../lib/secure'
import { copyText } from '../lib/clipboard'
import { copyLink } from '../lib/links'
import { api } from '../lib/api'
import { flushTelemetry, track } from '../lib/telemetry'
import { markMillidaEver, millidaEver } from './onboarding'

interface LauncherInit {
  deviceCode: string
  userCode: string
  verifyUrl: string
  expiresInSec: number
  intervalSec: number
}

type LauncherUser = { id: string; email: string; nickname: string | null } | null | undefined

interface LoginState {
  webLabel: string
  webBusy: boolean
  hintShown: boolean
  hintText: string
  userCode: string
  verifyUrl: string
  set: (patch: Partial<LoginState>) => void
}

const IDLE_LABEL = 'Войти через аккаунт Millida'

export const useLogin = create<LoginState>((set) => ({
  webLabel: IDLE_LABEL,
  webBusy: false,
  hintShown: false,
  hintText: '',
  userCode: '',
  verifyUrl: '',
  set: (patch) => set(patch as LoginState),
}))

const openUrlAnywhere = (url: string) => {
  if (hasTauri()) openUrl(url)
  else window.open(url, '_blank')
}

let pollTimer: ReturnType<typeof setTimeout> | null = null

function resetLogin(hint?: string) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  useLogin.getState().set({
    webBusy: false,
    webLabel: IDLE_LABEL,
    userCode: '',
    verifyUrl: '',
    hintShown: !!hint,
    hintText: hint || '',
  })
}

function nickFromUser(user: LauncherUser): string {
  if (!user) return 'Millida'
  if (user.nickname) return user.nickname
  const local = (user.email || '').split('@')[0]
  return local || 'Millida'
}

export function cancelWebLogin() {
  resetLogin()
}

export function copyVerifyLink() {
  void copyLink(useLogin.getState().verifyUrl)
}

export async function copyUserCode() {
  const code = useLogin.getState().userCode
  if (!code) {
    showToast('Код ещё не пришёл — подожди пару секунд')
    return
  }
  showToast((await copyText(code)) ? 'Код скопирован: ' + code : 'Скопируй код вручную: ' + code, code ? undefined : 'error')
}

export async function startWebLogin(reopen = false) {
  const s = useLogin.getState()
  if (s.webBusy) {
    if (reopen && s.verifyUrl) openUrlAnywhere(s.verifyUrl)
    return
  }
  if (!hasTauri()) {
    showToast('Вход через аккаунт Millida доступен только в приложении лаунчера', 'error')
    return
  }
  s.set({ webBusy: true, webLabel: 'Ждём подтверждения…' })
  let init: LauncherInit
  try {
    init = await api<LauncherInit>('/auth/launcher/init', {
      method: 'POST',
      body: JSON.stringify({ clientName: 'Millida Launcher' }),
    })
  } catch (e) {
    resetLogin()
    showToast('Не удалось начать вход: ' + e)
    return
  }

  // Show the code before touching the clipboard: the webview clipboard can hang.
  useLogin.getState().set({
    userCode: init.userCode,
    verifyUrl: init.verifyUrl,
    hintShown: true,
    hintText: 'Подтверди код на открывшейся странице Millida.',
  })
  openUrlAnywhere(init.verifyUrl)
  void copyText(init.userCode).then((copied) => {
    if (!copied || useLogin.getState().userCode !== init.userCode) return
    useLogin.getState().set({ hintText: 'Код скопирован — подтверди его на открывшейся странице Millida.' })
  })

  const deadline = Date.now() + Math.max(60, init.expiresInSec) * 1000
  const intervalMs = Math.max(2, init.intervalSec || 3) * 1000

  const poll = async () => {
    if (Date.now() > deadline) {
      resetLogin('Время вышло — нажми «Войти» ещё раз.')
      return
    }
    let r
    try {
      r = await millidaLoginPoll(init.deviceCode)
    } catch {
      pollTimer = setTimeout(() => void poll(), intervalMs)
      return
    }
    if (r.status === 'ok') {
      const nick = nickFromUser(r.user)
      await refreshSessionState()
      markMillidaEver()
      useAccounts.getState().add({ nick, kind: 'millida' })
      resetLogin()
      enterApp()
      track('account_link', { kind: 'millida' })
      void flushTelemetry()
      showToast('Вход выполнен: ' + nick)
      return
    }
    if (r.status === 'denied') {
      resetLogin('Вход отклонён на сайте.')
      showToast('Вход отклонён')
      return
    }
    if (r.status === 'expired') {
      resetLogin('Код устарел — нажми «Войти» ещё раз.')
      return
    }
    pollTimer = setTimeout(() => void poll(), intervalMs)
  }

  pollTimer = setTimeout(() => void poll(), intervalMs)
}

export function quickStart() {
  // Guest mode is a shortcut for a returning user, not a way around the account:
  // friends, skins, hosting and the game profile all need a Millida login.
  if (!millidaEver()) {
    showToast('Сначала войди в аккаунт Millida — это нужно один раз', 'error')
    return
  }
  const nick = 'Player' + Math.floor(1000 + Math.random() * 8999)
  useAccounts.getState().add({ nick, kind: 'guest' })
  enterApp()
  showToast('Вошли как ' + nick)
}
