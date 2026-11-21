import type { ModFile, Profile } from '../ipc/commands'
import { t } from '../i18n'
import { LOADER_NAME, loaderId, plural } from './format'

/** Имя неопознанного файла по-человечески: «dungeons-and-taverns-3.0.3.f.jar» → «Dungeons and taverns». */
export function prettyFile(name: string): string {
  const bare = name.replace(/\.(jar|zip|litemod)$/i, '')
  const base = bare.replace(/[-_+ ]v?(mc)?\d+(\.\d+)+.*$/i, '') || bare
  const words = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

export const modTitle = (m: ModFile): string => m.title || prettyFile(m.name)

const line = (m: ModFile): string => {
  const title = modTitle(m).replace(/\s+/g, ' ').trim()
  const ver = (m.version_number || '').trim()
  return ver ? `${title} — ${ver}` : title
}

const byTitle = (a: ModFile, b: ModFile) => modTitle(a).localeCompare(modTitle(b), 'ru', { sensitivity: 'base' })

/**
 * Список модов сборки для поддержки, Discord, друга: версия игры и загрузчика сверху,
 * затем «Название — версия», выключенные отдельным блоком. Только названия: путей, ника и имён файлов нет.
 */
export function formatModList(pr: Profile, mods: ModFile[]): string {
  const id = loaderId(pr)
  const loader = id === 'vanilla' ? LOADER_NAME(pr) : [LOADER_NAME(pr), pr.loader_version || ''].filter(Boolean).join(' ')
  const on = mods.filter((m) => m.enabled && m.pending !== 'delete').sort(byTitle)
  const off = mods.filter((m) => !m.enabled && m.pending !== 'delete').sort(byTitle)
  const count = on.length ? on.length + ' ' + plural(on.length, t('мод'), t('мода'), t('модов')) : t('модов нет')
  const out = [`Minecraft ${pr.version} · ${loader} · ${count}`]
  if (on.length) out.push('', ...on.map(line))
  if (off.length) out.push('', t('Выключены:'), ...off.map(line))
  return out.join('\n')
}
