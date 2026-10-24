/** Group names nest by «/»: «Моды/Тест» is the group «Тест» inside «Моды». */
export const GROUP_SEP = '/'

export interface GroupRow {
  path: string
  label: string
  depth: number
}

export function normalizeGroup(raw: string): string {
  return raw
    .split(GROUP_SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(GROUP_SEP)
}

/** Every group in tree order, parents included even when only a child holds builds. */
export function groupTree(names: string[]): GroupRow[] {
  const all = new Set<string>()
  for (const raw of names) {
    const parts = normalizeGroup(raw).split(GROUP_SEP).filter(Boolean)
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join(GROUP_SEP))
  }
  return [...all]
    .sort((a, b) => a.split(GROUP_SEP).join('\u0000').localeCompare(b.split(GROUP_SEP).join('\u0000')))
    .map((path) => {
      const parts = path.split(GROUP_SEP)
      return { path, label: parts[parts.length - 1]!, depth: parts.length - 1 }
    })
}
