export const PAGE_SIZE = 30

export interface ServerFilters {
  category: string
  sort: string
  license: string
  online: string
  version: string
  search: string
}

export const DEFAULT_FILTERS: ServerFilters = {
  category: '',
  sort: 'rating',
  license: '',
  online: '',
  version: '',
  search: '',
}

// Query limits are the ones the rating DTO validates against: a longer value is
// a 400, and a rejected page reads to the user as "the catalogue is down".
const SEARCH_MAX = 60
const VERSION_MAX = 16

// Every facet is decided by the rating API over the whole catalogue. Filtering
// locally only ever saw the page already loaded, which turned "1.21 by rating"
// into "whatever the first thirty rows happened to contain".
export function pageUrl(offset: number, f: ServerFilters): string {
  const q = new URLSearchParams()
  q.set('limit', String(PAGE_SIZE))
  q.set('offset', String(offset))
  q.set('sort', f.sort || DEFAULT_FILTERS.sort)
  if (f.category) q.set('category', f.category)
  if (f.license) q.set('license', f.license)
  if (f.version) q.set('version', f.version.slice(0, VERSION_MAX))
  const min = f.online === 'live' ? 1 : Number(f.online || 0)
  if (min > 0) q.set('minOnline', String(min))
  const search = f.search.trim()
  if (search) q.set('search', search.slice(0, SEARCH_MAX))
  return '/rating/servers?' + q.toString()
}

export const isFiltered = (f: ServerFilters) =>
  !!(f.category || f.license || f.online || f.version || f.search.trim()) || f.sort !== DEFAULT_FILTERS.sort
