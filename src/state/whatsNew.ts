import { create } from 'zustand'
import { appVersion, updateNotes } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { openModal, showToast } from './ui'

// The changelog of the version that is running. The updater never returns it —
// its answer is always about a version that is not installed yet — so notes are
// kept when an update is found and read back after the relaunch.
const SEEN = 'm-whatsnew-seen'
const NOTES = 'm-whatsnew-notes:'

interface WhatsNewState {
  version: string
  notes: string
  loading: boolean
  set: (p: Partial<WhatsNewState>) => void
}

export const useWhatsNew = create<WhatsNewState>((set) => ({
  version: '',
  notes: '',
  loading: false,
  set: (p) => set(p),
}))

/// The release pipeline writes a stand-in line when a tag carries no message.
/// Showing a window whose whole content is "Обновление Millida Launcher 1.2.3"
/// tells the player nothing, so that counts as "no changelog".
const PLACEHOLDER = /^обновление millida launcher\b/i

export function hasChangelog(notes: string): boolean {
  const lines = notes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return false
  return !(lines.length === 1 && PLACEHOLDER.test(lines[0]))
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

export function rememberNotes(version: string, notes: string): void {
  if (!version || !hasChangelog(notes)) return
  write(NOTES + version, notes)
}

export function storedNotes(version: string): string {
  return read(NOTES + version)
}

async function notesFor(version: string): Promise<string> {
  const local = storedNotes(version)
  if (local) return local
  if (!hasTauri()) return ''
  const upd = await updateNotes().catch(() => null)
  if (!upd || upd.version !== version || !hasChangelog(upd.notes)) return ''
  rememberNotes(version, upd.notes)
  return upd.notes
}

/// Shown once per version, and only for a version the user was already running
/// something else before: on a first install there is nothing "new" yet.
export async function initWhatsNew(): Promise<void> {
  if (!hasTauri()) return
  const version = await appVersion().catch(() => '')
  if (!version) return
  const seen = read(SEEN)
  if (seen === version) return
  if (!seen) {
    write(SEEN, version)
    return
  }
  const notes = await notesFor(version)
  if (!hasChangelog(notes)) return
  write(SEEN, version)
  useWhatsNew.getState().set({ version, notes })
  openModal('wnModal')
}

/// The button next to the version: opens the same window on demand, saying so
/// when this release published no changelog.
export async function openWhatsNew(): Promise<void> {
  if (!hasTauri()) {
    showToast('Доступно в приложении', 'error')
    return
  }
  const st = useWhatsNew.getState()
  if (st.notes) {
    openModal('wnModal')
    return
  }
  st.set({ loading: true })
  try {
    const version = await appVersion()
    const notes = await notesFor(version)
    if (!hasChangelog(notes)) {
      showToast('У версии ' + version + ' нет списка изменений')
      return
    }
    useWhatsNew.getState().set({ version, notes })
    openModal('wnModal')
  } catch (e) {
    showToast('Не удалось получить список изменений: ' + e, 'error')
  } finally {
    useWhatsNew.getState().set({ loading: false })
  }
}
