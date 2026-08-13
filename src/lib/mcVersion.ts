// The rating reports a server as major versions ("1.21"), builds carry a full
// release ("1.21.4"), so a fit is decided on the first two components.
const NUMERIC = /^\d+(\.\d+)*$/

export function versionMajor(v: string): string {
  const t = (v || '').trim()
  const parts = t.split('.')
  return parts.length > 2 ? parts.slice(0, 2).join('.') : t
}

export function serverVersions(list?: string[] | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list || []) {
    const v = (raw || '').trim()
    if (!NUMERIC.test(v) || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export function versionFits(buildVersion: string, wanted: string[]): boolean {
  if (!wanted.length) return true
  const b = (buildVersion || '').trim()
  if (!b) return false
  return wanted.some((w) => w === b || versionMajor(w) === versionMajor(b))
}

export function pickBuildForServer<T extends { version: string }>(builds: T[], wanted: string[]): T | null {
  if (!wanted.length) return null
  return (
    builds.find((b) => wanted.includes((b.version || '').trim())) ||
    builds.find((b) => versionFits(b.version, wanted)) ||
    null
  )
}

export function pickVersionForServer(available: string[], wanted: string[]): string {
  for (const w of wanted) if (available.includes(w)) return w
  for (const w of wanted) {
    const near = available.find((v) => versionMajor(v) === versionMajor(w))
    if (near) return near
  }
  return ''
}
