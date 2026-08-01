// Must match the job names in src-tauri/src/engine/core/jobs.rs, otherwise cancelling or
// resuming a running install cannot find the task.

export const keyCfModpack = (modId: number): string => 'cf-modpack:' + modId

export const keyMrModpack = (slug: string, target?: string): string =>
  target ? 'mr-modpack:' + slug + ':' + target : 'mr-modpack:' + slug

export const keyContent = (source: 'cf' | 'mr', profile: string, kind: string, project: string | number): string =>
  source + '-' + kind + ':' + profile + ':' + project
