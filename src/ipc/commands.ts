import { showToast } from '../state/ui'
import { tauri } from './tauri'

export interface Profile {
  name: string
  version: string
  fabric: boolean
  loader?: string | null
  icon?: string | null
}

export interface ModFile {
  name: string
  enabled: boolean
  project_id?: string
  version_number?: string
  title?: string
  icon_url?: string
  author?: string
  description?: string
  mc?: string
  loader?: string
  size: number
  scanned: boolean
}

export interface ScanResult {
  scanned: number
  identified: number
  items: ModFile[]
}

export interface UpdateInfo {
  file_name: string
  new_version_id: string
  new_version_number: string
}

export interface WorldEntry {
  name: string
  folder: string
  last_played: number
}

export interface WorldInstall {
  folder: string
  mismatch: string
}

export interface ServerEntry {
  name: string
  ip: string
}

export interface FoundInstance {
  name: string
  version: string
  loader: string
  path: string
  source: string
}

export interface JavaInfo {
  path: string
  version: string
}

export interface CfHit {
  id: number
  name: string
  summary: string
  logo: string
  downloads: number
  slug: string
  website: string
}

export interface ProfileSettings {
  jvmArgs?: string
  width?: number
  height?: number
  javaPath?: string
}

export interface ModpackInfo {
  slug: string
  versionId: string
}

export interface ModpackVersion {
  id: string
  name?: string
  version_number?: string
  date?: string
  changelog?: string
  type?: string
}

export interface DeviceStart {
  device_code: string
  user_code: string
  verification_uri?: string
  interval?: number
}

export interface DevicePoll {
  status: string
  nick: string
  uuid?: string
  xuid?: string
  expires_in?: number
}

export interface MsSessionResult {
  status: 'ok' | 'relogin' | 'unavailable' | 'none' | 'expired'
  nick?: string
  uuid?: string
  xuid?: string
  expires_in?: number
}

export interface McTextures {
  uuid: string
  nick: string
  skin: string | null
  cape: string | null
  slim: boolean
}

export type ProfileGroups = Record<string, string>

const invoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const T = tauri()
  if (!T) return Promise.reject(new Error('no tauri'))
  return T.core.invoke<T>(cmd, args)
}

export const convertFileSrc = (path: string): string => {
  const T = tauri()
  return T && T.core.convertFileSrc ? T.core.convertFileSrc(path) : path
}

export interface InstallJob {
  key: string
  title: string
  pct: number
  msg: string
}

export const activeInstalls = () => invoke<InstallJob[]>('active_installs', {})

export const cancelInstall = (key: string) => invoke<boolean>('cancel_install', { key })

export const addLocalFile = (profile: string, kind: string, path: string) =>
  invoke<string>('add_local_file', { profile, kind, path })

export const addServer = (profile: string, name: string, ip: string) =>
  invoke<ServerEntry[]>('add_server', { profile, name, ip })

export const backupWorld = (profile: string, folder: string) =>
  invoke<string>('backup_world', { profile, folder })

/// Empty `file` with a non-empty `mismatch` means nothing fits the build: the
/// mismatch text lists the versions the project does ship.
export interface ContentInstall {
  file: string
  mismatch: string
  warning: string
}

export const cfInstall = (
  modId: number,
  gameVersion: string,
  profile: string,
  kind: string,
  fileId?: number,
  allowMismatch = false,
) =>
  invoke<ContentInstall>('cf_install', {
    modId,
    gameVersion,
    profile,
    kind,
    fileId: fileId ?? null,
    allowMismatch,
  })

export const cfInstallModpack = (modId: number, fileId?: number) =>
  invoke<Profile>('cf_install_modpack', { modId, fileId: fileId ?? null })

export interface CfImage {
  url: string
  title: string
}

export interface CfProject {
  id: number
  name: string
  summary: string
  logo: string
  downloads: number
  authors: string
  categories: string[]
  game_versions: string[]
  website: string
  updated: string
  description: string
  gallery: CfImage[]
}

export interface CfFileInfo {
  id: number
  name: string
  file_name: string
  game_versions: string[]
  loaders: string[]
  size: number
  date: string
  release: number
  server_pack: boolean
}

export const cfProject = (modId: number) => invoke<CfProject>('cf_project', { modId })

export const cfFiles = (modId: number, gameVersion = '') =>
  invoke<CfFileInfo[]>('cf_files', { modId, gameVersion })

