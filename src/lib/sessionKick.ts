import { tauri } from '../ipc/tauri'
import { stopGame } from '../ipc/commands'
import { uiChoice } from '../state/confirm'
import { useGame } from '../state/game'
import { getAccount } from '../state/accounts'
import { refreshMsAccounts, ensureMsAuth, startMsLogin } from '../state/msLogin'
import { showToast } from '../state/ui'
import { joinWithAuth, showLaunchError } from './launch'
import { t, tx } from '../i18n'

const EXIT_WAIT_MS = 30_000

let started = false
let asking = false

function waitForExit(profile: string): Promise<boolean> {
  if (!useGame.getState().list.includes(profile)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, EXIT_WAIT_MS)
    const stop = useGame.subscribe((s) => {
      if (s.list.includes(profile)) return
      clearTimeout(timer)
      stop()
      resolve(true)
    })
  })
}

/// The game holds the token it was started with, so a renewed sign-in reaches the server only
/// through a restart: the game is closed and started again straight into the same server.
export async function renewAndRejoin(server: string, profile: string | null): Promise<void> {
  const acc = getAccount()
  if (acc?.kind === 'microsoft') {
    await refreshMsAccounts(true)
    if (!(await ensureMsAuth(acc))) {
      showToast(t('Вход Microsoft нужно подтвердить заново — открываем окно входа'))
      void startMsLogin()
      return
    }
  }
  if (!profile) {
    showToast(t('Вход обновлён — перезапусти игру и зайди на {server}', { server }))
    return
  }
  await stopGame(profile)
  if (!(await waitForExit(profile))) {
    showToast(t('Игра не закрылась — закрой её и зайди на {server} снова', { server }), 'error')
    return
  }
  await joinWithAuth(profile, null, server, server, { confirmed: true }).catch((e) => showLaunchError(e))
}

async function offer(server: string) {
  if (asking) return
  asking = true
  try {
    const running = useGame.getState().list
    const profile = running.length === 1 ? running[0] : null
    const choice = await uiChoice(t('Сервер {server} не принял вход в Minecraft: сессия устарела. Обновить вход и зайти снова?', { server }), {
      title: t('Сессия устарела'),
      confirmLabel: t('Обновить и зайти'),
      cancelLabel: t('Не сейчас'),
      danger: false,
    })
    if (choice === 'yes') await renewAndRejoin(server, profile)
  } catch (e) {
    showToast(t('Не удалось обновить вход: {error}', { error: tx(e) }), 'error')
  } finally {
    asking = false
  }
}

export function initSessionKick() {
  const T = tauri()
  if (started || !T) return
  started = true
  void T.event
    .listen<string>('session-kicked', (e) => {
      if (e.payload) void offer(e.payload)
    })
    .catch(() => {
      started = false
    })
}
