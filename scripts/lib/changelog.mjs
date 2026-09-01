/**
 * Reads CHANGELOG.md sections. The section of the version being released goes
 * into latest.json as `notes`, and that text is what the launcher shows in its
 * "what is new" window — so the parser is deliberately forgiving about heading
 * shape and strict about never returning half of a neighbouring release.
 */

const UNRELEASED = /^(не выпущено|unreleased)$/i

const normalize = (v) => String(v || '').trim().replace(/^v/i, '')

/** Matches every heading shape the file uses, released or unreleased. */
function headingVersion(line) {
  const m = /^##\s+(.+?)\s*$/.exec(line)
  if (!m) return null
  const title = m[1].replace(/^\[(.+?)\]/, '$1')
  const name = title.split(/\s+[—–-]\s+/)[0].trim()
  return name.replace(/^\[|\]$/g, '')
}

/**
 * Section body of one version, without its heading. Returns '' when the version
 * has no section or the section is empty: an empty answer means "no changelog",
 * never a placeholder.
 */
export function notesFor(version, text) {
  const wanted = normalize(version)
  if (!wanted || !text) return ''
  const lines = String(text).split(/\r?\n/)
  const out = []
  let inside = false
  for (const line of lines) {
    const name = headingVersion(line)
    if (name !== null) {
      if (inside) break
      inside = !UNRELEASED.test(name) && normalize(name) === wanted
      continue
    }
    if (inside) out.push(line)
  }
  return out.join('\n').trim()
}

/** Body of the unreleased section, empty when there is none. */
export function unreleasedNotes(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  let inside = false
  for (const line of lines) {
    const name = headingVersion(line)
    if (name !== null) {
      if (inside) break
      inside = UNRELEASED.test(name)
      continue
    }
    if (inside) out.push(line)
  }
  return out.join('\n').trim()
}

/**
 * What a release publishes as its notes. A push to `production` is versioned
 * `1.0.<run number>`, a number nobody can write into the file beforehand, so
 * the unreleased section is what such a build ships.
 */
export function releaseNotes(version, text) {
  return notesFor(version, text) || unreleasedNotes(text)
}

/** Versions the file documents, newest first, without the unreleased section. */
export function releasedVersions(text) {
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const name = headingVersion(line)
    if (name === null || UNRELEASED.test(name)) continue
    out.push(normalize(name))
  }
  return out
}
