/*
 * Голос в граф совместимости Милли (milli-agent compat.ts): «этот набор модов
 * упал» или «отыграл спокойно». Уходят только id модов с Modrinth/CurseForge и
 * номера версий — без файлов, путей, ника и настроек. Карантин версии мода сервер
 * ставит, только когда она падает у разных аккаунтов (один игрок его не поставит),
 * а доктор Милли потом предлагает её обновить всем, у кого она стоит.
 */
import { listContent, listProfiles } from '../ipc/commands'
import type { ModFile } from '../ipc/commands'
import type { CrashInfo } from '../ipc/events'
import { api, hasMillidaAccount } from './api'
import { telemetryEnabled } from './telemetry'

/** Классы вылета, в которых виноват набор модов, а не компьютер игрока. */
const MOD_KINDS = new Set(['missing_deps', 'api_mismatch', 'mixin', 'conflict', 'wrong_mc', 'old_loader', 'wrong_loader'])
const MAX_MODS = 300
const OK_KEY = 'm-compat-ok'
const DAY = 86_400_000

export interface Ref {
  p: string
  v: string
}

export const refOf = (m: Pick<ModFile, 'project_id' | 'version_number'>): Ref | null =>
  m.project_id && m.version_number ? { p: m.project_id.slice(0, 64), v: m.version_number.slice(0, 64) } : null

/** Тело сигнала; null — нечего сказать (вылет не про моды, моды не опознаны). */
export function signalBody(
  profile: { version: string; loader?: string | null; fabric?: boolean },
  mods: Pick<ModFile, 'name' | 'enabled' | 'project_id' | 'version_number'>[],
  crash: Pick<CrashInfo, 'kind' | 'cause' | 'culprits'> | null,
) {
  if (crash && !MOD_KINDS.has(crash.kind ?? '')) return null
  const loader = (profile.loader || (profile.fabric ? 'fabric' : '')).toLowerCase()
  if (!loader || loader === 'vanilla' || !profile.version) return null
  const on = mods.filter((m) => m.enabled)
  const refs = on.map(refOf).filter((r): r is Ref => !!r).slice(0, MAX_MODS)
  // Неопознанных много — набор не тот, что у других: голос только исказит граф.
  if (refs.length < 1 || refs.length < on.length * 0.7) return null
  const culprit = crash
    ? (crash.culprits ?? [])
        .map((file) => on.find((m) => m.name === file))
        .map((m) => (m ? refOf(m) : null))
        .filter((r): r is Ref => !!r)
    : []
  return {
    mc: profile.version,
    loader,
    mods: refs,
    ok: !crash,
    ...(crash ? { errorSignature: `${crash.kind}:${(crash.cause || '').slice(0, 200)}` } : {}),
    ...(culprit.length ? { culprit } : {}),
  }
}

function okSentToday(profile: string, now: number): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(OK_KEY) || '{}') || {}
    if (now - (all[profile] ?? 0) < DAY) return true
    all[profile] = now
    localStorage.setItem(OK_KEY, JSON.stringify(all))
  } catch {}
  return false
}

/** Вылет из-за модов или спокойная игра → голос в граф. Тихо: ошибки не важны игроку. */
export async function sendCompatSignal(name: string, crash: CrashInfo | null, now = Date.now()): Promise<void> {
  if (!name || !hasMillidaAccount() || !telemetryEnabled()) return
  if (!crash && okSentToday(name, now)) return
  try {
    const profile = (await listProfiles()).find((p) => p.name === name)
    if (!profile) return
    const body = signalBody(profile, await listContent(name, 'mod'), crash)
    if (!body) return
    await api('/catalog/milli/compat/signal', { method: 'POST', body: JSON.stringify(body) })
  } catch {}
}
