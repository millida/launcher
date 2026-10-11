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
  { key: 'windows-x86_64', label: 'Windows, установщик' },
  { key: 'linux-x86_64', label: 'Linux, AppImage' },
  { key: 'linux-x86_64-deb', label: 'Linux, deb' },
  { key: 'linux-x86_64-rpm', label: 'Linux, rpm' },
]

// Старые коммиты публичного репозитория: «Собрано из <hash>.», новые — трейлер Source-Commit.
export const sourceCommitOf = (message) =>
  /^Source-Commit: ([0-9a-f]{7,40})$/m.exec(message || '')?.[1] ?? /Собрано из ([0-9a-f]{7,40})\./.exec(message || '')?.[1] ?? null

/** Тело коммита в публичном репозитории: что поменялось простыми строками, а не голый хеш. */
export function publicCommitBody({ changes = [], source }) {
  const shown = changes.slice(0, MAX_CHANGES).map((line) => `- ${line}`)
  if (changes.length > MAX_CHANGES) shown.push(`- и ещё ${changes.length - MAX_CHANGES}`)
  return [shown.length ? shown.join('\n') : 'Служебные правки без изменений для игрока.', `Source-Commit: ${source}`].join('\n\n')
}

export function changesFromSubjects(subjects) {
  const seen = new Set()
  const out = []
  for (const subject of subjects) {
    const text = CHANGE_SUBJECT.exec(subject.trim())?.[1]?.trim()
    if (!text) continue
    const line = text[0].toUpperCase() + text.slice(1)
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

const fileName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop())

export function releaseNotes({ version, changes = [], platforms = {} }) {
  const buttons = DOWNLOADS.map(
    ({ os, label }) =>
      `<a href="${SITE}/dl/${os}"><img src="${PUBLIC_REPO_RAW}/v${version}/.github/readme/download-${os}.png" width="260" alt="Скачать для ${label}"></a>`,
  ).join('\n')

  const parts = [
    `<p>\n${buttons}\n</p>`,
    `Все файлы этого релиза собрал GitHub Actions из кода под тегом \`v${version}\` — их никто не трогал руками. Проверить любой файл: \`gh attestation verify <файл> -R millida/launcher\`. Подробно — [SAFETY.md](https://github.com/millida/launcher/blob/v${version}/SAFETY.md).`,
    `Установщик всегда ставит свежую версию. Проверка антивирусами — [millida.net/launcher/antivirus](${SITE}/antivirus).`,
  ]

  if (changes.length) {
    const shown = changes.slice(0, MAX_CHANGES).map((line) => `- ${line}`)
    if (changes.length > MAX_CHANGES) shown.push(`- и ещё ${changes.length - MAX_CHANGES}`)
    parts.push(`### Что нового\n\n${shown.join('\n')}`)
  }

  const rows = VERSION_FILES.filter(({ key }) => platforms[key]?.url).map(
    ({ key, label }) => `| ${label} | [${fileName(platforms[key].url)}](${platforms[key].url}) |`,
  )
  if (rows.length) {
    parts.push(`<details>\n<summary>Файлы именно этой версии</summary>\n\n| Система | Файл |\n| --- | --- |\n${rows.join('\n')}\n</details>`)
  }

  return parts.join('\n\n') + '\n'
}
