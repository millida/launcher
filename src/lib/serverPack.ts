import { cfInstallModpack, installModpackVersion, installServerPackFile, modpackContents, modpackInfo, updateModpack } from '../ipc/commands'
import type { Profile } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { uiChoice } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { api } from './api'
import { inTime } from './deadline'
import { joinInfo, wakesOnJoin } from './wakeInfo'
import { t, tx } from '../i18n'

/// GET /hosting/client/pack?address= — the client pack a hosting server publishes.
interface ServerPackAnswer {
  serverId: string
  address: string
  game: { core: string; version: string; loader: string }
  pack: null | {
    source: 'modrinth' | 'curseforge' | 'ftb' | 'upload'
    projectId: string | null
    versionId: string | null
    name: string
    versionName: string | null
    /** upload only: the owner's .mrpack, served by the API and checked against these. */
    sha512: string | null
    size: number | null
  }
  revision: string | number
}

export const SKIP_JOIN = 'skip-join'

/// Which build follows which server pack, and the revision it has. The build
/// itself records the Modrinth project and version it was installed from.
interface Binding {
  profile: string
  revision: string
}

const bindingKey = (serverId: string) => 'm-server-pack-' + serverId

function readBinding(serverId: string): Binding | null {
  try {
    const b = JSON.parse(localStorage.getItem(bindingKey(serverId)) || 'null')
    return b && typeof b.profile === 'string' ? { profile: b.profile, revision: String(b.revision ?? '') } : null
  } catch {
    return null
  }
}

