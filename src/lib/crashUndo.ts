/** Mods a crash-dialog action switches off, so «Вернуть» can switch exactly those back on. */
export function filesDisabledBy(kind: string, arg: string | undefined): string[] {
  if (!arg) return []
  if (kind === 'disable-mod') return [arg]
  if (kind !== 'disable-added' && kind !== 'fix-plan') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(arg)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  if (kind === 'disable-added') return parsed.filter((f): f is string => typeof f === 'string' && f.length > 0)
  return parsed.flatMap((step: unknown) => (Array.isArray(step) && step[0] === 'disable-mod' && typeof step[1] === 'string' && step[1] ? [step[1]] : []))
}