export const cfInstallWorld = (modId: number, profile: string, force = false) =>
  invoke<WorldInstall>('cf_install_world', { modId, profile, force })

export const cfSearch = (
  query: string,
  kind: string,
  gameVersion: string,
  loader: string,
  index = 0,
  category = 0,
  sort = 0,
) => invoke<CfHit[]>('cf_search', { query, kind, gameVersion, loader, index, category, sort })

export const checkUpdates = (profile: string, kind: string) =>
  invoke<UpdateInfo[]>('check_updates', { profile, kind })

export const countScreenshots = (profile: string) => invoke<number>('count_screenshots', { profile })

export const createProfile = (name: string, version: string, fabric: boolean, loader: string, icon: string | null) =>
  invoke<Profile>('create_profile', { name, version, fabric, loader, icon })

export const deleteContent = (profile: string, kind: string, name: string) =>
  invoke<void>('delete_content', { profile, kind, name })

export const deleteProfile = (name: string) => invoke<Profile[]>('delete_profile', { name })

export const deleteWorld = (profile: string, folder: string) => invoke<void>('delete_world', { profile, folder })

export const renameProfile = (name: string, newName: string) =>
  invoke<Profile[]>('rename_profile', { name, newName })

export const setProfileLoader = (name: string, version: string, loader: string) =>
  invoke<Profile[]>('set_profile_loader', { name, version, loader })

export const detectJava = () => invoke<JavaInfo[]>('detect_java')

export interface JavaRuntime {
  major: number
  size: number
  path: string
  in_use: boolean
}

export const listJavaRuntimes = () => invoke<JavaRuntime[]>('list_java_runtimes')

export const defaultJava = () => invoke<JavaInfo | null>('default_java')

export const setDefaultJava = (path: string | null) => invoke<void>('set_default_java', { path })

export const javaMajors = () => invoke<number[]>('java_majors')

export const downloadJavaRuntime = (major: number) => invoke<string>('download_java_runtime', { major })

export const removeJavaRuntime = (major: number) => invoke<number>('remove_java_runtime', { major })

export interface DiscordStatus {
  connected: boolean
  app_id: string
  last_error: string
  last_activity: string
}

export const discordPresence = (
  details: string,
  state: string,
  playing: boolean,
  largeImage?: string,
  largeText?: string,
  joinUrl?: string,
) => invoke<void>('discord_presence', { details, state, playing, largeImage, largeText, joinUrl })

export const discordStatus = () => invoke<DiscordStatus>('discord_status')

export const discordReconnect = () => invoke<DiscordStatus>('discord_reconnect')

export const discordClear = () => invoke<void>('discord_clear')

export const duplicateProfile = (name: string) => invoke<Profile[]>('duplicate_profile', { name })

export const exportMrpack = (profile: string, name: string, version: string, description: string) =>
  invoke<string>('export_mrpack', { profile, name, version, description })

export const getPlaytime = (profile: string) => invoke<number>('get_playtime', { profile })

export interface PlayEntry {
  key: string
  label: string
  seconds: number
  last: number
  sessions: number
}

export interface PlayStats {
  total_seconds: number
  sessions: number
  builds: PlayEntry[]
  servers: PlayEntry[]
  last_build: string
  last_server: string
  last_server_name: string
  last_at: number
}

export const getPlayStats = () => invoke<PlayStats>('get_play_stats')

export const labelServer = (addr: string, name: string) => invoke<void>('label_server', { addr, name })

export const getProfileGroups = () => invoke<ProfileGroups>('get_profile_groups')

export const importInstance = (path: string, name: string, version: string, loader: string) =>
  invoke<Profile>('import_instance', { path, name, version, loader })

export const importPackFile = (path?: string) => invoke<Profile>('import_pack_file', { path: path || null })

export const installContent = (
  project: string,
  gameVersion: string,
  profile: string,
  kind: string,
  allowMismatch = false,
) => invoke<ContentInstall>('install_content', { project, gameVersion, profile, kind, allowMismatch })

export const installMod = (project: string, gameVersion: string, profile: string) =>
  invoke<ContentInstall>('install_mod', { project, gameVersion, profile })

export const installModpack = (slug: string) => invoke<Profile>('install_modpack', { slug })

export const installModpackVersion = (slug: string, versionId: string) =>
  invoke<Profile>('install_modpack_version', { slug, versionId })

