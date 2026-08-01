import { hasTauri } from '../ipc/tauri'
import { addServer } from '../ipc/commands'
import { getAccount } from '../state/accounts'
import { ensureMsAuth } from '../state/msLogin'
import { useProfiles } from '../state/profiles'
import { rememberServerName } from '../state/playStats'
import { uiConfirm } from '../state/confirm'
import { joinWithAuth, showLaunchError } from './launch'
import { setScreen, showToast } from '../state/ui'
import { track } from './telemetry'

async function licenseGate(licensed: boolean): Promise<boolean> {
  if (!licensed) return true
  const acc = getAccount()
  const ms = !!acc && acc.kind === 'microsoft'
  if (ms && (await ensureMsAuth(acc))) return true
  const who = ms
    ? 'лицензионный аккаунт, но его вход слетел'
    : acc
      ? acc.kind === 'offline'
        ? 'офлайн-ник'
        : 'аккаунт Millida'
      : 'вход без аккаунта'
  return uiConfirm(
    'Этот сервер пускает только по лицензии Minecraft, а сейчас активен ' +
      who +
      '. Сервер ответит «Не удалось проверить имя пользователя». ' +
      (ms ? 'Войди в аккаунт Microsoft заново в меню аккаунтов' : 'Добавь аккаунт Microsoft в меню аккаунтов') +
      ' — или зайти всё равно?',
    { title: 'Нужна лицензия Minecraft', confirmLabel: 'Всё равно зайти', danger: false },
  )
}

export async function quickJoin(ip: string, name: string, licensed?: boolean): Promise<void> {
  if (!hasTauri()) {
    showToast('Подключение к серверу доступно в приложении', 'error')
    return Promise.reject(new Error('no-tauri'))
  }
  track('server_join', { addr: ip.slice(0, 64), name: name.slice(0, 64) })
  const { selected, profiles } = useProfiles.getState()
  const prof = selected || (profiles[0] || { name: '' }).name || ''
  if (!prof) {
    showToast('Сначала создай сборку — версию подберём под сервер', 'error')
    setScreen('mods')
    return Promise.reject(new Error('no-profile'))
  }
  if (!(await licenseGate(!!licensed))) return
  addServer(prof, name, ip).catch(() => {})
  rememberServerName(ip, name)
  return joinWithAuth(prof, null, ip, name)
    .then(() => {
      showToast('Заходим на «' + name + '»')
    })
    .catch((err) => {
      showLaunchError(err)
      throw err
    })
}
