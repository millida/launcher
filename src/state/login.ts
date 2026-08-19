import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { millidaLoginPoll, openUrl } from '../ipc/commands'
import { MILLIDA_USER_KEY, useAccounts } from './accounts'
import { resetGameNick } from './gameNick'
import { showToast } from './ui'
import { enterApp } from '../lib/session'
import { refreshSessionState } from '../lib/secure'
import { copyText } from '../lib/clipboard'
import { copyLink } from '../lib/links'
import { api } from '../lib/api'
import { flushTelemetry, track } from '../lib/telemetry'
import { markMillidaEver, millidaEver } from './onboarding'
import { apiErrorText } from '../lib/apiError'

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

// The browser does not always come up (no default browser, a portable build, a
// second machine). Saying where the code goes turns a dead end into a two-step
// login: millida.net/auth/launcher has a field for exactly this code.
const MANUAL_HINT = 'Подтверди код на странице Millida. Не открылась — зайди на millida.net/auth/launcher и введи код там.'

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

/// A code lives 15 minutes on the server, and the server caps how many it hands
/// out to one address. Every press of the button used to spend a fresh one, so a
/// browser that did not come up, a wrong account or a second try burned the
/// budget and the answer turned into 429. While the last code is still alive it
/// is reused instead.
let issued: { init: LauncherInit; deadline: number } | null = null

const REUSE_MARGIN_MS = 30_000

function reusableInit(): LauncherInit | null {
  if (!issued) return null
  if (Date.now() > issued.deadline - REUSE_MARGIN_MS) {
    issued = null
    return null
  }
  return issued.init
}

function resetLogin(hint?: string, dropCode = false) {
  if (dropCode) issued = null
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

/// The launcher holds one Millida session, so a second sign-in takes the place of the
/// first. Everything cached for the previous user has to go with it.
function adoptUser(user: LauncherUser) {
  const id = (user && user.id) || ''
  const prev = localStorage.getItem(MILLIDA_USER_KEY) || ''
  if (prev && prev !== id) resetGameNick()
  if (id) localStorage.setItem(MILLIDA_USER_KEY, id)
  else localStorage.removeItem(MILLIDA_USER_KEY)
}

/// A refusal by the rate limit is not a breakage: the same code still works, so
/// the message says to wait instead of sending the player to reinstall.
function loginStartError(e: unknown): string {
  const text = String(e)
  if (text.includes('429') || text.toLowerCase().includes('too many')) {
    return 'Слишком много попыток входа подряд. Подожди пару минут и нажми «Войти» ещё раз.'
  }
  return apiErrorText(e, 'Не удалось начать вход')
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
  const reused = reusableInit()
  if (reused) {
    init = reused
  } else {
    try {
      init = await api<LauncherInit>('/auth/launcher/init', {
        method: 'POST',
        body: JSON.stringify({ clientName: 'Millida Launcher' }),
      })
    } catch (e) {
      resetLogin()
      showToast(loginStartError(e), 'error')
      return
    }
    issued = { init, deadline: Date.now() + Math.max(60, init.expiresInSec) * 1000 }
  }

  // Show the code before touching the clipboard: the webview clipboard can hang.
  useLogin.getState().set({
    userCode: init.userCode,
    verifyUrl: init.verifyUrl,
    hintShown: true,
    hintText: MANUAL_HINT,
  })
  openUrlAnywhere(init.verifyUrl)
  void copyText(init.userCode).then((copied) => {
    if (!copied || useLogin.getState().userCode !== init.userCode) return
    useLogin.getState().set({ hintText: 'Код скопирован. ' + MANUAL_HINT })
  })

  const deadline = issued ? issued.deadline : Date.now() + Math.max(60, init.expiresInSec) * 1000
  const intervalMs = Math.max(2, init.intervalSec || 3) * 1000

  const poll = async () => {
    if (Date.now() > deadline) {
      resetLogin('Время вышло — нажми «Войти» ещё раз.', true)
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
      adoptUser(r.user)
      await refreshSessionState()
      markMillidaEver()
      useAccounts.getState().add({ nick, kind: 'millida' })
      resetLogin(undefined, true)
      enterApp()
      track('account_link', { kind: 'millida' })
      void flushTelemetry()
      showToast('Вход выполнен: ' + nick)
      return
    }
    if (r.status === 'denied') {
      resetLogin('Вход отклонён на сайте.', true)
      showToast('Вход отклонён')
      return
    }
    if (r.status === 'expired') {
      resetLogin('Код устарел — нажми «Войти» ещё раз.', true)
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