export const installVersion = (project: string, versionId: string, profile: string, kind: string) =>
  invoke<ContentInstall>('install_version', { project, versionId, profile, kind })

// Names the account to play as; the core resolves the credentials itself.
export interface LaunchAuth {
  kind: 'offline' | 'microsoft' | 'millida'
  accountId?: string
  uuid?: string
  xuid?: string
}

export const launchGame = (version: string, nick: string, fabric: boolean, ramMb: number, auth: LaunchAuth) =>
  invoke<string>('launch_game', { version, nick, fabric, ramMb, auth })

export const launchProfile = (profile: string, nick: string, ramMb: number, auth: LaunchAuth) =>
  invoke<string>('launch_profile', { profile, nick, ramMb, auth })

export const listContent = (profile: string, kind: string) =>
  invoke<ModFile[]>('list_content', { profile, kind })

export const scanContentLocal = (profile: string, kind: string) =>
  invoke<ModFile[]>('scan_content_local', { profile, kind })

export const scanContent = (profile: string, kind: string) =>
  invoke<ScanResult>('scan_content', { profile, kind })

export const listLogs = (profile: string) => invoke<string[]>('list_logs', { profile })

export const listProfiles = () => invoke<Profile[]>('list_profiles')

export const listScreenshots = (profile: string) => invoke<string[]>('list_screenshots', { profile })

export const listServers = (profile: string) => invoke<ServerEntry[]>('list_servers', { profile })

export const listVersions = () => invoke<string[]>('list_versions')

export const listWorldInstalls = (profile: string) => invoke<string[]>('list_world_installs', { profile })

export const listWorlds = (profile: string) => invoke<WorldEntry[]>('list_worlds', { profile })

export const loadProfileSettings = (profile: string) =>
  invoke<ProfileSettings>('load_profile_settings', { profile })

export interface FpsBoostState {
  enabled: boolean
  mods: string[]
  skipped: string[]
  flags: string[]
  video: boolean
  vanilla: boolean
}

export const fpsBoostState = (profile: string) => invoke<FpsBoostState>('fps_boost_state', { profile })

export const setFpsBoost = (profile: string, on: boolean) => invoke<FpsBoostState>('set_fps_boost', { profile, on })

export const millidaApi = <T = unknown>(path: string, method: string, body?: unknown) =>
  invoke<T>('millida_api', { path, method, body: body === undefined ? null : body })

export interface MillidaLoginPoll {
  status: 'pending' | 'ok' | 'denied' | 'expired'
  user?: { id: string; email: string; nickname: string | null } | null
}

// The issued tokens stay in the core vault; only the signed-in user comes back.
export const millidaLoginPoll = (deviceCode: string) => invoke<MillidaLoginPoll>('millida_login_poll', { deviceCode })

export const millidaLogout = () => invoke<void>('millida_logout')

export interface SessionStatus {
  millida: boolean
  accounts: Record<string, boolean>
}

export const sessionStatus = (accountIds: string[]) => invoke<SessionStatus>('session_status', { accountIds })

export const modpackInfo = (profile: string) => invoke<ModpackInfo>('modpack_info', { profile })

export const modpackVersions = (slug: string) => invoke<ModpackVersion[]>('modpack_versions', { slug })

export const msDevicePoll = (deviceCode: string) => invoke<DevicePoll>('ms_device_poll', { deviceCode })

export const msDeviceStart = () => invoke<DeviceStart>('ms_device_start')

export const mcTextures = (query: string) => invoke<McTextures>('mc_textures', { query })

// Binds the tokens the core kept from the finished login to the account row.
export const msSessionCommit = (deviceCode: string, accountId: string) =>
  invoke<void>('ms_session_commit', { deviceCode, accountId })

export const msSessionRefresh = (accountId: string) => invoke<MsSessionResult>('ms_session_refresh', { accountId })

export const msSessionValidate = (accountId: string) => invoke<MsSessionResult>('ms_session_validate', { accountId })

export const msSessionForget = (accountId: string) => invoke<void>('ms_session_forget', { accountId })

export interface MsCape {
  id: string
  alias: string
  url: string | null
  active: boolean
}

export interface MsProfile {
  uuid: string
  nick: string
  skin: string | null
  slim: boolean
  capes: MsCape[]
}

export const msProfile = (accountId: string) => invoke<MsProfile>('ms_profile', { accountId })

export const msResetSkin = (accountId: string) => invoke<unknown>('ms_reset_skin', { accountId })