function bind(serverId: string, profile: string, revision: string | number) {
  try {
    localStorage.setItem(bindingKey(serverId), JSON.stringify({ profile, revision: String(revision) }))
  } catch (e) {
    console.warn('[server-pack] binding not saved', e)
  }
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/

async function ask<T>(path: string): Promise<T | null> {
  try {
    return await inTime(api<T>(path), 3000)
  } catch {
    return null
  }
}

/// A sleeping server that wakes on join needs nothing from the player: the
/// gate starts it while the game connects. The player is told why it waits.
async function noteWake(addr: string) {
  if (wakesOnJoin(await joinInfo(addr))) showToast(t('Сервер просыпается — вход займёт до минуты'))
}

async function boundBuild(serverId: string, projectId: string): Promise<{ name: string; versionId: string } | null> {
  const builds = useProfiles.getState().profiles.map((p) => p.name)
  const bound = readBinding(serverId)
  const order = bound && builds.includes(bound.profile) ? [bound.profile, ...builds.filter((b) => b !== bound.profile)] : builds
  for (const name of order) {
    const info = await modpackInfo(name).catch(() => null)
    if (info && info.slug === projectId) return { name, versionId: info.versionId }
  }
  return null
}

const SHOWN = 4
const listed = (names: string[]) => names.slice(0, SHOWN).join(', ') + (names.length > SHOWN ? ' ' + t('и ещё {n}', { n: names.length - SHOWN }) : '')

/// The mods a new version adds and drops, read from both versions' indexes.
async function versionDiff(projectId: string, from: string, to: string): Promise<string> {
  const [a, b] = await Promise.all([modpackContents(projectId, from).catch(() => null), modpackContents(projectId, to).catch(() => null)])
  if (!a || !b) return ''
  const before = new Set(a.mods.map((m) => m.name))
  const after = new Set(b.mods.map((m) => m.name))
  const added = [...after].filter((n) => !before.has(n))
  const removed = [...before].filter((n) => !after.has(n))
  const parts: string[] = []
  if (a.game !== b.game) parts.push(t('Версия игры: {from} → {to}', { from: a.game, to: b.game }))
  if (added.length) parts.push(t('Добавятся ({n}): {list}', { n: added.length, list: listed(added) }))
  if (removed.length) parts.push(t('Уберутся ({n}): {list}', { n: removed.length, list: listed(removed) }))
  return parts.join('. ')
}

type Pack = NonNullable<ServerPackAnswer['pack']>

/// How a published pack is installed, or null when the answer lacks what that
/// source needs. An uploaded file is accepted only with the sha512 and size the
/// server published: the core checks the download against them. An FTB server
/// runs from a server image and publishes no client file at all.
function installer(serverId: string, pack: Pack): (() => Promise<Profile>) | null {
  const project = pack.projectId && SAFE_ID.test(pack.projectId) ? pack.projectId : null
  const version = pack.versionId && SAFE_ID.test(pack.versionId) ? pack.versionId : null
  if (pack.source === 'modrinth') return project && version ? () => installModpackVersion(project, version) : null
  if (pack.source === 'curseforge')
    return project && /^\d+$/.test(project) ? () => cfInstallModpack(Number(project), version && /^\d+$/.test(version) ? Number(version) : undefined) : null
  if (pack.source === 'ftb') return null
  const sha = pack.sha512 && /^[0-9a-f]{128}$/i.test(pack.sha512) ? pack.sha512 : null
  const size = typeof pack.size === 'number' && pack.size > 0 ? pack.size : 0
  return sha && size ? () => installServerPackFile(serverId, sha, size, pack.name) : null
}

/**
 * A server on Millida hosting can publish the pack its players need. Joining
 * goes through the build made from that pack: missing — it is offered for
 * install; behind the server's revision — the difference is shown and the
 * update runs only on the player's yes. Returns the build to join with, null
 * when the server has no pack (the usual version pick follows), or SKIP_JOIN
 * when the player declined.
 */
export async function serverPackBuild(addr: string, server: string): Promise<string | null | typeof SKIP_JOIN> {
  if (!hasTauri()) return null
  void noteWake(addr)
  const sp = await ask<ServerPackAnswer>('/hosting/client/pack?address=' + encodeURIComponent(addr))
  const pack = sp && sp.pack
  if (!sp || !pack || !SAFE_ID.test(sp.serverId)) return null
  const revision = String(sp.revision ?? '')
  const title = pack.name + (pack.versionName ? ' ' + pack.versionName : '')
  const install = installer(sp.serverId, pack)
  if (!install) {
    if (pack.source === 'ftb') showToast(t('У «{server}» сборка FTB «{pack}» — поставь её через «Импорт» → FTB', { server, pack: title }))
    else if (pack.source === 'upload') showToast(t('Сборка сервера «{server}» ещё готовится — зайди через минуту, чтобы её поставить', { server }))
    return null
  }

  const have = pack.source === 'modrinth' && pack.projectId ? await boundBuild(sp.serverId, pack.projectId) : null
  const bound = readBinding(sp.serverId)
  const boundAlive = !!bound && useProfiles.getState().profiles.some((p) => p.name === bound.profile)
  // CurseForge, FTB and uploaded packs have no in-place update here: a new revision installs as a new build.
  const otherHave = pack.source !== 'modrinth' && boundAlive && bound!.revision === revision ? bound!.profile : null
  const outdated = pack.source !== 'modrinth' && boundAlive && bound!.revision !== revision

  if (!have && !otherHave) {
    const question = outdated
      ? t('Сервер «{server}» обновил свою сборку до «{pack}». Поставить новую версию? Старая сборка останется', { server, pack: title })
      : t('У сервера «{server}» своя сборка «{pack}» — с ней точно пустит. Поставить?', { server, pack: title })
    const go = await uiChoice(question, {
      title: t('Сборка сервера'),
      confirmLabel: t('Поставить'),
      cancelLabel: outdated ? t('Зайти старой') : t('Зайти без неё'),
      danger: false,
    })
    if (go === 'no') return outdated ? bound!.profile : null
    if (go !== 'yes') return SKIP_JOIN
    showToast(t('Ставим сборку сервера «{pack}»…', { pack: title }))
    try {
      const p = await install()
      bind(sp.serverId, p.name, revision)
      void useProfiles.getState().refresh()
      return p.name
    } catch (e) {
      showToast(t('Не удалось поставить сборку сервера: {error}', { error: tx(e) }), 'error')
      return SKIP_JOIN
    }
  }

  if (!have || !pack.projectId || !pack.versionId) return otherHave
  const name = have.name
  if (have.versionId === pack.versionId) {
    bind(sp.serverId, name, revision)
    return name
  }
  const details = await versionDiff(pack.projectId, have.versionId, pack.versionId)
  const go = await uiChoice(t('Сервер «{server}» обновил свою сборку. Обновить «{build}» и зайти?', { server, build: name }) + (details ? ' ' + details + '.' : ''), {
    title: t('Сборка сервера'),
    confirmLabel: t('Обновить и зайти'),
    cancelLabel: t('Отмена'),
    danger: false,
  })
  if (go !== 'yes') return SKIP_JOIN
  try {
    await updateModpack(name, pack.versionId)
    bind(sp.serverId, name, revision)
    return name
  } catch (e) {
    showToast(t('Не удалось обновить сборку сервера: {error}', { error: tx(e) }), 'error')
    return SKIP_JOIN
  }
}
