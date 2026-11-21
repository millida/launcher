import { create } from 'zustand'
import type { WorldInfo } from '../ipc/commands'
import {
  cloudBackupCancel,
  cloudBackupDelete,
  cloudBackupRestore,
  cloudBackupsStatus,
  cloudBackupUpload,
  type CloudBackupItem,
  listenCloudBackupProgress,
  type CloudBackupProgress,
  type CloudBackupsStatus,
} from '../ipc/worldBackups'
import { hasTauri } from '../ipc/tauri'
import { DEMO_WORLD_BACKUPS, demoCloudBackups } from '../lib/demo'
import { showToast } from './ui'
import { t, tx } from '../i18n'

// Transfers live in the core and outlive the component that started them: the worlds tab and
// the world cards read one shared state, keyed exactly like the core (`up:<build>/<world>`, `down:<id>`).

export type CloudTransfer = Omit<CloudBackupProgress, 'key'>

interface CloudBackupsState {
  status: CloudBackupsStatus | null
  loading: boolean
  error: string
  transfers: Record<string, CloudTransfer>
}

export const useCloudBackups = create<CloudBackupsState>(() => ({ status: null, loading: false, error: '', transfers: {} }))

export const cloudUploadKey = (profile: string, world: string) => `up:${profile}/${world}`
export const cloudRestoreKey = (id: string) => `down:${id}`

const cancelled = new Set<string>()
let listening = false
let seq = 0

function listen() {
  if (listening || !hasTauri()) return
  listening = true
  void listenCloudBackupProgress(({ key, ...p }) => {
    const transfers = useCloudBackups.getState().transfers
    if (!transfers[key]) return
    useCloudBackups.setState({ transfers: { ...transfers, [key]: p } })
  })
}

function begin(key: string, p: CloudTransfer) {
  useCloudBackups.setState((s) => ({ transfers: { ...s.transfers, [key]: p } }))
}

function end(key: string) {
  cancelled.delete(key)
  useCloudBackups.setState((s) => {
    const rest = { ...s.transfers }
    delete rest[key]
    return { transfers: rest }
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** DEV preview only: a transfer that moves the bar and can be cancelled. */
async function demoTransfer(key: string, phase: CloudTransfer['phase'], bytes: number) {
  for (let i = 1; i <= 20; i++) {
    await sleep(120)
    if (cancelled.has(key)) throw new Error('cancelled')
    const cur = useCloudBackups.getState().transfers[key]
    if (cur) begin(key, { ...cur, phase, done: (bytes * i) / 20, total: bytes })
  }
}

export function cloudErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  if (raw === 'no tauri') return t('Доступно в приложении')
  return tx(e)
}

export async function refreshCloudBackups(): Promise<void> {
  const mine = ++seq
  useCloudBackups.setState({ loading: true, error: '' })
  try {
    const status = hasTauri() ? await cloudBackupsStatus() : DEMO_WORLD_BACKUPS ? demoCloudBackups() : null
    if (mine === seq) useCloudBackups.setState({ status, loading: false })
  } catch (e) {
    if (mine === seq) useCloudBackups.setState({ loading: false, error: cloudErrorText(e) })
  }
}

/** `backup` is a zip from the build's backup list; null zips the world first. */
export async function uploadToCloud(profile: string, world: string, backup: string | null): Promise<CloudBackupItem | null> {
  const key = cloudUploadKey(profile, world)
  if (useCloudBackups.getState().transfers[key]) return null
  listen()
  begin(key, { profile, world, phase: backup ? 'hash' : 'pack', done: 0, total: 0 })
  try {
    let item: CloudBackupItem
    if (hasTauri()) {
      item = await cloudBackupUpload(profile, world, backup)
    } else if (DEMO_WORLD_BACKUPS) {
      await demoTransfer(key, 'upload', 900 * 1024 * 1024)
      item = { id: 'demo-new', build: profile, world, bytes: 900 * 1024 * 1024, sha256: '', createdAt: new Date().toISOString() }
    } else {
      throw new Error('no tauri')
    }
    showToast(t('Мир «{name}» в облаке', { name: world }), 'ok')
    void refreshCloudBackups()
    return item
  } catch (e) {
    if (cancelled.has(key)) {
      showToast(t('Загрузка отменена'))
    } else {
      showToast(t('Не удалось загрузить в облако: {error}', { error: cloudErrorText(e) }), 'error', undefined, {
        label: t('Повторить'),
        run: () => void uploadToCloud(profile, world, backup),
      })
    }
    return null
  } finally {
    end(key)
  }
}

/** Restores into `profile` as a new world; resolves with it, or null when it did not happen. */
export async function restoreFromCloud(profile: string, item: CloudBackupItem): Promise<WorldInfo | null> {
  const key = cloudRestoreKey(item.id)
  if (useCloudBackups.getState().transfers[key]) return null
  listen()
  begin(key, { profile, world: item.world, phase: 'download', done: 0, total: item.bytes })
  try {
    let world: WorldInfo | null = null
    if (hasTauri()) {
      world = await cloudBackupRestore(profile, item.id)
    } else if (DEMO_WORLD_BACKUPS) {
      await demoTransfer(key, 'download', item.bytes)
    } else {
      throw new Error('no tauri')
    }
    showToast(t('Мир «{name}» восстановлен отдельным миром', { name: world ? world.name : item.world }), 'ok')
    return world
  } catch (e) {
    if (cancelled.has(key)) {
      showToast(t('Загрузка отменена'))
    } else {
      showToast(t('Не удалось восстановить из облака: {error}', { error: cloudErrorText(e) }), 'error', undefined, {
        label: t('Повторить'),
        run: () => void restoreFromCloud(profile, item),
      })
    }
    return null
  } finally {
    end(key)
  }
}

export async function deleteFromCloud(item: CloudBackupItem): Promise<boolean> {
  try {
    if (hasTauri()) await cloudBackupDelete(item.id)
    else if (!DEMO_WORLD_BACKUPS) throw new Error('no tauri')
    const status = useCloudBackups.getState().status
    if (status) {
      useCloudBackups.setState({
        status: { ...status, usedBytes: Math.max(0, status.usedBytes - item.bytes), items: status.items.filter((i) => i.id !== item.id) },
      })
    }
    showToast(t('Копия удалена из облака'), 'ok')
    if (hasTauri()) void refreshCloudBackups()
    return true
  } catch (e) {
    showToast(t('Не удалось удалить копию: {error}', { error: cloudErrorText(e) }), 'error')
    return false
  }
}

export function cancelCloudTransfer(key: string) {
  cancelled.add(key)
  if (hasTauri()) void cloudBackupCancel(key).catch(() => cancelled.delete(key))
}
