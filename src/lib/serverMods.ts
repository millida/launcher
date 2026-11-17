import { cfInstall, createProfile, deleteContent, installServerModFile, installVersion, listContent } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { useProfiles } from '../state/profiles'
import { useServerMods, type ModsDecision } from '../state/serverMods'
import { showToast } from '../state/ui'
import { api } from './api'
import { inTime } from './deadline'
import { planIsEmpty, planIsSilent, planMods, serverModsAnswer, type ModsBinding, type ModsPlan, type ServerMod, type ServerModsAnswer } from './serverModsPlan'
import { SKIP_JOIN } from './serverPack'
import { t, tx } from '../i18n'

const PREPARE_TRIES = 10
const PREPARE_STEP_MS = 4000

const bindingKey = (serverId: string) => 'm-server-mods-' + serverId

function readBinding(serverId: string): ModsBinding | null {
  try {
    const b = JSON.parse(localStorage.getItem(bindingKey(serverId)) || 'null')
    if (!b || typeof b.profile !== 'string' || !b.files || typeof b.files !== 'object') return null
    const files: Record<string, string> = {}
    for (const [sha, file] of Object.entries(b.files as Record<string, unknown>)) if (typeof file === 'string') files[sha] = file
    return { profile: b.profile, files }
  } catch {
    return null
  }
}

function saveBinding(serverId: string, binding: ModsBinding) {
  try {
    localStorage.setItem(bindingKey(serverId), JSON.stringify(binding))
  } catch (e) {
    console.warn('[server-mods] binding not saved', e)
  }
}

async function fetchAnswer(addr: string): Promise<ServerModsAnswer | null> {
  try {
    return serverModsAnswer(await inTime(api<unknown>('/hosting/client/mods?address=' + encodeURIComponent(addr)), 12000))
  } catch {
    return null
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/// The server reads each new jar once; a fresh server answers "preparing" for a few seconds.
async function readyAnswer(addr: string, server: string): Promise<ServerModsAnswer | null> {
  let answer = await fetchAnswer(addr)
  for (let i = 0; answer?.status === 'preparing' && i < PREPARE_TRIES; i++) {
    if (i === 0) showToast(t('Сервер «{server}» собирает список модов…', { server }))
    await wait(PREPARE_STEP_MS)
    answer = await fetchAnswer(addr)
  }
  if (answer?.status === 'preparing') showToast(t('Список модов «{server}» ещё не готов — заходим без него', { server }), 'error')
  return answer?.status === 'ready' ? answer : null
}

/// A build follows the server only while its game version and loader still match the server's.
function aliveBinding(answer: ServerModsAnswer): ModsBinding | null {
  const b = readBinding(answer.serverId)
  const p = b && useProfiles.getState().profiles.find((x) => x.name === b.profile)
  if (!b || !p) return null
  const loader = p.loader || (p.fabric ? 'fabric' : 'vanilla')
  return p.version === answer.game.version && loader === answer.game.loader ? b : null
}

async function installOne(profile: string, serverId: string, version: string, m: ServerMod): Promise<string> {
  if (m.source === 'custom') return installServerModFile(profile, serverId, m.sha512, m.size, m.file, m.ticket || '')
  const r =
    m.source === 'modrinth'
      ? await installVersion(m.projectId!, m.versionId!, profile, 'mod', true)
      : await cfInstall(Number(m.projectId), version, profile, 'mod', Number(m.versionId), true)
  if (!r.file) throw new Error(r.mismatch || r.warning || t('Не нашлось файла под эту сборку'))
  return r.file
}

async function apply(plan: ModsPlan, decision: ModsDecision, binding: ModsBinding | null): Promise<string | typeof SKIP_JOIN> {
  const store = useServerMods.getState()
  const items = [
    ...plan.add.filter((m) => m.required || decision.optional.includes(m.sha512)),
    ...plan.custom.filter((m) => decision.custom.includes(m.sha512)),
  ]
  const total = items.length + plan.remove.length
  store.installing(plan, { done: 0, total, current: t('Готовим сборку') })
  let profile = plan.profile
  if (!profile) {
    try {
      profile = (await createProfile(plan.server, plan.version, plan.loader === 'fabric', plan.loader, null, null)).name
    } catch (e) {
      store.close()
      showToast(t('Не удалось создать сборку под сервер: {error}', { error: tx(e) }), 'error')
      return SKIP_JOIN
    }
  }
  const next: ModsBinding = { profile, files: { ...(binding?.files || {}) } }
  saveBinding(plan.serverId, next)
  let done = 0
  const failed: string[] = []
  for (const file of plan.remove) {
    store.installing(plan, { done, total, current: file })
    try {
      await deleteContent(profile, 'mod', file)
      for (const [sha, f] of Object.entries(next.files)) if (f === file) delete next.files[sha]
      saveBinding(plan.serverId, next)
    } catch (e) {
      console.warn('[server-mods] remove', file, e)
      failed.push(file)
    }
    done++
  }
  for (const m of items) {
    store.installing(plan, { done, total, current: m.name })
    try {
      next.files[m.sha512] = await installOne(profile, plan.serverId, plan.version, m)
      saveBinding(plan.serverId, next)
    } catch (e) {
      console.warn('[server-mods] install', m.file, e)
      failed.push(m.name)
    }
    done++
  }
  void useProfiles.getState().refresh()
  if (!failed.length) {
    store.close()
    return profile
  }
  return (await store.failures(failed)) ? profile : SKIP_JOIN
}

/**
 * A Fabric, Quilt, Forge or NeoForge server on Millida hosting tells which
 * client mods its players need. Joining goes through a build kept for that
 * server: public mods come from Modrinth and CurseForge against their own
 * hashes, the owner's own files only after the player ticks them. Returns the
 * build to join with, null when the server needs nothing (the usual version
 * pick follows), or SKIP_JOIN when the player stayed in the launcher.
 */
export async function serverModsBuild(addr: string, server: string, icon: string | null = null): Promise<string | null | typeof SKIP_JOIN> {
  if (!hasTauri()) return null
  const answer = await readyAnswer(addr, server)
  if (!answer || !answer.mods.length) return null
  const binding = aliveBinding(answer)
  let present = new Set<string>()
  if (binding) {
    try {
      present = new Set((await listContent(binding.profile, 'mod')).map((f) => f.name))
    } catch (e) {
      console.warn('[server-mods] list', e)
    }
  }
  const plan = planMods({ answer, server, icon, binding, present })
  if (!plan) return null
  if (planIsEmpty(plan)) return plan.profile
  const decision: ModsDecision = planIsSilent(plan) ? { action: 'install', optional: [], custom: [] } : await useServerMods.getState().ask(plan)
  if (decision.action === 'cancel') return SKIP_JOIN
  if (decision.action === 'without') return null
  return apply(plan, decision, binding)
}
