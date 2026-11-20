import { invoke } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { t } from '../i18n'
import { uiConfirm } from '../state/confirm'

const SHOWN = 5

/** The names a warning lists: the first few and how many more, so a window never grows past the screen. */
export function namesList(names: string[], shown = SHOWN): string {
  return names.slice(0, shown).join(', ') + (names.length > shown ? t(' и ещё {n}', { n: names.length - shown }) : '')
}

export function dependentsText(names: string[], several: boolean): string {
  return several
    ? t('От этих модов зависят: {list}. Без них они не запустятся.', { list: namesList(names) })
    : t('От этого мода зависят: {list}. Без него они не запустятся.', { list: namesList(names) })
}

async function dependentsOf(profile: string, files: string[]): Promise<string[]> {
  if (import.meta.env.DEV && !hasTauri()) return (await import('./demoSnapshots')).demoDependents(files)
  // The check only warns: an older core or a failed read must not stop the removal itself.
  return invoke<string[]>('mod_dependents', { profile, files }).catch(() => [])
}

/**
 * Asks before mods other enabled mods require are removed or switched off.
 * null: nothing depends on them, the caller goes on as usual; true: the player
 * confirmed in this window; false: the player backed out.
 */
export async function askDependents(profile: string, files: string[], action: 'delete' | 'disable'): Promise<boolean | null> {
  if (!files.length) return null
  const names = await dependentsOf(profile, files)
  if (!names.length) return null
  const several = files.length > 1
  return uiConfirm(dependentsText(names, several), {
    title: several ? t('Эти моды нужны другим') : t('Этот мод нужен другим'),
    confirmLabel: action === 'delete' ? t('Удалить всё равно') : t('Выключить всё равно'),
  })
}
