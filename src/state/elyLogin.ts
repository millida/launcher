import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { elyDevicePoll, elyDeviceStart, elySessionCommit, openUrl } from '../ipc/commands'
import { useAccounts } from './accounts'
import { showToast } from './ui'
import { enterApp } from '../lib/session'
import { refreshSessionState } from '../lib/secure'
import { copyText } from '../lib/clipboard'
import { copyLink } from '../lib/links'
import { apiErrorText } from '../lib/apiError'
import { track, trackFailure } from '../lib/telemetry'

interface ElyLoginState {
  busy: boolean
  userCode: string
  verifyUrl: string
  hint: string
  set: (patch: Partial<ElyLoginState>) => void
}

const ELY_VERIFY_URL = 'https://account.ely.by/code'

export const useElyLogin = create<ElyLoginState>((set) => ({
  busy: false,
  userCode: '',
  verifyUrl: '',
  hint: '',
  set: (patch) => set(patch as ElyLoginState),
}))

let pollTimer: ReturnType<typeof setTimeout> | null = null

function reset(hint?: string) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  useElyLogin.getState().set({ busy: false, userCode: '', verifyUrl: '', hint: hint || '' })
}

export function cancelElyLogin() {
  reset()
}

export function openElyVerifyPage() {
  const url = useElyLogin.getState().verifyUrl || ELY_VERIFY_URL
  if (hasTauri()) openUrl(url)
  else window.open(url, '_blank')
}

export function copyElyVerifyLink() {
  void copyLink(useElyLogin.getState().verifyUrl || ELY_VERIFY_URL)
}

export async function copyElyCode() {
  const code = useElyLogin.getState().userCode
  if (!code) {
    showToast('Код ещё не пришёл — подожди пару секунд')
    return
  }
  showToast((await copyText(code)) ? 'Код скопирован: ' + code : 'Скопируй код вручную: ' + code)
}

const maskNick = (e: unknown, nick: string) => (nick ? String(e).split(nick).join('<nick>') : String(e))

export async function startElyLogin() {
  const s = useElyLogin.getState()
  if (s.busy) {
    openElyVerifyPage()
    return
  }
  if (!hasTauri()) {
    showToast('Вход через Ely.by доступен только в приложении лаунчера', 'error')
    return
  }
  s.set({ busy: true, hint: 'Запрашиваем код у Ely.by…' })
  let init
  try {
    init = await elyDeviceStart()
  } catch (e) {
    trackFailure('login', e, { provider: 'elyby', step: 'start' })
    reset(apiErrorText(e, 'Ely.by не ответил — повтори попытку'))
    showToast('Ely.by: ' + apiErrorText(e, 'нет ответа'), 'error')
    return
  }
  useElyLogin.getState().set({
    userCode: init.user_code,
    verifyUrl: init.verification_uri || ELY_VERIFY_URL,
    hint: 'Введи код на странице Ely.by и подтверди вход.',
  })
  openElyVerifyPage()
  void copyText(init.user_code).then((copied) => {
    if (!copied || useElyLogin.getState().userCode !== init.user_code) return
    useElyLogin.getState().set({ hint: 'Код скопирован — вставь его на странице Ely.by и подтверди вход.' })
  })

  const intervalMs = Math.max(2, init.interval || 5) * 1000
  const deadline = Date.now() + 10 * 60 * 1000

  const poll = async () => {
    if (Date.now() > deadline) {
      reset('Время вышло — начни вход заново.')
      return
    }
    let r
    try {
      r = await elyDevicePoll(init.device_code)
    } catch (e) {
      trackFailure('login', e, { provider: 'elyby', step: 'poll' })
      reset(String(e))
      showToast('Ely.by: ' + e, 'error')
      return
    }
    if (r.status === 'pending') {
      pollTimer = setTimeout(() => void poll(), intervalMs)
      return
    }
    const acc = useAccounts.getState().add({ nick: r.nick, kind: 'elyby', uuid: r.uuid })
    try {
      await elySessionCommit(init.device_code, acc.id)
    } catch (e) {
      useAccounts.getState().remove(acc.id)
      trackFailure('login', maskNick(e, r.nick), { provider: 'elyby', step: 'commit' })
      reset(String(e))
      showToast('Ely.by: ' + e, 'error')
      return
    }
    await refreshSessionState()
    reset()
    enterApp()
    track('account_link', { kind: 'elyby' })
    showToast('Аккаунт Ely.by подключён: ' + r.nick)
  }
  pollTimer = setTimeout(() => void poll(), intervalMs)
}
