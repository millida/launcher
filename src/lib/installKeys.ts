// Must match the job names in src-tauri/src/engine/core/jobs.rs, otherwise cancelling or
// resuming a running install cannot find the task.

export const keyCfModpack = (modId: number): string => 'cf-modpack:' + modId

export const keyMrModpack = (slug: string, target?: string): string =>
  target ? 'mr-modpack:' + slug + ':' + target : 'mr-modpack:' + slug

export const keyContent = (source: 'cf' | 'mr', profile: string, kind: string, project: string | number): string =>
  source + '-' + kind + ':' + profile + ':' + project

/// Which build a catalogue row is talking about. The row shows «Установлено»
/// only if it asks about the same build the install writes into: keyed by one
/// name and installed into another, the status of a finished install landed
/// under a key nobody read, and the button kept offering to install again.
export function pickTargetName(scoped: string | null, profiles: string[], selected: string): string {
  if (scoped && profiles.includes(scoped)) return scoped
  if (profiles.length === 1) return profiles[0]
  if (selected && profiles.includes(selected)) return selected
  return ''
}
