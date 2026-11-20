import { SESSION_EXPIRED_EVENT, api, hasMillidaAccount, isUnauthorized } from './api'
import { apiErrorText } from './apiError'
import { showLogin } from './session'
import { hasTauri } from '../ipc/tauri'
import { publishWallpaper, saveLibraryWallpaper } from '../ipc/commands'
import { showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { useWallpaper } from '../state/wallpaper'
import { closeWallpaperLibrary, type LibrarySort } from '../components/wallpaperLibStore'
import { LIBRARY_BASE, libraryPath, type OwnWallpaper, type WallpaperCard, type WallpaperPage } from './wallpaperLibFormat'
import { t } from '../i18n'

const itemPath = (id: string) => LIBRARY_BASE + '/' + encodeURIComponent(id)

export function onlyInApp(what: string): boolean {
  if (hasTauri()) return false
  showToast(t('{what} — в приложении лаунчера', { what }), 'error')
  return true
}

function askLogin() {
  closeWallpaperLibrary()
  showLogin()
}

function signed(): boolean {
  if (hasMillidaAccount()) return true
  askLogin()
  return false
}

export const fetchLibrary = (sort: LibrarySort, q: string, offset: number) =>
  api<WallpaperPage>(libraryPath(sort, q, offset))

export const fetchMine = () => api<OwnWallpaper[]>(LIBRARY_BASE + '/mine')

export async function installFromLibrary(card: WallpaperCard): Promise<number | null> {
  if (onlyInApp(t('Установка фона'))) return null
  try {
    const file = await saveLibraryWallpaper(card.id)
    useWallpaper.getState().addCustom({ kind: 'image', path: file.path, name: card.name })
  } catch (e) {
    console.error('[wallpapers] install', e)
    showToast(apiErrorText(e, t('Фон не скачался — повтори через минуту')), 'error')
    return null
  }
  try {
    const r = await api<{ downloads?: number }>(itemPath(card.id) + '/installed', { method: 'POST' })
    return typeof r?.downloads === 'number' ? r.downloads : card.downloads + 1
  } catch (e) {
    // The wallpaper is already on disk and set; a lost counter bump is not worth a toast.
    console.warn('[wallpapers] installed counter', e)
    return card.downloads + 1
  }
}

export async function toggleLike(card: WallpaperCard): Promise<{ liked: boolean; likes: number } | null> {
  if (!signed()) return null
  try {
    const r = await api<{ liked: boolean; likes: number }>(itemPath(card.id) + '/like', { method: 'POST' })
    return { liked: !!r?.liked, likes: typeof r?.likes === 'number' ? r.likes : card.likes }
  } catch (e) {
    showToast(apiErrorText(e, t('Лайк не поставился')), 'error')
    return null
  }
}

export async function publishOwn(path: string, name: string): Promise<boolean> {
  if (onlyInApp(t('Публикация фона'))) return false
  if (!signed()) return false
  try {
    await publishWallpaper(path, name.trim())
  } catch (e) {
    console.error('[wallpapers] publish', e)
    if (isUnauthorized(e)) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      return false
    }
    showToast(apiErrorText(e, t('Фон не отправился — повтори через минуту')), 'error')
    return false
  }
  showToast(t('Отправили на проверку, фон появится в библиотеке после неё'))
  return true
}

export async function removeOwn(w: OwnWallpaper): Promise<boolean> {
  const sure = await uiConfirm(t('Убрать фон «{name}» из библиотеки?', { name: w.name }), {
    confirmLabel: t('Удалить'),
    danger: true,
  })
  if (!sure) return false
  try {
    await api(itemPath(w.id), { method: 'DELETE' })
  } catch (e) {
    showToast(apiErrorText(e, t('Фон не удалился — повтори через минуту')), 'error')
    return false
  }
  showToast(t('Фон убран из библиотеки'))
  return true
}