export const msSetCape = (accountId: string, capeId: string) => invoke<unknown>('ms_set_cape', { accountId, capeId })

export const msUploadSkin = (accountId: string, pngBase64: string, slim: boolean) =>
  invoke<{ skin: string | null }>('ms_upload_skin', { accountId, pngBase64, slim })

export const openProfileFolder = (name: string) => invoke<void>('open_profile_folder', { name })

export const openScreenshots = (profile: string) => invoke<void>('open_screenshots', { profile })

export const openUrl = (url: string) =>
  invoke<void>('open_url', { url }).catch((e) => showToast('Не удалось открыть ссылку: ' + e, 'error'))

export const cancelLaunch = () => invoke<void>('cancel_launch')

export const stopGame = (profile?: string | null) => invoke<void>('stop_game', { profile: profile || null })

export const runningGames = () => invoke<string[]>('running_games')

export const gameDir = () => invoke<string>('game_dir')

export const setGameDir = (path: string, moveData: boolean) => invoke<string>('set_game_dir', { path, moveData })

export const pickGameDir = () => invoke<string | null>('pick_game_dir')
export interface CustomWallpaperFile {
  kind: string
  path: string
  name: string
}
export const pickWallpaper = () => invoke<CustomWallpaperFile | null>('pick_wallpaper')
export interface PickedTextureFile {
  name: string
  data: string
}
export const pickTexture = () => invoke<PickedTextureFile | null>('pick_texture')

export const openGameFolder = () => invoke<void>('open_game_folder')

export interface MusicTrackFile {
  path: string
  title: string
}

export const musicTracks = () => invoke<MusicTrackFile[]>('music_tracks')

export const openMusicFolder = () => invoke<void>('open_music_folder')

export const downloadMcMusic = () => invoke<number>('download_mc_music')

export interface UiSoundFile {
  event: string
  path: string
}

export const uiSounds = () => invoke<UiSoundFile[]>('ui_sounds')

export const downloadUiSounds = () => invoke<UiSoundFile[]>('download_ui_sounds')

export const quickPlay = (
  profile: string,
  nick: string,
  ramMb: number,
  world: string | null,
  server: string | null,
  auth?: LaunchAuth,
) => invoke<string>('quick_play', { profile, nick, ramMb, world, server, auth })

export const readLog = (profile: string, name: string) => invoke<string>('read_log', { profile, name })

export const removeServer = (profile: string, ip: string) =>
  invoke<ServerEntry[]>('remove_server', { profile, ip })

export const pinServerDat = (profile: string, name: string, ip: string) =>
  invoke<void>('pin_server_dat', { profile, name, ip })

export const saveProfileSettings = (
  profile: string,
  jvmArgs: string,
  width: number,
  height: number,
  javaPath: string,
) => invoke<void>('save_profile_settings', { profile, jvmArgs, width, height, javaPath })

export const scanImports = () => invoke<FoundInstance[]>('scan_imports')

export const setProfileGroup = (name: string, group: string) =>
  invoke<void>('set_profile_group', { name, group })

export const setProfileIcon = (name: string, icon: string) =>
  invoke<Profile[]>('set_profile_icon', { name, icon })

export const pickProfileCover = (profile: string) =>
  invoke<Profile[] | null>('pick_profile_cover', { profile })

export const clearProfileCover = (profile: string) => invoke<Profile[]>('clear_profile_cover', { profile })

export const shareLog = (profile: string, name: string) => invoke<string>('share_log', { profile, name })

export const testJava = (path: string) => invoke<string>('test_java', { path })

export const pickJavaPath = () => invoke<JavaInfo | null>('pick_java_path')

export const toggleContent = (profile: string, kind: string, name: string, enable: boolean) =>
  invoke<void>('toggle_content', { profile, kind, name, enable })

export const updateAll = (profile: string, kind: string) => invoke<number>('update_all', { profile, kind })

export const updateContent = (profile: string, kind: string, name: string) =>
  invoke<string>('update_content', { profile, kind, name })

export const updateModpack = (profile: string, versionId: string) =>
  invoke<Profile>('update_modpack', { profile, versionId })

export interface CrashEntry {
  file: string
  message: string
  details: string
}

export const appVersion = () => invoke<string>('app_version')

export interface DeviceSpecs {
  os: string
  os_version: string
  arch: string
  cpu: string
  cpu_cores: number
  cpu_threads: number
  ram_mb: number
}

