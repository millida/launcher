import { tauri } from './tauri'
import type { UnlistenFn } from './tauri'
import type { RewindState } from './commands'

/** Подписка на событие ядра; без ядра (браузер) или при ошибке подписки — null. */
function on<P>(name: string, handler: (payload: P) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<P>(name, (e) => handler(e.payload)).catch(() => null)
}

export interface LaunchProgress {
  stage: string
  pct: number
  msg: string
}

export function listenLaunchProgress(handler: (p: LaunchProgress) => void): Promise<UnlistenFn | null> {
  return on<LaunchProgress>('launch-progress', handler)
}

export function listenLaunchWarning(handler: (msg: string) => void): Promise<UnlistenFn | null> {
  return on<string>('launch-warning', handler)
}

/// The build has several mods with their own loading screen (or one the core could not name), and
/// only one may be set in its fml.toml: the player has to choose. `mods` are jar file names.
export interface EarlyWindowNotice {
  profile: string
  mods: string[]
}

export function listenEarlyWindow(handler: (n: EarlyWindowNotice) => void): Promise<UnlistenFn | null> {
  return on<EarlyWindowNotice>('launch-early-window', handler)
}

export interface InstallProgress {
  key: string
  title: string
  pct: number
  msg: string
  done: boolean
  error: string
  pausable: boolean
  /** Секунд до конца, только когда загрузка может сказать честно (ядро: pulse.rs). */
  eta?: number
}

export function listenInstallProgress(handler: (p: InstallProgress) => void): Promise<UnlistenFn | null> {
  return on<InstallProgress>('install-progress', handler)
}

export interface ShareProgress {
  profile: string
  done: number
  total: number
}

export function listenShareProgress(handler: (p: ShareProgress) => void): Promise<UnlistenFn | null> {
  return on<ShareProgress>('share-progress', handler)
}

export interface DroppedPack {
  id: number
  name: string
}

export function listenPackDrag(handler: (over: boolean) => void): Promise<UnlistenFn | null> {
  return on<boolean>('pack-drag', handler)
}

export function listenPackDrop(handler: (packs: DroppedPack[]) => void): Promise<UnlistenFn | null> {
  return on<DroppedPack[]>('pack-drop', (p) => handler(p || []))
}

/** Игра показала окно (ядро: launch_perf GAME_WINDOW_EVENT): лаунчер может прятаться. */
export function listenGameWindow(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  return on<string>('game-window', handler)
}

/** Игра живёт, а окна нет 4 минуты (ядро: GAME_STUCK_EVENT): лаунчер вернулся и спрашивает. */
export function listenGameStuck(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  return on<string>('game-stuck', handler)
}

export function listenGameExit(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  return on<string>('game-exit', handler)
}

// The core gives the frontend ~1.5s to install a staged update before it exits.
export function listenTrayExit(handler: () => void): Promise<UnlistenFn | null> {
  return on('tray-exit', () => handler())
}

export function listenWindowVisibility(handler: (visible: boolean) => void): Promise<UnlistenFn | null> {
  return on<boolean>('window-visibility', handler)
}

export function listenDragDrop(handler: (paths: string[]) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T || !T.event) return Promise.resolve(null)
  return T.event
    .listen<{ paths?: string[] } | string[]>('tauri://drag-drop', (e) => {
      const p = e.payload as any
      handler((p && (p.paths || p)) || [])
    })
    .catch(() => null)
}

// Highlight state for the drop zone: enter/leave fire around the actual drop.
export function listenDragState(handler: (active: boolean) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T || !T.event) return Promise.resolve(null)
  return Promise.all([
    T.event.listen('tauri://drag-enter', () => handler(true)),
    T.event.listen('tauri://drag-leave', () => handler(false)),
    T.event.listen('tauri://drag-drop', () => handler(false)),
  ])
    .then((subs) => () => subs.forEach((u) => u()))
    .catch(() => null)
}

export function listenHostConsole(handler: (line: string) => void): Promise<UnlistenFn | null> {
  return on<string>('host-console', handler)
}

export interface WorldDownloadProgress {
  phase: 'archiving' | 'downloading'
  received: number
  total: number
}

