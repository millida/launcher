export const PL_STAGES = ['Проверка файлов', 'Java', 'Ассеты и библиотеки', 'Запуск игры']

export const REPAIR_STAGES = ['Файлы игры', 'Java', 'Ассеты и библиотеки', 'Моды и контент']

export interface PrelaunchView {
  open: boolean
  stage: number
  pct: number
  mode: 'launch' | 'repair'
}

export function prelaunchStageName(pl: Pick<PrelaunchView, 'stage' | 'mode'>): string {
  const stages = pl.mode === 'repair' ? REPAIR_STAGES : PL_STAGES
  const at = Math.max(0, Math.min(Math.floor(pl.stage) || 0, stages.length - 1))
  return stages[at]!
}

export const prelaunchPct = (pct: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(pct) ? pct : 0)))

export type PlayButtonState =
  | { kind: 'play' }
  | { kind: 'installing'; stage: string; pct: number }
  | { kind: 'stop'; profile: string }

export interface PlayButtonInput {
  modeKind: 'build' | 'version' | 'premium' | 'server' | null
  selected: string | null
  running: readonly string[]
  prelaunch: PrelaunchView
}

/// A game already running for the chosen mode turns the launch button into its stop
/// button: a second copy of the same build shares its worlds. A preparation in
/// progress wins over both, so the button never flips to "stop" under the cursor
/// in the moment between "the process started" and "the progress closed".
export function playButtonState({ modeKind, selected, running, prelaunch }: PlayButtonInput): PlayButtonState {
  if (prelaunch.open) return { kind: 'installing', stage: prelaunchStageName(prelaunch), pct: prelaunchPct(prelaunch.pct) }
  if (modeKind === 'build') return selected && running.includes(selected) ? { kind: 'stop', profile: selected } : { kind: 'play' }
  if (modeKind && running.length) return { kind: 'stop', profile: running[running.length - 1]! }
  return { kind: 'play' }
}
