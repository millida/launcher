export interface JoinIntent {
  ip: string
  name: string
  licensed?: boolean
  versions?: string[]
}

interface NewBuildPreset {
  version?: string
  name?: string
  loader?: string
  join?: JoinIntent
}

let preset: NewBuildPreset | null = null

export function setNewBuildPreset(p: NewBuildPreset | null) {
  preset = p
}

export function takeNewBuildPreset(): NewBuildPreset | null {
  const p = preset
  preset = null
  return p
}

/// «Minecraft 1.21.4», а если такое имя занято — «Minecraft 1.21.4 (2)»: так же
/// нумерует и `unique_profile_name` на стороне Rust, поэтому в поле видно то
/// имя, которое реально получит сборка.
export function autoBuildName(ver: string, taken: string[]): string {
  const base = ver ? 'Minecraft ' + ver : 'Minecraft'
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const nm = base + ' (' + i + ')'
    if (!used.has(nm)) return nm
  }
}
