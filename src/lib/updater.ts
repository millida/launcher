import { check, type Update } from '@tauri-apps/plugin-updater'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { hasTauri, tauri } from '../ipc/tauri'
import {
  appVersion,
  isFlatpak,
  updateFallbackCheck,
  updateFallbackRun,
  updateFallbackStage,
  type FallbackUpdate,
} from '../ipc/commands'
import { showToast } from '../state/ui'
import { useUpdate } from '../state/update'
import { openExt } from './api'
import { reportError } from './crash'

export interface UpdateInfo {
  version: string
  notes: string
  install: () => Promise<void>
}

export const DOWNLOAD_PAGE = 'https://millida.net/launcher'

const FAILED_KEY = 'm-upd-failed'
const PROBE_EVERY = 1800000

let pending: UpdateInfo | null = null
let current: Update | null = null
let downloading: Promise<void> | null = null
let downloaded = false
let installing = false
let fallback: FallbackUpdate | null = null
let fallbackFile: string | null = null
let fallbackStaging: Promise<string | null> | null = null
let lastProbe = 0

export const pendingUpdate = () => pending
export const updateReady = () => (downloaded && !!current) || !!fallbackFile

const updatesAllowed = () => hasTauri() && !import.meta.env.DEV

/// Flatpak updates itself and mounts /app read-only, so the fallback channel cannot install there.
let managedOutside: boolean | null = null

async function updatesManagedOutside(): Promise<boolean> {
  if (managedOutside === null) managedOutside = await isFlatpak().catch(() => false)
  return managedOutside
}

async function updatesReady(): Promise<boolean> {
  return updatesAllowed() && !(await updatesManagedOutside())
}

/// The Update object is reused for the same version: rebuilding it under an in-flight download
/// fails with "Update.install called before Update.download".
function remember(upd: Update) {
  if (current && current.version === upd.version && (downloaded || downloading)) return
  current = upd
  downloading = null
  downloaded = false
  useUpdate.getState().set({ version: upd.version, staged: false, manual: false, failed: false })
  pending = { version: upd.version, notes: upd.body || '', install: async () => applyUpdate() }
}

function ensureDownloaded(): Promise<Update> {
  if (!current) return Promise.reject(new Error('нет обновления'))
  const upd = current
  if (downloaded) return Promise.resolve(upd)
  if (!downloading) {
    downloading = upd.download().then(() => {
      downloaded = true
      useUpdate.getState().set({ staged: true })
    })
  }
  return downloading.then(() => upd)
}

async function quit(): Promise<void> {
  try {
    await exit(0)
  } catch {
    const T = tauri()
    const w = T && T.window ? T.window.getCurrentWindow() : null
    if (w && w.destroy) await w.destroy().catch(() => {})
  }
}

function markPluginFailed(version: string) {
  try {
    localStorage.setItem(FAILED_KEY, version)
  } catch {}
}

async function pluginGaveUp(): Promise<boolean> {
  let target: string | null = null
  try {
    target = localStorage.getItem(FAILED_KEY)
  } catch {}
  if (!target) return false
  const cur = await appVersion().catch(() => '')
  if (cur && cur === target) {
    try {
      localStorage.removeItem(FAILED_KEY)
    } catch {}
    return false
  }
  return true
}

async function probeFallback(): Promise<FallbackUpdate | null> {
  if (!(await updatesReady())) return null
  lastProbe = Date.now()
  try {
    const upd = await updateFallbackCheck()
    if (!upd) return null
    if (!fallback || fallback.version !== upd.version) {
      fallback = upd
      fallbackFile = null
      fallbackStaging = null
    }
    pending = { version: upd.version, notes: upd.notes || '', install: async () => applyFallback() }
    useUpdate.getState().set({ version: upd.version, staged: !!fallbackFile, manual: true, failed: false })
    void stageFallback().catch(() => {})
    return upd
  } catch (e) {
    void reportError('updater-fallback', e)
    return null
  }
}

function stageFallback(): Promise<string | null> {
  if (fallbackFile) return Promise.resolve(fallbackFile)
  if (!fallbackStaging) {
    fallbackStaging = updateFallbackStage()
      .then((res) => {
        fallbackFile = res ? res.path : null
        if (res) useUpdate.getState().set({ version: res.version, staged: true, manual: true })
        return fallbackFile
      })
      .catch((e) => {
        fallbackStaging = null
        void reportError('updater-fallback', e)
        throw e
      })
  }
  return fallbackStaging
}

const BOOT_CHECK_TIMEOUT = 5000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))])
}

