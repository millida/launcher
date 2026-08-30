import { hasTauri } from '../ipc/tauri'
import { addServer, pingServer } from '../ipc/commands'
import { getAccount } from '../state/accounts'
import { ensureMsAuth } from '../state/msLogin'
import { useProfiles } from '../state/profiles'
import { useServers } from '../state/servers'
import { setNewBuildPreset } from '../state/newBuild'
import type { JoinIntent } from '../state/newBuild'
import { rememberServerName } from '../state/playStats'
import { uiChoice, uiConfirm } from '../state/confirm'
import { joinStarted, joinWithAuth, showLaunchError } from './launch'
import { openModal, setScreen, showToast } from '../state/ui'
import { pingVersions, serverVersions } from './mcVersion'
import { joinPlan } from './joinPlan'
import { pickBuildForJoin } from '../state/buildPicker'
import { track } from './telemetry'

const addrKey = (ip: string) =>
  (ip || '')
    .trim()
    .toLowerCase()
    .replace(/:25565$/, '')

const pingedVersions = new Map<string, string[]>()

/**
 * Версию знает не только рейтинг: на свой хостинг, к другу и по ссылке из
 * Discord игрок заходит мимо каталога, и раньше в таких случаях запускалась
 * текущая сборка любой версии. Спрашиваем сам сервер — он отвечает точной
 * версией; ответ держим до конца сеанса, чтобы повторный вход не ждал снова.
 */
async function versionsFromPing(ip: string): Promise<string[]> {
  const key = addrKey(ip)
  const seen = pingedVersions.get(key)
  if (seen) return seen
  // The launcher's own ping allows four seconds to connect and four to answer;
  // cutting the wait at 1.5 s meant a server behind a proxy never reported a
  // version, and the join fell through to whatever build was selected.
  const reported = await Promise.race([
    pingServer(ip)
      .then((p) => p.version)
      .catch(() => ''),
    new Promise<string>((r) => setTimeout(() => r(''), 6000)),
  ])
  const out = pingVersions(reported)
  if (out.length) pingedVersions.set(key, out)
  return out
}

function versionsForAddr(ip: string): string[] {
  const key = addrKey(ip)
  if (!key) return []
  const hit = useServers.getState().list.find((s) => addrKey(s.ip) === key)
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
// no hint of what to do, so the version gate runs before the game starts. A
// server that never reported its version is a question, not a silent launch of
// the currently selected build.
export async function buildForServer(join: JoinIntent, wanted: string[]): Promise<string | null> {
  const { selected, profiles, setSelected } = useProfiles.getState()
  const plan = joinPlan(profiles, selected || (profiles[0] || { name: '' }).name, wanted)

  if (plan.kind === 'create') {
    showToast('Нужна сборка под сервер — создадим её сейчас', 'error')
    offerBuild(plan.version, join)
    return null
  }

  if (plan.kind === 'launch') return plan.build

  if (plan.kind === 'switch') {
    setSelected(plan.build)
    showToast('Сервер на ' + wanted.join(', ') + ' — заходим сборкой «' + plan.build + '» (' + plan.version + ')')
    return plan.build
  }

  if (plan.kind === 'unknown') {
    const go = await uiChoice(
      'Версию сервера «' +
        join.name +
        '» узнать не удалось — он не ответил на запрос. Сейчас выбрана сборка «' +
        plan.build +
        '» (' +
        plan.version +
        '). Если версии разойдутся, сервер напишет, что клиент устарел. Заходим этой сборкой?',
      {
        title: 'Какой сборкой заходим?',
        confirmLabel: 'Этой сборкой',
        cancelLabel: 'Выбрать другую',
        danger: false,
      },
    )
    if (go === 'yes') return plan.build
    if (go === 'dismiss') return null
    const picked = await pickBuildForJoin(join.name, wanted)
    if (!picked) return null
    setSelected(picked)
    return picked
  }

  const make = await uiChoice(
    'Сервер работает на ' +
      wanted.join(', ') +
      ', а сборки под эту версию у тебя нет — «' +
      plan.build +
      '» на ' +
      plan.version +
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
  if (make === 'no') return plan.build
  offerBuild(wanted[0] || '', join)
  return null
}

export async function quickJoin(ip: string, name: string, licensed?: boolean, versions?: string[]): Promise<void> {
  if (!hasTauri()) {
    showToast('Подключение к серверу доступно в приложении', 'error')
    return Promise.reject(new Error('no-tauri'))
  }
  track('server_join', { addr: ip.slice(0, 64), name: name.slice(0, 64) })
  let wanted = versions && versions.length ? serverVersions(versions) : versionsForAddr(ip)
  if (!wanted.length) wanted = await versionsFromPing(ip)
  const prof = await buildForServer({ ip, name, licensed, versions: wanted }, wanted)
  if (!prof) return Promise.reject(new Error('no-profile'))
  if (!(await licenseGate(!!licensed))) return
  addServer(prof, name, ip).catch(() => {})
  rememberServerName(ip, name)
  return joinWithAuth(prof, null, ip, name)
    .then((res) => {
      if (joinStarted(res)) showToast('Заходим на «' + name + '»')
    })
    .catch((err) => {
      showLaunchError(err)
      throw err
    })
}
