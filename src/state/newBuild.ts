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
