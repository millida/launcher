export interface ShotLike {
  name: string
  caption?: string
  album?: string
  profile: string
}

const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е')

export function shotAlbums(shots: ShotLike[]): string[] {
  return [...new Set(shots.map((s) => (s.album || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/// Every typed word must appear in the name, caption, album or build of the shot.
export function filterShots<T extends ShotLike>(shots: T[], query: string, album: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  return shots.filter((s) => {
    if (album && (s.album || '') !== album) return false
    if (!words.length) return true
    const hay = norm([s.name, s.caption || '', s.album || '', s.profile].join(' '))
    return words.every((w) => hay.includes(w))
  })
}
