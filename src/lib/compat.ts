// The game version declared inside a jar is free-form: an exact list
// ("1.21, 1.21.1"), a range (">=1.21.11", "1.20.x") or nothing at all. Only an
// exact list can be judged, so ranges are never reported as incompatible.
const RANGE_CHARS = /[<>~^*=[\](),]|\bx\b|\.x\b/i

export function declaredVersions(mc: string): string[] {
  return mc
    .split(/[,;/]| или /i)
    .map((v) => v.trim())
    .filter(Boolean)
}

export function incompatibleWith(mc: string | undefined, buildVersion: string): boolean {
  if (!mc || !buildVersion) return false
  const parts = declaredVersions(mc)
  if (!parts.length || parts.some((p) => RANGE_CHARS.test(p) || p.includes('-'))) return false
  return !parts.includes(buildVersion.trim())
}
