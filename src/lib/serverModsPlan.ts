/// GET /hosting/client/mods?address= — the client mods a hosting server's mods/ folder holds.
export interface ServerMod {
  file: string
  size: number
  sha1: string
  sha512: string
  source: 'modrinth' | 'curseforge' | 'custom'
  projectId: string | null
  versionId: string | null
  name: string
  iconUrl: string | null
  required: boolean
  scan: 'clean' | 'flagged' | 'unchecked' | null
  /** Custom files only: the download pass the server issued with the list. */
  ticket: string | null
}

export interface ServerModsAnswer {
  serverId: string
  game: { core: string; version: string; loader: string | null }
  status: 'ready' | 'preparing' | 'unavailable' | 'none'
  progress: { done: number; total: number } | null
  mods: ServerMod[]
  customHidden: number
  revision: string
}

/// Which build follows a server's mods, and the file each mod became on disk, by its sha512.
export interface ModsBinding {
  profile: string
  files: Record<string, string>
}

export interface ModsPlan {
  server: string
  serverId: string
  icon: string | null
  version: string
  loader: string
  profile: string | null
  add: ServerMod[]
  custom: ServerMod[]
  remove: string[]
  have: number
  customHidden: number
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/
const SHA512 = /^[0-9a-f]{128}$/
const SHA1 = /^[0-9a-f]{40}$/
const JAR = /^[^/\\\0]{1,255}\.jar$/i
const TICKET = /^\d{1,12}\.[A-Za-z0-9_-]{43}$/
const LOADERS = new Set(['fabric', 'quilt', 'forge', 'neoforge'])
const MAX_MODS = 400
const MAX_MOD_BYTES = 64 * 1024 * 1024

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A mod line from the API, or null: anything malformed is dropped, never repaired. */
export function serverMod(raw: unknown): ServerMod | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const source = r.source
  const file = str(r.file)
  const sha512 = str(r.sha512).toLowerCase()
  const sha1 = str(r.sha1).toLowerCase()
  const size = Number(r.size)
  if (source !== 'modrinth' && source !== 'curseforge' && source !== 'custom') return null
  if (!JAR.test(file) || file.includes('..') || !SHA512.test(sha512) || !SHA1.test(sha1)) return null
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MOD_BYTES) return null
  const projectId = str(r.projectId)
  const versionId = str(r.versionId)
  if (source === 'modrinth' && (!SAFE_ID.test(projectId) || !SAFE_ID.test(versionId))) return null
  if (source === 'curseforge' && (!/^\d{1,12}$/.test(projectId) || !/^\d{1,12}$/.test(versionId))) return null
  const ticket = str(r.ticket)
  if (source === 'custom' && !TICKET.test(ticket)) return null
  const icon = str(r.iconUrl)
  const scan = r.scan === 'clean' || r.scan === 'flagged' ? r.scan : 'unchecked'
  return {
    file,
    size,
    sha1,
    sha512,
    source,
    projectId: source === 'custom' ? null : projectId,
    versionId: source === 'custom' ? null : versionId,
    name: str(r.name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || file,
    iconUrl: source !== 'custom' && icon.startsWith('https://') ? icon : null,
    required: r.required !== false,
    scan: source === 'custom' ? scan : null,
    ticket: source === 'custom' ? ticket : null,
  }
}

export function serverModsAnswer(raw: unknown): ServerModsAnswer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const serverId = str(r.serverId)
  const game = (r.game && typeof r.game === 'object' ? r.game : {}) as Record<string, unknown>
  const status = r.status
  if (!SAFE_ID.test(serverId)) return null
  if (status !== 'ready' && status !== 'preparing' && status !== 'unavailable' && status !== 'none') return null
  const loader = str(game.loader)
  const p = (r.progress && typeof r.progress === 'object' ? r.progress : null) as Record<string, unknown> | null
  const seen = new Set<string>()
  const mods: ServerMod[] = []
  for (const item of Array.isArray(r.mods) ? r.mods.slice(0, MAX_MODS) : []) {
    const m = serverMod(item)
    if (!m || seen.has(m.sha512) || seen.has(m.file.toLowerCase())) continue
    seen.add(m.sha512)
    seen.add(m.file.toLowerCase())
    mods.push(m)
  }
  return {
    serverId,
    game: { core: str(game.core), version: str(game.version), loader: LOADERS.has(loader) ? loader : null },
    status,
    progress: p && Number.isSafeInteger(p.done) && Number.isSafeInteger(p.total) ? { done: Number(p.done), total: Number(p.total) } : null,
    mods,
    customHidden: Number.isSafeInteger(r.customHidden) && Number(r.customHidden) > 0 ? Number(r.customHidden) : 0,
    revision: str(r.revision).slice(0, 64),
  }
}

/**
 * What joining needs: public mods the build lacks, the owner's own files to
 * offer, and the mods this launcher put there earlier that the server dropped.
 * A mod counts as present only while its file is still in the build: the
 * player may have deleted it by hand.
 */
export function planMods(input: {
  answer: ServerModsAnswer
  server: string
  icon: string | null
  binding: ModsBinding | null
  present: ReadonlySet<string>
}): ModsPlan | null {
  const { answer, binding, present } = input
  if (!answer.game.loader || !answer.game.version) return null
  const files = binding ? binding.files : {}
  const has = (m: ServerMod) => !!files[m.sha512] && present.has(files[m.sha512]!)
  const wanted = new Set(answer.mods.map((m) => m.sha512))
  const missing = answer.mods.filter((m) => !has(m))
  return {
    server: input.server,
    serverId: answer.serverId,
    icon: input.icon,
    version: answer.game.version,
    loader: answer.game.loader,
    profile: binding ? binding.profile : null,
    add: missing.filter((m) => m.source !== 'custom'),
    custom: missing.filter((m) => m.source === 'custom'),
    remove: Object.entries(files)
      .filter(([sha, file]) => !wanted.has(sha) && present.has(file))
      .map(([, file]) => file),
    have: answer.mods.length - missing.length,
    customHidden: answer.customHidden,
  }
}

/** Nothing to download, nothing to clear away: the build already matches. */
export const planIsEmpty = (p: ModsPlan): boolean => !p.add.length && !p.custom.length && !p.remove.length

/**
 * Public mods only, on a build this launcher already keeps for the server:
 * those are fetched from Modrinth and CurseForge against their own hashes, so
 * the update runs without a question. The owner's own files always ask.
 */
export const planIsSilent = (p: ModsPlan): boolean => !!p.profile && !p.custom.length && !p.add.some((m) => !m.required)

const LOADER_NAMES: Record<string, string> = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }
export const loaderName = (loader: string): string => LOADER_NAMES[loader] || loader
