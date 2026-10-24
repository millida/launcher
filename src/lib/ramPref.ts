/*
 * Память сборки, которую реально берёт запуск. Ползунок сборки
 * (`m-ram-<сборка>`, целые ГБ) уходит в ядро как явный запрос и главнее
 * `ramMb` в настройках сборки, поэтому любая кнопка «дать памяти» пишет сюда.
 */
export const ramPrefKey = (profile: string) => 'm-ram-' + profile

export const ramGbOf = (mb: number) => Math.max(1, Math.round(mb / 1024))

export function setLaunchRamMb(profile: string, mb: number): boolean {
  if (!Number.isFinite(mb) || mb <= 0) return false
  try {
    localStorage.setItem(ramPrefKey(profile), String(ramGbOf(mb)))
    return true
  } catch {
    return false
  }
}