export function listenHostWorldDownload(handler: (p: WorldDownloadProgress) => void): Promise<UnlistenFn | null> {
  return on<WorldDownloadProgress>('host-world-download', handler)
}

/// End of the log the node replays on connect. What came before it is history
/// the server had already written, what comes after is live.
export function listenHostConsoleReplayEnd(handler: () => void): Promise<UnlistenFn | null> {
  return on('host-console-replay-end', () => handler())
}

// The core batches lines; a bare string is still accepted for older core builds.
export function listenGameLog(handler: (lines: string[]) => void): Promise<UnlistenFn | null> {
  return on<string | string[]>('game-log', (p) => handler(Array.isArray(p) ? p : [p]))
}

// Адрес сервера, на котором игрок прямо сейчас; пустая строка — меню или одиночная игра.
export function listenGameServer(handler: (addr: string) => void): Promise<UnlistenFn | null> {
  return on<string>('game-server', (p) => handler(p || ''))
}

/** Пачка строк лога с номером первой: по номеру читатель продолжает снимок без пропусков и повторов. */
export interface GameLogBatch {
  seq: number
  lines: string[]
}

export function listenGameLogSeq(handler: (b: GameLogBatch) => void): Promise<UnlistenFn | null> {
  return on<GameLogBatch>('game-log-seq', handler)
}

export function listenGameLogStart(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  return on<string>('game-log-start', handler)
}

/** Пять секунд игры глазами мода: кадры, память, окно впереди. */
export interface GamePerf {
  profile: string
  focused: boolean
  fps: number
  world: boolean
  throttled: boolean
  heapMb: number
  maxMb: number
  gcPct: number
  /** Когда мод прислал кадры (мс с 1970): есть у отчётов, что ядро копило, пока окна не было. */
  at?: number
}

export function listenGamePerf(handler: (p: GamePerf) => void): Promise<UnlistenFn | null> {
  return on<GamePerf>('game-perf', handler)
}

export interface CrashAction {
  kind: string
  label: string
  arg?: string
  hint?: string
  steps?: string[]
}

export interface CrashInfo {
  profile: string
  reason: string
  tail: string
  culprits?: string[]
  actions?: CrashAction[]
  /// Устойчивый класс вылета из ядра (own_mod, missing_deps, oom, …).
  kind?: string
  /// Первая осмысленная строка исключения (≤300), пути и ник уже вычищены ядром.
  cause?: string
  logFile?: string
  /// Jar нашего мода, с которым шла игра («millida-mod-fabric-1.20.1-0.2.18.jar»).
  modJar?: string
  /// How the game process ended: decimal code, Windows NTSTATUS in hex or `sig<N>`.
  exit?: string
}
export interface PackAccessLost {
  profile: string
  message: string
  removed: boolean
}
export function listenPackAccessLost(handler: (info: PackAccessLost) => void): Promise<UnlistenFn | null> {
  return on<PackAccessLost>('pack-access-lost', handler)
}
export function listenGameCrash(handler: (info: CrashInfo) => void): Promise<UnlistenFn | null> {
  return on<CrashInfo>('game-crash', handler)
}

export function listenRealtimeRelay(handler: (payload: unknown) => void): Promise<UnlistenFn | null> {
  return on<unknown>('realtime-relay', handler)
}

export interface PartyVoiceState {
  party: string
  state: 'connected' | 'lost' | 'mic_failed' | 'device_fallback'
  reason: string | null
}

export interface PartyVoiceLevels {
  me: number
  speakers: { userId: string; level: number }[]
}

export function listenPartyVoiceState(handler: (s: PartyVoiceState) => void): Promise<UnlistenFn | null> {
  return on<PartyVoiceState>('party-voice://state', handler)
}

export function listenPartyVoiceLevels(handler: (l: PartyVoiceLevels) => void): Promise<UnlistenFn | null> {
  return on<PartyVoiceLevels>('party-voice://levels', handler)
}

export function listenRewindState(handler: (s: RewindState) => void): Promise<UnlistenFn | null> {
  return on<RewindState>('rewind-state', handler)
}

export interface ClipSaved {
  ok: boolean
  name: string
  message: string
}

export function listenRewindClip(handler: (c: ClipSaved) => void): Promise<UnlistenFn | null> {
  return on<ClipSaved>('rewind-clip', handler)
}
