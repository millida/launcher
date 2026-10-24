export type ServiceState = 'operational' | 'degraded' | 'down' | 'maintenance' | 'unknown'

interface StatusComponent {
  name: string
  state: ServiceState
}

export interface StatusPage {
  state: ServiceState
  categories?: Array<{ name: string; state: ServiceState; components?: StatusComponent[] }>
  incidents?: Array<{ title: string; resolvedAt: string | null }>
}

export interface Outage {
  state: 'degraded' | 'down' | 'maintenance'
  /** What is broken, as the status page names it: an open incident, else the affected parts. */
  what: string
}

export const STATUS_PAGE_URL = 'https://millida.net/status'
export const STATUS_POLL_MS = 3 * 60_000

const SEVERITY: Record<Outage['state'], number> = { maintenance: 1, degraded: 2, down: 3 }

const isOutage = (s: ServiceState): s is Outage['state'] => s === 'degraded' || s === 'down' || s === 'maintenance'

export function outageOf(page: StatusPage | null | undefined): Outage | null {
  if (!page) return null
  const broken = (page.categories ?? []).flatMap((c) => {
    const parts = (c.components ?? []).filter((x) => isOutage(x.state))
    if (parts.length) return parts.map((x) => ({ name: x.name, state: x.state as Outage['state'] }))
    return isOutage(c.state) ? [{ name: c.name, state: c.state }] : []
  })
  const worst = [page.state, ...broken.map((b) => b.state)]
    .filter(isOutage)
    .sort((a, b) => SEVERITY[b] - SEVERITY[a])[0]
  if (!worst) return null
  const incident = (page.incidents ?? []).find((i) => !i.resolvedAt)?.title?.trim()
  const what = incident || [...new Set(broken.map((b) => b.name))].slice(0, 3).join(', ')
  return { state: worst, what }
}
