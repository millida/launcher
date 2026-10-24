import { sharedPackSync } from '../ipc/commands'
import type { SharedChanges, SharedSync } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { uiChoice } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { t } from '../i18n'

const SHOWN = 4

const listed = (names: string[]) => names.slice(0, SHOWN).join(', ') + (names.length > SHOWN ? ' ' + t('и ещё {n}', { n: names.length - SHOWN }) : '')

/// What the author's new version does to the build, in the words of the prompt.
export function changesText(c: SharedChanges): string {
  const parts: string[] = []
  if (c.game) parts.push(t('Версия игры: {from} → {to}', { from: c.game[0], to: c.game[1] }))
  if (c.loader) parts.push(t('Загрузчик: {from} → {to}', { from: c.loader[0], to: c.loader[1] }))
  if (c.added.length) parts.push(t('Добавятся ({n}): {list}', { n: c.added.length, list: listed(c.added) }))
  if (c.removed.length) parts.push(t('Уберутся ({n}): {list}', { n: c.removed.length, list: listed(c.removed) }))
  if (c.newJars.length) parts.push(t('Свои моды автора: {list}', { list: listed(c.newJars.map((j) => j.name)) }))
  if (c.configs.length) parts.push(t('Настройки модов: {n}', { n: c.configs.length }))
  if (c.kept.length) parts.push(t('Твои файлы останутся как есть: {list}', { list: listed(c.kept) }))
  return parts.join('. ')
}

/**
 * The author's update reaches a friend's build only when the player agrees,
 * after seeing what it adds, removes and changes. Returns true when it was
 * installed.
 */
export async function offerFriendUpdate(profile: string, r: SharedSync, title?: string): Promise<boolean> {
  const details = changesText(r.changes)
  const go = await uiChoice(t('Автор обновил сборку «{name}».', { name: profile }) + (details ? ' ' + details + '.' : ''), {
    title: title || t('Обновление сборки друга'),
    confirmLabel: t('Обновить'),
    cancelLabel: t('Не сейчас'),
    danger: false,
  })
  if (go !== 'yes') return false
  const done = await sharedPackSync(
    profile,
    true,
    r.changes.newJars.map((j) => j.sha512),
  )
  if (done.status !== 'updated') return false
  void useProfiles.getState().refresh()
  showToast(t('Сборка друга обновлена'), 'ok')
  return true
}

/// Before a friend's build starts, the launcher asks the author's code whether
/// there is a newer version and offers it. A failed check never stops the launch.
export async function followFriendBuild(profile: string): Promise<void> {
  if (!hasTauri()) return
  try {
    const r = await sharedPackSync(profile, false)
    if (r.status === 'stale') await offerFriendUpdate(profile, r)
  } catch (e) {
    console.warn('[friend-build] update skipped', e)
    showToast(t('Не удалось обновить сборку друга — запускаем то, что есть'))
  }
}
