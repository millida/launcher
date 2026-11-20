import { invoke, type WorldInfo } from './commands'
import { tauri, type UnlistenFn } from './tauri'

export type AutoBackupMode = 'off' | 'exit' | 'daily' | 'weekly'

export interface WorldAutoBackup {
  mode: AutoBackupMode
  /** 3 | 5 | 10: automatic copies kept per world; the player's own backups are never removed. */
  keep: number
  /** Upload every automatic copy to the cloud (PLUS). */
  cloud: boolean
}

export const worldAutoBackup = (profile: string) => invoke<WorldAutoBackup>('world_autobackup', { profile })
export const setWorldAutoBackup = (profile: string, settings: WorldAutoBackup) =>
  invoke<WorldAutoBackup>('set_world_autobackup', { profile, settings })

export interface CloudBackupItem {
  id: string
  build: string
  world: string
  bytes: number
  sha256: string
  createdAt: string
}

export interface CloudBackupsStatus {
  signedIn: boolean
  plus: boolean
  quotaBytes: number
  usedBytes: number
  maxPerWorld: number
  maxFileBytes: number
  items: CloudBackupItem[]
}

export const cloudBackupsStatus = () => invoke<CloudBackupsStatus>('cloud_backups_status')
/// backup — a zip from listBackups; null zips the world first.
export const cloudBackupUpload = (profile: string, folder: string, backup: string | null) =>
  invoke<CloudBackupItem>('cloud_backup_upload', { profile, folder, backup })
/// Restores into `profile` as a new world, never over an existing one.
export const cloudBackupRestore = (profile: string, id: string) => invoke<WorldInfo>('cloud_backup_restore', { profile, id })
export const cloudBackupDelete = (id: string) => invoke<void>('cloud_backup_delete', { id })
export const cloudBackupCancel = (key: string) => invoke<boolean>('cloud_backup_cancel', { key })

export interface CloudBackupProgress {
  key: string
  profile: string
  world: string
  phase: 'pack' | 'hash' | 'upload' | 'download' | 'restore'
  done: number
  total: number
}

export function listenCloudBackupProgress(handler: (p: CloudBackupProgress) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<CloudBackupProgress>('cloud-backup-progress', (e) => handler(e.payload)).catch(() => null)
}

export interface WorldAutoBackupDone {
  profile: string
  worlds: string[]
  failed: string[]
  uploaded: number
  cloudError: string
}

export function listenWorldAutoBackup(handler: (r: WorldAutoBackupDone) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<WorldAutoBackupDone>('world-autobackup', (e) => handler(e.payload)).catch(() => null)
}
