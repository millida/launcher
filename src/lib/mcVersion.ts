// The rating reports a server as major versions ("1.21"), builds carry a full
// release ("1.21.4"), so a fit is decided on the first two components.
const NUMERIC = /^\d+(\.\d+)*$/

export function versionMajor(v: string): string {
  const t = (v || '').trim()
  const parts = t.split('.')
  return parts.length > 2 ? parts.slice(0, 2).join('.') : t
}

// The rating takes the version from the server owner, so releases that were
// never published ("1.22".."1.29") reach the launcher and end up in its filters
// and in the offer to build for them. Only Mojang's own list tells a typo from a
// release; while that list is unknown every numeric version is kept, so a real
// version is never hidden because the manifest failed to load.
let known: Set<string> | null = null

export function setKnownVersions(list: string[]) {
  const s = new Set<string>()
  for (const raw of list) {
    const v = (raw || '').trim()
    if (!NUMERIC.test(v)) continue
    s.add(v)
    s.add(versionMajor(v))
  }
  known = s.size ? s : null
}

export const isKnownVersion = (v: string) => !known || known.has(v)

export function serverVersions(list?: string[] | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list || []) {
    const v = (raw || '').trim()
    if (!NUMERIC.test(v) || seen.has(v) || !isKnownVersion(v)) continue
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

// Ответ сервера на пинг — свободная строка: «Paper 1.20.1», «1.16.5», а у
// прокси диапазон «1.8.x-1.21.x». Точную версию берём, диапазон отбрасываем:
// такой сервер пускает любой клиент из промежутка, и придираться не за что.
const PING_RANGE = /\d+\.\d+(\.\d+)?\s*[-–—]\s*\d+\.\d+(\.\d+)?/
const PING_TOKEN = /\d{1,4}\.\d{1,2}(\.\d{1,3})?/g

export function pingVersions(reported: string | null | undefined): string[] {
  const s = (reported || '').trim()
  if (!s || PING_RANGE.test(s.replace(/\.(x|\*)\b/gi, ''))) return []
  const hits = s.match(PING_TOKEN) || []
  return serverVersions(hits.slice(0, 1))
}
