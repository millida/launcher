import { create } from 'zustand'
import { appVersion, updateNotes } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { openModal, showToast } from './ui'

// The changelog of the version that is running. The updater never returns it —
// its answer is always about a version that is not installed yet — so notes are
// kept when an update is found and read back after the relaunch.
const SEEN = 'm-whatsnew-seen'
const NOTES = 'm-whatsnew-notes:'
/// Пункты, которые игрок уже читал. Хранятся отпечатками, а не текстом: список
/// живёт долго, а сравнивать надо только «видел или нет».
const SEEN_LINES = 'm-whatsnew-lines'
/// Сколько отпечатков держим. Хватает на годы выпусков, а localStorage не растёт
/// без конца: пункт, ушедший за этот горизонт, покажется второй раз - и это
/// лучше, чем хранилище, которое однажды перестанет писаться.
const REMEMBER_LINES = 600

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

/// Отпечаток пункта. Пробелы и регистр не считаются: переписанный отступ или
/// заглавная буква в начале - это тот же пункт, а не новый.
function fingerprint(line: string): string {
  const text = line.trim().toLowerCase().replace(/\s+/g, ' ')
  let hash = 2166136261
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Только то, чего игрок ещё не читал.
 *
 * Раздел «Не выпущено» копится между выпусками, и каждая версия показывала его
 * целиком - вместе с пунктами прошлых трёх. К третьему выпуску за день это
 * простыня, которую никто не читает, а новое в ней теряется.
 *
 * Заголовок раздела остаётся, только если под ним что-то осталось: «Исправлено»
 * без единой строки - это шум.
 */
export function freshNotes(notes: string, seen: readonly string[]): string {
  const known = new Set(seen)
  const out: string[] = []
  let heading = ''
  for (const raw of notes.split('\n')) {
    const line = raw.trimEnd()
    if (/^#{1,6}\s/.test(line.trim())) {
      heading = line
      continue
    }
    if (!line.trim()) continue
    if (known.has(fingerprint(line))) continue
    if (heading) {
      out.push(heading)
      heading = ''
    }
    out.push(line)
  }
  return out.join('\n')
}

/// Отпечатки всех пунктов текста — их и запоминаем после показа.
export function notesFingerprints(notes: string): string[] {
  return notes
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^#{1,6}\s/.test(l.trim()))
    .map(fingerprint)
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

function seenLines(): string[] {
  const raw = read(SEEN_LINES)
  return raw ? raw.split(',').filter(Boolean) : []
}

/// Запоминаем показанное. Свежие идут в конец, старые вытесняются с начала.
function rememberShown(notes: string): void {
  const next = seenLines().concat(notesFingerprints(notes))
  const unique = [...new Set(next)]
  write(SEEN_LINES, unique.slice(-REMEMBER_LINES).join(','))
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
  const full = await notesFor(version)
  if (!hasChangelog(full)) return
  write(SEEN, version)
  // Показываем только непрочитанное. Всё прочитанное запоминается ДО проверки
  // на пустоту: иначе пункты, оказавшиеся все до одного знакомыми, всплыли бы
  // снова на следующем выпуске.
  const notes = freshNotes(full, seenLines())
  rememberShown(full)
  if (!hasChangelog(notes)) return
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
    // Кнопкой открывают осознанно - здесь показываем список целиком, даже
    // прочитанный: человек пришёл посмотреть, что было, а не что нового.
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