/// Applied at startup, before the launcher UI opens: on Windows the installer terminates the
/// running process, so it cannot be applied mid-session. Returns true when the install started.
export async function bootUpdate(): Promise<boolean> {
  if (!(await updatesReady())) return false
  const st = useUpdate.getState()
  st.set({ bootPhase: 'checking', bootPct: 0 })
  try {
    if (await pluginGaveUp()) {
      const f = await withTimeout(probeFallback(), BOOT_CHECK_TIMEOUT)
      if (!f) {
        st.set({ bootPhase: 'idle' })
        return false
      }
      st.set({ bootPhase: 'downloading', version: f.version })
      const file = await stageFallback()
      if (!file) throw new Error('нет файла обновления')
      st.set({ bootPhase: 'installing' })
      const res = await updateFallbackRun(file)
      if (!res.started) throw new Error('установщик не запустился')
      await quit()
      return true
    }

    const upd = await withTimeout(check(), BOOT_CHECK_TIMEOUT)
    if (!upd) {
      st.set({ bootPhase: 'idle' })
      return false
    }
    remember(upd)
    st.set({ bootPhase: 'downloading', version: upd.version, bootPct: 0 })
    let total = 0
    let got = 0
    await upd.download((e) => {
      if (e.event === 'Started') total = e.data.contentLength || 0
      else if (e.event === 'Progress') {
        got += e.data.chunkLength || 0
        if (total) useUpdate.getState().set({ bootPct: Math.min(99, Math.round((got / total) * 100)) })
      }
    })
    downloaded = true
    installing = true
    useUpdate.getState().set({ bootPhase: 'installing', bootPct: 100 })
    await upd.install()
    await relaunch()
    return true
  } catch (e) {
    installing = false
    downloading = null
    void reportError('updater-boot', e)
    if (current) markPluginFailed(current.version)
    useUpdate.getState().set({ bootPhase: 'idle' })
    void autoUpdate()
    return false
  }
}

/// Otherwise installed on exit: a background install would kill the running process.
export async function autoUpdate(): Promise<{ version: string } | null> {
  if (!(await updatesReady())) return null
  if (await pluginGaveUp()) {
    const f = await probeFallback()
    return f ? { version: f.version } : null
  }
  try {
    const upd = await check()
    if (!upd) {
      if (Date.now() - lastProbe > PROBE_EVERY) {
        const f = await probeFallback()
        if (f) return { version: f.version }
      }
      return null
    }
    remember(upd)
    await ensureDownloaded()
    return { version: upd.version }
  } catch (e) {
    downloading = null
    void reportError('updater', e)
    const f = await probeFallback()
    return f ? { version: f.version } : null
  }
}

export async function installUpdateOnExit(): Promise<boolean> {
  if (installing) return false
  if (fallbackFile) {
    installing = true
    useUpdate.getState().set({ busy: true })
    showToast('Ставим обновление ' + (fallback ? fallback.version : '') + '…')
    try {
      await updateFallbackRun(fallbackFile)
    } catch (e) {
      void reportError('updater-fallback', e)
    }
    await quit()
    return true
  }
  if (!downloaded || !current) return false
  installing = true
  useUpdate.getState().set({ busy: true })
  showToast('Ставим обновление ' + (useUpdate.getState().version || '') + '…')
  try {
    await current.install()
  } catch (e) {
    markPluginFailed(current.version)
    void reportError('updater', e)
  }
  await quit()
  return true
}

export async function applyFallback(): Promise<void> {
  const st = useUpdate.getState()
  if (st.busy) return
  st.set({ busy: true, manual: true })
  if (!fallbackFile) showToast('Качаем обновление ' + (st.version || '') + '…')
  try {
    const file = await stageFallback()
    if (!file) throw new Error('нет файла обновления')
    const res = await updateFallbackRun(file)
    if (res.started) {
      await quit()
      return
    }
    st.set({ busy: false })
    showToast('Обновление скачано — замени приложение файлом из открытой папки')
  } catch (e) {
    st.set({ busy: false, failed: true })
    void reportError('updater-fallback', e)
    showToast('Обновиться не вышло: ' + e, 'error')
  }
}

export async function applyUpdate(): Promise<void> {
  const st = useUpdate.getState()
  if (st.busy) return
  if (st.failed) {
    openExt(DOWNLOAD_PAGE)
    return
  }
  if (!current || st.manual) {
    if (!fallback && !(await probeFallback())) {
      showToast('Обновление недоступно — скачай лаунчер с сайта', 'error')
      st.set({ failed: true })
      return
    }
    await applyFallback()
    return
  }
  st.set({ busy: true })
  try {
    if (!downloaded) showToast('Качаем обновление ' + (st.version || '') + '…')
    const upd = await ensureDownloaded()
    installing = true
    await upd.install()
    await relaunch()
  } catch (e) {
    installing = false
    st.set({ busy: false })
    markPluginFailed(current.version)
    void reportError('updater', e)
    showToast('Ставим запасным способом…')
    if (await probeFallback()) await applyFallback()
    else {
      st.set({ failed: true })
      showToast('Не удалось обновиться: ' + e, 'error')
    }
  }
}

export async function checkForUpdate(loud = false): Promise<UpdateInfo | null> {
  if (!updatesAllowed()) {
    if (loud) showToast(hasTauri() ? 'В дев-запуске обновления отключены' : 'Обновления доступны в приложении лаунчера', 'error')
    return null
  }
  if (await updatesManagedOutside()) {
    if (loud) showToast('Обновляется через Flatpak: flatpak update net.millida.launcher')
    return null
  }
  try {
    if (await pluginGaveUp()) {
      const f = await probeFallback()
      if (!f && loud) showToast('Установлена последняя версия')
      return pending
    }
    const upd = await check()
    if (!upd) {
      const f = await probeFallback()
      if (!f && loud) showToast('Установлена последняя версия')
      return f ? pending : null
    }
    if (!current || current.version !== upd.version) remember(upd)
    void ensureDownloaded().catch((err) => {
      downloading = null
      void reportError('updater', err)
      void probeFallback()
    })
    return pending
  } catch (e) {
    void reportError('updater', e)
    const f = await probeFallback()
    if (f) return pending
    if (loud) showToast('Не удалось проверить обновления: ' + e, 'error')
    return null
  }
}
