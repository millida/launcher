// Pure rules of the website-screen bridge (src/lib/remoteUiBridge.ts): which API paths a screen may call
// and which links it may open. No imports, so the rules are unit-tested on their own.
export const REMOTE_UI_SITE = 'https://millida.net'

export interface RemoteUiBridge {
  v: 1
  locale: string
  siteOrigin: string
  api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T>
  navigate(path: string): void
  install(
    item: { section: string; slug: string; name?: string; source?: 'millida' | 'modrinth' | 'curseforge'; pid?: string; cfid?: number },
    target?: { kind: 'build' | 'server'; id?: string },
  ): Promise<void>
  join(server: { address: string; name: string; version?: string }): Promise<void>
  /**
   * Sends a file from the screen to the hosting API as the signed-in player (raw bytes, the token stays in
   * the core). Only the hosting upload routes are open; `path` carries its own query. A file-manager chunk
   * is POST ...files/upload?offset=N, a resource pack is PUT ...resource-pack?name=X.
   */
  upload?(path: string, file: Blob, opts?: { method?: 'POST' | 'PUT'; onProgress?: (sent: number) => void }): Promise<unknown>
  openExternal(url: string): void
  toast(message: string, kind?: 'info' | 'success' | 'error'): void
  /** The player's builds for the catalog's «For: build» picker: names, versions and loaders only. */
  profiles?(): Promise<{ list: { name: string; version: string; loader: string | null }[]; selected: string | null }>
}

// Website screens may only reach these API sections; everything else (wallet, account, chats) stays closed.
const API_ALLOW = [/^\/hosting\//, /^\/catalog\//, /^\/rating\//, /^\/vds\//, /^\/forum\/articles\/[\w-]+\/(?:review|like)$/]
// Paid packs: the showcase and a pack's access card (read), checkout links for a subscription or a one-time buy (create).
const API_PREMIUM_READ = [/^\/launcher\/premium(?:\/[\w-]+)?$/]
const API_PREMIUM_POST = [/^\/launcher\/premium\/subscribe$/, /^\/launcher\/premium\/[\w-]+\/buy$/]
// Read-only: the material's article and reviews, the Modrinth and CurseForge search proxies, the pack launch check.
const API_READ = [/^\/forum\/articles\/[\w-]+(?:\/reviews)?$/, /^\/launcher\/mr\/v2\/search\?/, /^\/launcher\/cf\/v1\/mods\/search\?/, /^\/launcher\/pack-health\?/]
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export class RemoteApiError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? 'http ' + status)
  }
}

export function remoteApiError(e: unknown): RemoteApiError {
  const text = String((e as { message?: unknown } | null)?.message ?? e ?? '')
  const status = Number(/\b([1-5]\d\d)\b/.exec(text)?.[1] ?? 0)
  let body: unknown = null
  const json = text.indexOf('{')
  if (json >= 0) {
    try {
      body = JSON.parse(text.slice(json))
    } catch {
      body = null
    }
  }
  const msg = (body as { message?: unknown } | null)?.message
  return new RemoteApiError(status, body, typeof msg === 'string' ? msg : text || undefined)
}

export function remoteApiAllowed(path: string, method: string): boolean {
  if (!METHODS.has(method) || path.includes('..')) return false
  if (method === 'GET' && (API_READ.some((re) => re.test(path)) || API_PREMIUM_READ.some((re) => re.test(path)))) return true
  if (method === 'POST' && API_PREMIUM_POST.some((re) => re.test(path))) return true
  return API_ALLOW.some((re) => re.test(path))
}

export function sitePath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null
  return REMOTE_UI_SITE + path
}

// Raw uploads: the same two routes the core lets through (upload_route_allowed in millida.rs).
const UPLOAD_ROUTES: { method: string; re: RegExp }[] = [
  { method: 'POST', re: /^\/hosting\/servers\/[\w-]+\/files\/upload$/ },
  { method: 'PUT', re: /^\/hosting\/servers\/[\w-]+\/resource-pack$/ },
]

export function remoteUploadAllowed(path: string, method: string): boolean {
  if (path.includes('..') || path.includes('\\')) return false
  const route = path.split(/[?#]/)[0]
  return UPLOAD_ROUTES.some((r) => r.method === method && r.re.test(route))
}

/** Biggest piece the core receives in one call: it holds the bytes in memory next to the webview's copy. */
export const UPLOAD_PART = 16 * 1024 * 1024

/**
 * A file-manager chunk may be up to 100 MB, but the server only needs `offset` to append, so a big chunk
 * goes out as consecutive smaller requests with shifted offsets. Anything else is a single request.
 */
export function uploadParts(path: string, method: string, size: number): { path: string; start: number; end: number }[] {
  const m = /^(.*[?&]offset=)(\d+)(.*)$/.exec(path)
  const route = path.split('?')[0]
  if (method !== 'POST' || !route.endsWith('/files/upload') || !m || size <= UPLOAD_PART) return [{ path, start: 0, end: size }]
  const base = Number(m[2])
  const out: { path: string; start: number; end: number }[] = []
  for (let start = 0; start < size; start += UPLOAD_PART) {
    out.push({ path: `${m[1]}${base + start}${m[3]}`, start, end: Math.min(start + UPLOAD_PART, size) })
  }
  return out
}
