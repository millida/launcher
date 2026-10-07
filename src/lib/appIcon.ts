import { hasTauri } from '../ipc/tauri'
import { setAppIcon } from '../ipc/commands'
import { readPref, writePref } from './prefs'
import { hasMillidaAccount } from './api'
import { loadInvites } from './referrals'
import { usePlus } from '../state/plus'
import { effectiveIcon, isIconId } from './appIconRules'
import type { AppIconId, IconAccess } from './appIconRules'

export { APP_ICONS, effectiveIcon, iconUnlocked, isIconId } from './appIconRules'
export type { AppIconDef, AppIconId, IconAccess } from './appIconRules'

export function chosenIcon(): AppIconId {
  const v = readPref('m-app-icon', 'default')
  return isIconId(v) ? v : 'default'
}

export async function applyAppIcon(id: AppIconId): Promise<void> {
  if (!hasTauri()) return
  await setAppIcon(id).catch(() => {})
}

export function pickAppIcon(id: AppIconId) {
  writePref('m-app-icon', id)
  return applyAppIcon(id)
}

/// На каждом старте: macOS возвращает Dock к иконке бандла после перезапуска,
/// а Windows — к иконке из .exe.
export async function syncAppIcon(): Promise<void> {
  const chosen = chosenIcon()
  if (chosen === 'default' || !hasTauri()) return
  if (!hasMillidaAccount()) return
  const [invites] = await Promise.all([loadInvites().catch(() => null), usePlus.getState().load()])
  const plus = usePlus.getState()
  const access: IconAccess = { plus: plus.active, diamond: plus.diamond, perks: (invites?.perks ?? []).map((p) => p.id) }
  await applyAppIcon(effectiveIcon(chosen, access))
}
