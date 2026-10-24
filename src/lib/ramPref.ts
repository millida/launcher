/*
 * Память сборки живёт в одном месте — `ramMb` в настройках сборки в ядре.
 * Её пишут ползунок, окно вылета, Милли и совет перед запуском; запуск
 * берёт её же. Старые версии держали ползунок в `m-ram-<сборка>` вебвью,
 * и он перебивал всё остальное: такое значение переезжает в ядро один раз.
 */
import { loadProfileSettings, setProfileRam } from '../ipc/commands'

export const ramPrefKey = (profile: string) => 'm-ram-' + profile

export const ramGbOf = (mb: number) => Math.max(1, Math.round(mb / 1024))

function legacyGb(profile: string): number {
  try {
    return parseInt(localStorage.getItem(ramPrefKey(profile)) || '0', 10) || 0
  } catch {
    return 0
  }
}

const writes = new Map<string, Promise<boolean>>()

/** 0 — авто. Записи одной сборки идут по очереди: ползунок шлёт их подряд, и поздняя не должна проиграть ранней. */
export function setBuildRamMb(profile: string, mb: number): Promise<boolean> {
  if (!Number.isFinite(mb) || mb < 0) return Promise.resolve(false)
  const value = mb > 0 ? ramGbOf(mb) * 1024 : 0
  const prev = writes.get(profile) ?? Promise.resolve(true)
  const settled = prev.then(() => setProfileRam(profile, value)).then(
    () => true,
    () => false,
  )
  writes.set(profile, settled)
  return settled
}

/** Значение старого ползунка уходит в ядро и только после записи пропадает из вебвью. */
export async function adoptLegacyRam(profile: string): Promise<void> {
  const gb = legacyGb(profile)
  if (!gb) return
  if (!(await setBuildRamMb(profile, gb * 1024))) return
  try {
    localStorage.removeItem(ramPrefKey(profile))
  } catch {}
}

/** Что запуск должен передать явно: старое значение, пока оно не переехало, иначе 0 — ядро возьмёт настройки сборки. */
export function pendingLegacyRamMb(profile: string): number {
  return legacyGb(profile) * 1024
}

/** Память сборки в целых ГБ, 0 — авто. */
export async function buildRamGb(profile: string): Promise<number> {
  await adoptLegacyRam(profile)
  const s = await loadProfileSettings(profile)
  const mb = Number(s.ramMb) || 0
  return mb > 0 ? ramGbOf(mb) : 0
}
