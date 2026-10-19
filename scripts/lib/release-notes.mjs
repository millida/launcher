const PUBLIC_REPO_RAW = 'https://raw.githubusercontent.com/millida/launcher'
const SITE = 'https://millida.net/launcher'
const MAX_CHANGES = 20

const CHANGE_SUBJECT = /^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*(.+)$/i

const DOWNLOADS = [
  { os: 'windows', label: 'Windows' },
  { os: 'macos', label: 'macOS' },
  { os: 'linux', label: 'Linux' },
]

const VERSION_FILES = [
  { key: 'windows-x86_64', label: 'Windows, installer' },
  { key: 'linux-x86_64', label: 'Linux, AppImage' },
  { key: 'linux-x86_64-deb', label: 'Linux, deb' },
  { key: 'linux-x86_64-rpm', label: 'Linux, rpm' },
]

// Old public commits say "Собрано из <hash>." (kept for parsing only); new ones carry a Source-Commit trailer.
export const sourceCommitOf = (message) =>
  /^Source-Commit: ([0-9a-f]{7,40})$/m.exec(message || '')?.[1] ?? /Собрано из ([0-9a-f]{7,40})\./.exec(message || '')?.[1] ?? null

/** Public commit body: what changed in plain lines, not a bare hash. */
export function publicCommitBody({ changes = [], source }) {
  const shown = changes.slice(0, MAX_CHANGES).map((line) => `- ${line}`)
  if (changes.length > MAX_CHANGES) shown.push(`- and ${changes.length - MAX_CHANGES} more`)
  return [shown.length ? shown.join('\n') : 'Internal changes, nothing new for players.', `Source-Commit: ${source}`].join('\n\n')
}

// Everything that reaches GitHub must be English. A subject with Cyrillic is never published as is;
// the author gives the public wording in a `Changelog: <English text>` trailer of the commit body.
const CYRILLIC = /[\u0400-\u04FF]/
const CHANGELOG_TRAILER = /^Changelog:\s*(.+)$/im

export function changesFromCommits(commits) {
  const seen = new Set()
  const out = []
  for (const commit of commits) {
    const { subject, body = '' } = typeof commit === 'string' ? { subject: commit } : commit
    const typed = CHANGE_SUBJECT.exec(subject.trim())
    if (!typed) continue
    const text = (CHANGELOG_TRAILER.exec(body)?.[1] ?? typed[1]).trim()
    if (!text || CYRILLIC.test(text)) continue
    const line = text[0].toUpperCase() + text.slice(1)
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

export const changesFromSubjects = changesFromCommits

const fileName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop())

export function releaseNotes({ version, changes = [], platforms = {} }) {
  const buttons = DOWNLOADS.map(
    ({ os, label }) =>
      `<a href="${SITE}/dl/${os}"><img src="${PUBLIC_REPO_RAW}/v${version}/.github/readme/download-${os}-en.png" width="260" alt="Download for ${label}"></a>`,
  ).join('\n')

  const parts = [
    `<p>\n${buttons}\n</p>`,
    `GitHub Actions built every file in this release from the code under tag \`v${version}\`. Nobody touched them by hand. To check any file: \`gh attestation verify <file> -R millida/launcher\`. Details: [SAFETY.md](https://github.com/millida/launcher/blob/v${version}/SAFETY.md).`,
    `The installer always installs the latest version. Antivirus scan results: [millida.net/launcher/antivirus](${SITE}/antivirus).`,
  ]

  if (changes.length) {
    const shown = changes.slice(0, MAX_CHANGES).map((line) => `- ${line}`)
    if (changes.length > MAX_CHANGES) shown.push(`- and ${changes.length - MAX_CHANGES} more`)
    parts.push(`### What's new\n\n${shown.join('\n')}`)
  }

  const rows = VERSION_FILES.filter(({ key }) => platforms[key]?.url).map(
    ({ key, label }) => `| ${label} | [${fileName(platforms[key].url)}](${platforms[key].url}) |`,
  )
  if (rows.length) {
    parts.push(`<details>\n<summary>Files of this exact version</summary>\n\n| System | File |\n| --- | --- |\n${rows.join('\n')}\n</details>`)
  }

  return parts.join('\n\n') + '\n'
}
