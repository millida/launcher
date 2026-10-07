export interface CatalogIdentity {
  pid?: string
  slug?: string
  cfid?: number
}

const NOT_MODRINTH = /^(cf|millida):/

/// Whether a catalogue item is already in the build, judged by the ids the
/// build records: the Modrinth project id, `cf:<id>` or `millida:<slug>`.
/// Titles are never compared: two different mods can normalise to one title,
/// and a false «Установлено» would block installing the second one.
export function isInstalledInBuild(item: CatalogIdentity, installed: ReadonlySet<string>): boolean {
  if (item.pid && installed.has(item.pid)) return true
  if (item.cfid !== undefined && installed.has('cf:' + item.cfid)) return true
  // Builds installed by slug keep the slug as the project id.
  const modrinth = !item.pid || !NOT_MODRINTH.test(item.pid)
  return modrinth && !!item.slug && installed.has(item.slug)
}
