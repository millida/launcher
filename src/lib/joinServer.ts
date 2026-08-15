import { hasTauri } from '../ipc/tauri'
import { addServer } from '../ipc/commands'
import { getAccount } from '../state/accounts'
import { ensureMsAuth } from '../state/msLogin'
import { useProfiles } from '../state/profiles'
import { useServers } from '../state/servers'
import { setNewBuildPreset } from '../state/newBuild'
import type { JoinIntent } from '../state/newBuild'
import { rememberServerName } from '../state/playStats'
import { uiChoice, uiConfirm } from '../state/confirm'
import { joinWithAuth, showLaunchError } from './launch'
import { openModal, setScreen, showToast } from '../state/ui'
import { pickBuildForServer, serverVersions, versionFits } from './mcVersion'
import { track } from './telemetry'

const addrKey = (ip: string) =>
  (ip || '')
    .trim()
    .toLowerCase()
    .replace(/:25565$/, '')

function versionsForAddr(ip: string): string[] {
  const key = addrKey(ip)
  if (!key) return []
  const { list, promo } = useServers.getState()
  const hit = list.concat(promo).find((s) => addrKey(s.ip) === key)
  return serverVersions(hit ? hit.versions : null)
}

function offerBuild(version: string, join: JoinIntent) {
  setNewBuildPreset({ version, name: join.name.slice(0, 24), join })
  setScreen('builds')
  openModal('nbModal')
}

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

// Launching a 26.2 build against a 1.21 server ends in "Outdated client" with
// no hint of what to do, so the version gate runs before the game starts.
async function buildForServer(join: JoinIntent, wanted: string[]): Promise<string | null> {
  const { selected, profiles, setSelected } = useProfiles.getState()
  const current = profiles.find((p) => p.name === (selected || (profiles[0] || { name: '' }).name)) || null
  if (!profiles.length) {
    showToast('Нужна сборка под сервер — создадим её сейчас', 'error')
    offerBuild(wanted[0] || '', join)
    return null
  }
  if (!wanted.length || (current && versionFits(current.version, wanted))) return (current || profiles[0]).name

  const fit = pickBuildForServer(profiles, wanted)
  if (fit) {
    setSelected(fit.name)
    showToast('Сервер на ' + wanted.join(', ') + ' — заходим сборкой «' + fit.name + '» (' + fit.version + ')')
    return fit.name
  }

  const make = await uiChoice(
    'Сервер работает на ' +
      wanted.join(', ') +
      ', а сборки под эту версию у тебя нет' +
      (current ? ' — «' + current.name + '» на ' + current.version : '') +
      '. Сервер не пустит и напишет, что версия не подходит. Создать сборку ' +
      (wanted[0] || '') +
      '?',
    {
      title: 'Версия не совпадает',
      confirmLabel: 'Создать сборку',
      cancelLabel: 'Всё равно зайти',
      danger: false,
    },
  )
  // Walking away from the question is not "зайти всё равно": the game must not
  // start from a window the user only closed.
  if (make === 'dismiss') return null
  if (make === 'no') return (current || profiles[0]).name
  offerBuild(wanted[0] || '', join)
  return null
}

export async function quickJoin(ip: string, name: string, licensed?: boolean, versions?: string[]): Promise<void> {
  if (!hasTauri()) {
    showToast('Подключение к серверу доступно в приложении', 'error')
    return Promise.reject(new Error('no-tauri'))
  }
  track('server_join', { addr: ip.slice(0, 64), name: name.slice(0, 64) })
  const wanted = versions && versions.length ? serverVersions(versions) : versionsForAddr(ip)
  const prof = await buildForServer({ ip, name, licensed, versions: wanted }, wanted)
  if (!prof) return Promise.reject(new Error('no-profile'))
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
