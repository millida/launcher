import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { msDevicePoll, msDeviceStart, msSessionCommit, msSessionRefresh, msSessionValidate, openUrl } from '../ipc/commands'
import { getAccount, hasLicenseSession, msTokenFresh, useAccounts } from './accounts'
import type { Account } from './accounts'
import { showToast } from './ui'
import { enterApp } from '../lib/session'
import { refreshSessionState } from '../lib/secure'
import { copyText } from '../lib/clipboard'
import { copyLink } from '../lib/links'
import { apiErrorText } from '../lib/apiError'

interface MsLoginState {
  busy: boolean
  userCode: string
  verifyUrl: string
  hint: string
  set: (patch: Partial<MsLoginState>) => void
}

const MS_VERIFY_URL = 'https://www.microsoft.com/link'

export const useMsLogin = create<MsLoginState>((set) => ({
  busy: false,
  userCode: '',
  verifyUrl: '',
  hint: '',
  set: (patch) => set(patch as MsLoginState),
}))

let pollTimer: ReturnType<typeof setTimeout> | null = null

function reset(hint?: string) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  useMsLogin.getState().set({ busy: false, userCode: '', verifyUrl: '', hint: hint || '' })
}

export function cancelMsLogin() {
  reset()
}

export function openMsVerifyPage() {
  const url = useMsLogin.getState().verifyUrl || MS_VERIFY_URL
  if (hasTauri()) openUrl(url)
  else window.open(url, '_blank')
}

export function copyMsVerifyLink() {
  void copyLink(useMsLogin.getState().verifyUrl || MS_VERIFY_URL)
}

export async function copyMsCode() {
  const code = useMsLogin.getState().userCode
  if (!code) {
    showToast('Код ещё не пришёл — подожди пару секунд')
    return
  }
  showToast((await copyText(code)) ? 'Код скопирован: ' + code : 'Скопируй код вручную: ' + code)
}

export async function startMsLogin() {
  const s = useMsLogin.getState()
  if (s.busy) {
    openMsVerifyPage()
    return
  }
  if (!hasTauri()) {
    showToast('Вход по лицензии доступен только в приложении лаунчера', 'error')
    return
  }
  s.set({ busy: true, hint: 'Запрашиваем код у Microsoft…' })
  let init
  try {
    init = await msDeviceStart()
  } catch (e) {
    reset(apiErrorText(e, 'Microsoft не ответила — повтори попытку'))
    showToast('Microsoft: ' + apiErrorText(e, 'нет ответа'), 'error')
    return
  }
  const url = init.verification_uri || MS_VERIFY_URL
  useMsLogin.getState().set({
    userCode: init.user_code,
    verifyUrl: url,
    hint: 'Введи код на странице Microsoft и подтверди вход.',
  })
  openMsVerifyPage()
  void copyText(init.user_code).then((copied) => {
    if (!copied || useMsLogin.getState().userCode !== init.user_code) return
    useMsLogin.getState().set({ hint: 'Код скопирован — вставь его на странице Microsoft и подтверди вход.' })
  })

  const intervalMs = Math.max(2, init.interval || 5) * 1000
  const deadline = Date.now() + 15 * 60 * 1000

  const poll = async () => {
    if (Date.now() > deadline) {
      reset('Время вышло — начни вход заново.')
      return
    }
    let r
    try {
      r = await msDevicePoll(init.device_code)
    } catch (e) {
      reset(String(e))
      showToast('Microsoft: ' + e, 'error')
      return
    }
    if (r.status === 'pending') {
      pollTimer = setTimeout(() => void poll(), intervalMs)
      return
    }
    const acc = useAccounts.getState().add({
      nick: r.nick,
      kind: 'microsoft',
      uuid: r.uuid,
      xuid: r.xuid,
      exp: expiresAt(r.expires_in),
    })
    try {
      await msSessionCommit(init.device_code, acc.id)
    } catch (e) {
      useAccounts.getState().remove(acc.id)
      reset(String(e))
      showToast('Microsoft: ' + e, 'error')
      return
    }
    await refreshSessionState()
    reset()
    enterApp()
    showToast('Лицензия подключена: ' + r.nick)
  }
  pollTimer = setTimeout(() => void poll(), intervalMs)
}

// Identifies a live licensed session. The token behind it stays in the core.
export interface MsAuth {
  id: string
  uuid: string
  xuid: string
}

const expiresAt = (seconds?: number) => Date.now() + Math.max(60, seconds || 86400) * 1000

function patchAccount(id: string, patch: Partial<Account>) {
  const st = useAccounts.getState()
  st.save(st.list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
}

function authOf(a: Account): MsAuth {
  return { id: a.id, uuid: a.uuid || '', xuid: a.xuid || '' }
}

async function refreshMsAccount(a: Account): Promise<MsAuth | null> {
  let r
  try {
    r = await msSessionRefresh(a.id)
  } catch {
    // Microsoft unreachable: the stored session stays as it is.
    return null
  }
  if (r.status === 'relogin') {
    patchAccount(a.id, { exp: 0 })
    await refreshSessionState()
    return null
  }
  if (r.status !== 'ok') return null
  const patch: Partial<Account> = { exp: expiresAt(r.expires_in) }
  if (r.nick) patch.nick = r.nick
  if (r.uuid) patch.uuid = r.uuid
  if (r.xuid) patch.xuid = r.xuid
  patchAccount(a.id, patch)
  await refreshSessionState()
  return { id: a.id, uuid: r.uuid || a.uuid || '', xuid: r.xuid || a.xuid || '' }
}

// A present token is not enough: MC tokens last a day while the launcher can sit
// in the tray for longer, and the game would then fail joinServer with 401.
export async function ensureMsAuth(acc?: Account | null): Promise<MsAuth | null> {
  const a = acc || getAccount()
  if (!a || a.kind !== 'microsoft' || !hasTauri()) return null
  if (msTokenFresh(a)) return authOf(a)
  const fresh = await refreshMsAccount(a)
  if (fresh) return fresh
  if (!hasLicenseSession(a)) return null
  try {
    const v = await msSessionValidate(a.id)
    if (v.status === 'ok') {
      // Real expiry is unknown, so trust the validated token for a short window only.
      patchAccount(a.id, { exp: Date.now() + 15 * 60 * 1000 })
      return authOf(a)
    }
    if (v.status === 'expired') {
      patchAccount(a.id, { exp: 0 })
      await refreshSessionState()
    }
    return null
  } catch {
    // Offline: let the game report the session problem instead of blocking launch.
    return authOf(a)
  }
}

export async function refreshMsAccounts(force = false) {
  if (!hasTauri()) return
  const ms = useAccounts.getState().list.filter((a) => a.kind === 'microsoft')
  for (const a of ms) {
    if (!force && msTokenFresh(a)) continue
    await refreshMsAccount(a)
  }
}
