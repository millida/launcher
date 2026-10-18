import type { SkinModState } from '../ipc/commands'

const OWN_MOD = /^millida-mod-.+\.jar$/

export function isOwnModFile(name: string): boolean {
  return OWN_MOD.test(name.replace(/\.disabled$/, ''))
}

/// Removing our jar turns the cosmetics off for the build for good, so the
/// player is asked once; declining keeps our jar and still removes the rest.
export async function keepAfterOwnModConfirm(names: string[], ask: () => Promise<boolean>): Promise<string[]> {
  if (!names.some(isOwnModFile)) return names
  if (await ask()) return names
  return names.filter((n) => !isOwnModFile(n))
}

export type SkinModOff =
  | { kind: 'quarantine'; version: string }
  | { kind: 'removed' }
  | { kind: 'off' }

export function skinModOff(state: SkinModState | null): SkinModOff | null {
  if (!state || state.conflict) return null
  if (state.quarantine != null) return { kind: 'quarantine', version: state.quarantine }
  if (state.on) return null
  if (state.offReason === 'removed') return { kind: 'removed' }
  if (state.offReason === 'off') return { kind: 'off' }
  return null
}