export const deviceSpecs = () => invoke<DeviceSpecs>('device_specs')

// Flatpak builds are updated by flatpak itself, so the in-app channel is hidden.
export const isFlatpak = () => invoke<boolean>('is_flatpak')


// Fallback update path over the same signed manifest, used when the updater
// plugin can neither check nor install.
export interface FallbackUpdate {
  version: string
  notes: string
  url: string
  file: string
  signature: string
  source: string
}

export interface FallbackInstall {
  version: string
  path: string
  started: boolean
}

export const updateFallbackCheck = () => invoke<FallbackUpdate | null>('update_fallback_check')

export const updateFallbackStage = () => invoke<FallbackInstall | null>('update_fallback_stage')

export const updateFallbackRun = (path: string) => invoke<FallbackInstall>('update_fallback_run', { path })


export const uiPrefs = () => invoke<Record<string, string>>('ui_prefs')

export const setUiPref = (key: string, value: string) => invoke<void>('set_ui_pref', { key, value })

// Liveness signal: without it the core treats the window as blank and reinstalls
// the launcher. Must be called once the UI actually mounted, not from main.
export const frontendReady = () => invoke<void>('frontend_ready').catch(() => {})

export const readCrashes = () => invoke<CrashEntry[]>('read_crashes')

export const clearCrashes = () => invoke<void>('clear_crashes')

export const hostConsoleStart = (id: string) => invoke<void>('host_console_start', { id })
export const hostConsoleStop = () => invoke<void>('host_console_stop')

// Server files need an authenticated request the webview cannot make.
export const hostDownload = (id: string, path?: string) =>
  invoke<string | null>('host_download', { id, path: path ?? null })
export const hostUpload = (id: string, dir: string) => invoke<string | null>('host_upload', { id, dir })

export interface PingResult { online: number; max: number; motd: string; version: string; favicon: string | null; ms: number }
export const pingServer = (addr: string) => invoke<PingResult>('ping_server', { addr })
export interface RepairReport { checked: number; restored: number; broken: string[] }
export const repairProfile = (profile: string) => invoke<RepairReport>('repair_profile', { profile })

export const setLocalSkin = (skin: string | null, cape: string | null, slim: boolean) =>
  invoke<void>('set_local_skin', { skin, cape, slim })

// Textures live on disk: localStorage hit the webview quota and lost them silently.
export interface TextureEntry {
  file: string
  name: string
  slim: boolean
  slimManual: boolean
  data: string
}

export type TextureKind = 'skins' | 'capes'

export const listTextures = (kind: TextureKind) => invoke<TextureEntry[]>('list_textures', { kind })

export const saveTexture = (kind: TextureKind, name: string, data: string, slim: boolean) =>
  invoke<TextureEntry[]>('save_texture', { kind, name, data, slim })

// Downloaded by the core: the webview CSP blocks third-party hosts.
export const fetchTexture = (url: string) => invoke<string>('fetch_texture', { url })

export const deleteTexture = (kind: TextureKind, file: string) =>
  invoke<TextureEntry[]>('delete_texture', { kind, file })

export const setTextureSlim = (kind: TextureKind, file: string, slim: boolean, manual: boolean) =>
  invoke<TextureEntry[]>('set_texture_slim', { kind, file, slim, manual })

// Served from the core cache, which survives restarts and rate-limits upstream.
export const headAvatar = (nick: string) => invoke<string>('head_avatar', { nick })

export const cacheSize = () => invoke<number>('cache_size')
export const clearCache = () => invoke<number>('clear_cache')

export const trayAvailable = () => invoke<boolean>('tray_available')
export const hideToTray = () => invoke<void>('hide_to_tray')
export const showFromTray = () => invoke<void>('show_from_tray')
export const setRestoreOnExitNative = (on: boolean) => invoke<void>('set_restore_on_exit', { on })

export interface OverlayState { enabled: boolean; hotkey: string }
export const overlayState = () => invoke<OverlayState>('overlay_state')
export const overlaySetEnabled = (on: boolean) => invoke<void>('overlay_set_enabled', { on })
export const overlaySetHotkey = (hotkey: string) => invoke<void>('overlay_set_hotkey', { hotkey })
export const overlayNotify = (payload: { uid: string; nick: string; text: string; ts: number }) =>
  invoke<void>('overlay_notify', { payload })
export const overlayHide = () => invoke<void>('overlay_hide')
