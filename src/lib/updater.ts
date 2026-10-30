// Launcher update. The check goes through the Tauri plugin. The version list address and the public part of the signing key are set in tauri.conf.json.
// Install only with a Millida signature. Fallback: the core downloads the update itself (updateFallback*). Details: SAFETY.md.
import { check, type Update } from '@tauri-apps/plugin-updater'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { hasTauri, tauri } from '../ipc/tauri'
import {
  appVersion,
  isFlatpak,
  showAfterUpdate,
  updateDeltaStage,
  updateFallbackCheck,
  updateFallbackRun,
  updateFallbackStage,
  updateStaged,
  type FallbackUpdate,
} from '../ipc/commands'
import { readPref } from './prefs'
import { showToast } from '../state/ui'
import { useUpdate } from '../state/update'
import { openExt } from './api'
import { reportError } from './crash'
import { cancelAppExit, track, trackAppExit, trackFailure } from './telemetry'
import { classifyError } from './errorKind'
import { CheckBackoff, FailureSeries, isCriticalRelease } from './updatePolicy'
import { t, tx } from '../i18n'

export interface UpdateInfo {
  version: string
  notes: string
  install: () => Promise<void>
}

export const DOWNLOAD_PAGE = 'https://millida.net/launcher'

const FAILED_KEY = 'm-upd-failed'
/// The version whose patch update did not install: the full installer is taken for it from then on, in every session.
const DELTA_BAD_KEY = 'm-upd-delta-bad'
const BOOT_KEY = 'm-upd-boot'
const BOOT_TRIES = 2
const PROBE_EVERY = 1800000

let pending: UpdateInfo | null = null
let current: Update | null = null
let downloading: Promise<void> | null = null
let downloaded = false
let installing = false
let fallback: FallbackUpdate | null = null
let fallbackFile: string | null = null
/// Для какой версии скачан fallbackFile: файл прошлого выпуска не ответ на более новый.
let fallbackFileVersion: string | null = null
let fallbackStaging: Promise<string | null> | null = null
let lastProbe = 0
/// Versions a patch update was already tried for in this session (found or not).
const deltaTried = new Set<string>()

/// Failed checks in a row push the next automatic check back (30 min, 1 h, 2 h ... up to 6 h).
const backoff = new CheckBackoff()
/// A failure is told once per series, until something works again.
const series = new FailureSeries()
let lastCheckMs = 0

export const pendingUpdate = () => pending

/** Только для тестов: состояние модуля между прогонами. */
export function __resetUpdaterForTests() {
  pending = null
  current = null
  downloading = null
  downloaded = false
  installing = false
  fallback = null
  fallbackFile = null
  fallbackFileVersion = null
  fallbackStaging = null
  lastProbe = 0
  managedOutside = null
  deltaTried.clear()
}
export const updateReady = () => (downloaded && !!current) || !!fallbackFile

/// The staged file is a new exe built from a patch (not an installer): the core swaps it in place.
const stagedByPatch = () => !!fallbackFile && /\.delta\.exe$/i.test(fallbackFile)

const deltaBad = (version: string): boolean => {
  try {
    return localStorage.getItem(DELTA_BAD_KEY) === version
  } catch {
    return false
  }
}

function markDeltaBad(version: string) {
  try {
    localStorage.setItem(DELTA_BAD_KEY, version)
  } catch (e) {
    console.warn('[updater] the failed patch was not remembered', e)
  }
}

/// The patch did not install: forget the staged exe, remember the version, and let the full installer take its place.
function dropDelta(e: unknown) {
  const version = fallback?.version || useUpdate.getState().version || ''
  if (version) markDeltaBad(version)
  fallbackFile = null
  fallbackStaging = null
  track('perf', { what: 'update_download', where: 'delta', step: 'install', kind: classifyError(String(e)) }, { durationMs: 0, ok: false })
}

/// Сбой обновления: отчёт в /errors и событие телеметрии; если выход уже
/// записан перед установкой — он не случился. Повторный сбой той же серии (сеть
/// не отвечает, проверка падает каждые полчаса) не шлётся: 66% всех сетевых
/// ошибок за неделю 19–26.10.2026 были именно этим.
function updateFailed(where: string, e: unknown) {
  cancelAppExit()
  backoff.failed()
  if (!series.first()) return
  track('perf', { what: 'update_check', where: 'page', step: where, kind: classifyError(String(e)) }, { durationMs: lastCheckMs, ok: false })
  void reportError(where, e)
  trackFailure('updater', e, { step: where })
}

/// A check that came back, with or without an update: the series of failures is over.
function checkWorked(via: 'plugin' | 'core', ms: number, found: boolean, critical: boolean) {
  backoff.worked()
  series.ended()
  track('perf', { what: 'update_check', where: via, found, ...(critical ? { critical: true } : {}) }, { durationMs: Math.round(ms), ok: true })
}

/// The plugin's check, timed. A failure is left for the caller to report with its own step name.
async function timedCheck(): Promise<Update | null> {
  const t0 = performance.now()
  try {
    const upd = await check()
    lastCheckMs = Math.round(performance.now() - t0)
    checkWorked('plugin', lastCheckMs, !!upd, !!upd && isCriticalRelease(upd.rawJson))
    return upd
  } catch (e) {
    lastCheckMs = Math.round(performance.now() - t0)
    throw e
  }
}

/// Download and install work stays out of the way of a launch and of installs: it starts when
/// nothing of the kind is running (the page registers what "running" means).
let busyProbe: () => boolean = () => false
export function setUpdateBusyProbe(fn: () => boolean) {
  busyProbe = fn
}

const QUIET_FIRST_MS = 15_000
const QUIET_POLL_MS = 10_000

function afterQuiet(run: () => void) {
  const attempt = () => {
    if (busyProbe()) setTimeout(attempt, QUIET_POLL_MS)
    else run()
  }
  setTimeout(attempt, QUIET_FIRST_MS)
}

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

const FLATPAK_UPDATE_COMMAND = 'flatpak update net.millida.launcher'

async function managedOutsideOnly(): Promise<boolean> {
  return updatesAllowed() && (await updatesManagedOutside())
}

/// Flatpak cannot install anything itself, but the player still has to learn
/// that a new version is out: otherwise the launcher silently stays behind.
async function noticeManagedUpdate(): Promise<FallbackUpdate | null> {
  try {
    const upd = await updateFallbackCheck()
    if (!upd) return null
    pending = { version: upd.version, notes: upd.notes || '', install: async () => applyUpdate() }
    useUpdate.getState().set({ version: upd.version, staged: false, manual: true, failed: true })
    return upd
  } catch (e) {
    updateFailed('updater-flatpak', e)
    return null
  }
}

function showManagedUpdateHint() {
  const version = useUpdate.getState().version
  showToast(
    (version ? t('Вышла версия {version}.', { version }) + ' ' : '') +
      t('Обнови лаунчер в магазине приложений или командой: {command}', { command: FLATPAK_UPDATE_COMMAND }),
  )
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

/// Patch update (Windows): the core builds the new exe from the installed one and a small patch and checks the
/// signature of the finished file. True = staged, no full download needed. Any failure is quiet: the usual road follows.
async function tryDelta(version: string): Promise<boolean> {
  if (deltaTried.has(version) || deltaBad(version) || !(await updatesReady())) return false
  deltaTried.add(version)
  const t0 = performance.now()
  try {
    const d = await updateDeltaStage()
    if (!d) return false
    fallback = { version: d.version, notes: current?.body || '', url: '', file: '', signature: '', source: '' } as FallbackUpdate
    fallbackFile = d.path
    useUpdate.getState().set({ version: d.version, staged: true, manual: true, failed: false })
    pending = { version: d.version, notes: current?.body || '', install: async () => applyFallback() }
    track(
      'perf',
      { what: 'update_download', where: 'delta', kb: Math.round(d.patchBytes / 1024), fullKb: Math.round(d.fullBytes / 1024) },
      { durationMs: Math.round(performance.now() - t0), ok: true },
    )
    return true
  } catch (e) {
    track('perf', { what: 'update_download', where: 'delta', step: 'stage', kind: classifyError(String(e)) }, { durationMs: Math.round(performance.now() - t0), ok: false })
    return false
  }
}

/// The background download of a found update: a patch when there is one, the plugin's full download otherwise.
async function stageOrDownload(version: string): Promise<void> {
  if (await tryDelta(version)) return
  // Без патча — обычный путь: ядро качает и держит файл на диске, плагин только запасной. Патч уже пробовали (или
  // отказались от него) в этом проходе: ядру велено сразу взять установщик, а не сверять манифест и хеш exe второй раз
  // и не качать тот же битый патч дважды (С3 второго ревью).
  await stageRegular(version, true)
}

function ensureDownloaded(): Promise<Update> {
  if (!current) return Promise.reject(new Error(t('нет обновления')))
  const upd = current
  if (downloaded) return Promise.resolve(upd)
  if (!downloading) {
    const t0 = performance.now()
    let bytes = 0
    downloading = upd
      .download((e) => {
        if (e.event === 'Progress') bytes += e.data.chunkLength || 0
      })
      .then(() => {
        downloaded = true
        useUpdate.getState().set({ staged: true })
        track('perf', { what: 'update_download', where: 'plugin', kb: Math.round(bytes / 1024) }, { durationMs: Math.round(performance.now() - t0), ok: true })
      })
  }
  return downloading.then(() => upd)
}

async function quit(): Promise<void> {
  trackAppExit()
  try {
    await exit(0)
  } catch {
    const T = tauri()
    const w = T && T.window ? T.window.getCurrentWindow() : null
    if (w && w.destroy) await w.destroy().catch(() => {})
  }
}

/// An installer that cannot replace the exe (antivirus, foreign install folder) leaves the old
/// version in place, and every start would install and relaunch again without end.
function bootTriesSpent(target: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null') as { target?: string; n?: number } | null
    return !!raw && raw.target === target && (raw.n || 0) >= BOOT_TRIES
  } catch {
    return false
  }
}

function noteBootTry(target: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null') as { target?: string; n?: number } | null
    const n = raw && raw.target === target ? (raw.n || 0) + 1 : 1
    localStorage.setItem(BOOT_KEY, JSON.stringify({ target, n }))
  } catch {}
}

function markPluginFailed(version: string) {
  try {
    localStorage.setItem(FAILED_KEY, version)
  } catch {}
}

/// The plugin reads one endpoint baked into the build, so a tester cannot be
/// pointed at the testing manifest through it. The core's own channel reads both
/// manifests and verifies each with the same key, so testers go that way.
export function betaChannel(): boolean {
  return readPref('m-beta', '') === '1'
}

async function pluginGaveUp(): Promise<boolean> {
  if (betaChannel()) return true
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
  const t0 = performance.now()
  try {
    const upd = await updateFallbackCheck()
    lastCheckMs = Math.round(performance.now() - t0)
    checkWorked('core', lastCheckMs, !!upd, !!upd?.critical)
    if (!upd) return null
    if (!fallback || fallback.version !== upd.version) {
      fallback = upd
      if (fallbackFileVersion !== upd.version) {
        fallbackFile = null
        fallbackFileVersion = null
        fallbackStaging = null
      }
    }
    pending = { version: upd.version, notes: upd.notes || '', install: async () => applyFallback() }
    useUpdate.getState().set({ version: upd.version, staged: !!fallbackFile, manual: true, failed: false })
    // Downloaded in the background once nothing else is going on; a critical release is staged by bootUpdate itself.
    if (!upd.critical) afterQuiet(() => void stageFallback().catch((e) => console.warn('[updater] background staging failed', e)))
    return upd
  } catch (e) {
    lastCheckMs = Math.round(performance.now() - t0)
    updateFailed('updater-fallback', e)
    return null
  }
}

function stageFallback(skipDelta = false): Promise<string | null> {
  if (fallbackFile) return Promise.resolve(fallbackFile)
  if (!fallbackStaging) {
    const t0 = performance.now()
    fallbackStaging = updateFallbackStage(skipDelta || deltaBad(fallback?.version || ''))
      .then((res) => {
        if (res) track('perf', { what: 'update_download', where: 'core' }, { durationMs: Math.round(performance.now() - t0), ok: true })
        fallbackFile = res ? res.path : null
        fallbackFileVersion = res ? res.version : null
        if (res) useUpdate.getState().set({ version: res.version, staged: true, manual: true })
        return fallbackFile
      })
      .catch((e) => {
        fallbackStaging = null
        updateFailed('updater-fallback', e)
        throw e
      })
  }
  return fallbackStaging
}

/// Скачанное ядром лежит на диске и переживает окно (трей, игра): новая страница берёт его, а не качает
/// ~55 МиБ заново, и «Выход» из трея ставит его. Тихо возвращает null, если скачанного нет.
export async function adoptStaged(): Promise<string | null> {
  if (fallbackFile) return fallbackFileVersion
  try {
    const staged = await updateStaged()
    if (!staged || fallbackFile) return fallbackFileVersion
    fallbackFile = staged.path
    fallbackFileVersion = staged.version
    fallbackStaging = Promise.resolve(staged.path)
    pending = { version: staged.version, notes: pending?.version === staged.version ? pending.notes : '', install: async () => applyFallback() }
    useUpdate.getState().set({ version: staged.version, staged: true, manual: true, failed: false })
    return staged.version
  } catch (e) {
    console.warn('[updater] the core did not report a staged update', e)
    return null
  }
}

/// Обычный выпуск качает ядро: на диск, с проверкой подписи, один раз на версию. Скачанное окном
/// (плагином) жило в памяти страницы и пропадало вместе с ней. Плагин остаётся запасным путём.
async function stageRegular(version: string, skipDelta = false): Promise<void> {
  if (fallbackFile && fallbackFileVersion === version) {
    useUpdate.getState().set({ staged: true, manual: true })
    return
  }
  if (fallbackFileVersion !== version) {
    fallbackFile = null
    fallbackFileVersion = null
    fallbackStaging = null
  }
  try {
    if (await stageFallback(skipDelta)) return
  } catch (e) {
    console.warn('[updater] the core could not stage the update; the plugin downloads it instead', e)
  }
  await ensureDownloaded()
}

const BOOT_CHECK_TIMEOUT = 5000

/// Gatekeeper runs a .app opened straight from the DMG out of a throwaway copy, so no update can
/// ever stick until the user moves it to Applications: retrying only burns the download again.
const TRANSLOCATED_RE = /запущен из образа/i

function noticeIfTranslocated(e: unknown): boolean {
  if (!TRANSLOCATED_RE.test(String(e))) return false
  showToast(t('Лаунчер запущен из образа. Перенеси Millida в «Программы» — иначе обновления не установятся'), 'error')
  return true
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))])
}

/// The plugin reports every chunk, so silence this long means a stalled connection. The fallback
/// channel reports nothing while it downloads and gets a flat limit instead.
const BOOT_STALL_MS = 45_000
const BOOT_FALLBACK_LIMIT_MS = 180_000

export type BootLeave = 'skipped' | 'stalled'

let leaveBoot: ((why: BootLeave) => void) | null = null

/// «Продолжить без обновления» on the boot screen: the screen covers the whole window, and a
/// download that never ends used to leave no way into the launcher at all.
export function skipBootUpdate() {
  leaveBoot?.('skipped')
}

/// A way out of a boot download: the player's button, or `quietMs` with no sign of life.
function bootEscape(quietMs: number): { left: Promise<BootLeave>; alive: () => void; done: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let leave: (why: BootLeave) => void = () => {}
  const left = new Promise<BootLeave>((res) => {
    leave = res
  })
  const alive = () => {
    clearTimeout(timer)
    timer = setTimeout(() => leave('stalled'), quietMs)
  }
  leaveBoot = leave
  alive()
  return {
    left,
    alive,
    done: () => {
      clearTimeout(timer)
      leaveBoot = null
    },
  }
}

/// Looked at on startup, but only a release the manifest calls critical holds the start (the old
/// way: download and install before the launcher opens, on Windows the installer ends the running
/// process). Every other release is found and downloaded in the background after the launcher is
/// up and nothing else is going on, and goes in when the launcher is closed (the banner says so)
/// or when the player presses it. Returns true when the install started.
export async function bootUpdate(): Promise<boolean> {
  if (await managedOutsideOnly()) {
    void noticeManagedUpdate()
    return false
  }
  if (!(await updatesReady())) return false
  const st = useUpdate.getState()
  st.set({ bootPhase: 'checking', bootPct: 0 })
  // What an earlier window (or the core in the tray) already downloaded is on disk: take it first.
  await adoptStaged()
  try {
    if (await pluginGaveUp()) {
      const f = await withTimeout(probeFallback(), BOOT_CHECK_TIMEOUT)
      if (!f || !f.critical) {
        // Not urgent: probeFallback has put it to download in the background.
        st.set({ bootPhase: 'idle' })
        return false
      }
      if (bootTriesSpent('fallback:' + f.version)) {
        st.set({ bootPhase: 'idle' })
        useUpdate.getState().set({ failed: true })
        return false
      }
      st.set({ bootPhase: 'downloading', version: f.version })
      const esc = bootEscape(BOOT_FALLBACK_LIMIT_MS)
      const staging = stageFallback()
      const staged = await Promise.race([staging, esc.left]).finally(esc.done)
      if (staged === 'skipped' || staged === 'stalled') {
        // Staging goes on in the background and the update installs on exit.
        staging.catch((e) => console.warn('[updater] staging after leaving the boot screen failed', e))
        if (staged === 'stalled') noteBootTry('fallback:' + f.version)
        st.set({ bootPhase: 'idle' })
        return false
      }
      const file = staged
      if (!file) throw new Error(t('нет файла обновления'))
      st.set({ bootPhase: 'installing' })
      noteBootTry('fallback:' + f.version)
      const res = await updateFallbackRun(file)
      if (!res.started) throw new Error(t('установщик не запустился'))
      await quit()
      return true
    }

    const upd = await withTimeout(timedCheck(), BOOT_CHECK_TIMEOUT)
    if (!upd) {
      st.set({ bootPhase: 'idle' })
      return false
    }
    remember(upd)
    if (!isCriticalRelease(upd.rawJson)) {
      st.set({ bootPhase: 'idle' })
      afterQuiet(() =>
        void stageOrDownload(upd.version).catch((e) => {
          downloading = null
          updateFailed('updater-boot', e)
        }),
      )
      return false
    }
    if (bootTriesSpent(upd.version)) {
      markPluginFailed(upd.version)
      st.set({ bootPhase: 'idle' })
      void autoUpdate()
      return false
    }
    st.set({ bootPhase: 'downloading', version: upd.version, bootPct: 0 })
    let total = 0
    let got = 0
    const esc = bootEscape(BOOT_STALL_MS)
    const fetching = upd
      .download((e) => {
        esc.alive()
        if (e.event === 'Started') total = e.data.contentLength || 0
        else if (e.event === 'Progress') {
          got += e.data.chunkLength || 0
          if (total) useUpdate.getState().set({ bootPct: Math.min(99, Math.round((got / total) * 100)) })
        }
      })
      .then(() => {
        downloaded = true
      })
    downloading = fetching
    const left = await Promise.race([fetching.then(() => null), esc.left]).finally(esc.done)
    if (left) {
      // The same download goes on in the background and installs on exit, like an update found mid-session.
      fetching
        .then(() => useUpdate.getState().set({ staged: true }))
        .catch((e) => {
          downloading = null
          updateFailed('updater-boot', e)
        })
      if (left === 'stalled') noteBootTry(upd.version)
      useUpdate.getState().set({ bootPhase: 'idle' })
      return false
    }
    installing = true
    useUpdate.getState().set({ bootPhase: 'installing', bootPct: 100 })
    trackAppExit()
    noteBootTry(upd.version)
    await upd.install()
    await relaunch()
    return true
  } catch (e) {
    installing = false
    downloading = null
    useUpdate.getState().set({ bootPhase: 'idle' })
    if (noticeIfTranslocated(e)) return false
    updateFailed('updater-boot', e)
    if (current) markPluginFailed(current.version)
    void autoUpdate()
    return false
  }
}

/// The periodic check: skipped while an update is ready and while the last checks failed (the
/// gap grows from half an hour to six, see CheckBackoff).
export function pollUpdate(): void {
  if (updateReady() || !backoff.allowed()) return
  void autoUpdate()
}

/// Otherwise installed on exit: a background install would kill the running process.
export async function autoUpdate(): Promise<{ version: string } | null> {
  if (await managedOutsideOnly()) {
    const f = await noticeManagedUpdate()
    return f ? { version: f.version } : null
  }
  if (!(await updatesReady())) return null
  if (await pluginGaveUp()) {
    const f = await probeFallback()
    return f ? { version: f.version } : null
  }
  try {
    const upd = await timedCheck()
    if (!upd) {
      if (Date.now() - lastProbe > PROBE_EVERY) {
        const f = await probeFallback()
        if (f) return { version: f.version }
      }
      return null
    }
    remember(upd)
    await stageOrDownload(upd.version)
    return { version: upd.version }
  } catch (e) {
    downloading = null
    updateFailed('updater', e)
    const f = await probeFallback()
    return f ? { version: f.version } : null
  }
}

export async function installUpdateOnExit(): Promise<boolean> {
  if (installing) return false
  // A window opened a moment ago has not met the core's staged file yet.
  if (!fallbackFile && !downloaded) await adoptStaged()
  if (fallbackFile) {
    installing = true
    useUpdate.getState().set({ busy: true })
    showToast(t('Ставим обновление {version}…', { version: fallback ? fallback.version : '' }))
    try {
      await updateFallbackRun(fallbackFile, false)
    } catch (e) {
      // A patch that did not install is remembered, so the next start takes the full installer; there is no time to fetch it now.
      if (stagedByPatch()) dropDelta(e)
      else updateFailed('updater-fallback', e)
    }
    await quit()
    return true
  }
  if (!downloaded || !current) return false
  installing = true
  useUpdate.getState().set({ busy: true })
  showToast(t('Ставим обновление {version}…', { version: useUpdate.getState().version || '' }))
  try {
    await current.install({ restartAfterInstall: false })
  } catch (e) {
    markPluginFailed(current.version)
    updateFailed('updater', e)
  }
  await quit()
  return true
}

export async function applyFallback(): Promise<void> {
  const st = useUpdate.getState()
  if (st.busy) return
  st.set({ busy: true, manual: true })
  if (!fallbackFile) showToast(t('Качаем обновление {version}…', { version: st.version || '' }))
  try {
    let file = await stageFallback()
    if (!file) throw new Error(t('нет файла обновления'))
    // The relaunched build opens its window even if this one was started at login (`--autostart`).
    await showAfterUpdate().catch((e) => void reportError('updater-show-after-update', e))
    let res
    try {
      res = await updateFallbackRun(file)
    } catch (e) {
      if (!stagedByPatch()) throw e
      // The patched exe would not go in: the full installer, once, instead of an error the player can do nothing about.
      dropDelta(e)
      showToast(t('Качаем обновление {version}…', { version: st.version || '' }))
      file = await stageFallback(true)
      if (!file) throw new Error(t('нет файла обновления'))
      res = await updateFallbackRun(file)
    }
    if (res.started) {
      await quit()
      return
    }
    st.set({ busy: false })
    showToast(
      /\.(deb|rpm)$/i.test(res.path)
        ? t('Обновление скачано — подтверди установку в открывшемся установщике пакетов')
        : t('Обновление скачано — замени приложение файлом из открытой папки'),
    )
  } catch (e) {
    st.set({ busy: false, failed: true })
    if (noticeIfTranslocated(e)) return
    updateFailed('updater-fallback', e)
    showToast(t('Обновиться не вышло: {error}', { error: tx(e) }), 'error')
  }
}

export async function applyUpdate(): Promise<void> {
  const st = useUpdate.getState()
  if (st.busy) return
  if (await managedOutsideOnly()) {
    showManagedUpdateHint()
    return
  }
  if (st.failed) {
    st.set({ failed: false })
    if (fallback || (await probeFallback())) {
      await applyFallback()
      if (!useUpdate.getState().failed) return
    }
    showToast(t('Автоматически обновиться не вышло — скачай установщик на открывшейся странице и запусти его поверх'), 'error')
    openExt(DOWNLOAD_PAGE)
    return
  }
  if (!current || st.manual) {
    if (!fallbackFile && !fallback && !(await probeFallback())) {
      showToast(t('Обновление недоступно — скачай лаунчер с сайта'), 'error')
      st.set({ failed: true })
      return
    }
    await applyFallback()
    return
  }
  st.set({ busy: true })
  try {
    if (!downloaded) showToast(t('Качаем обновление {version}…', { version: st.version || '' }))
    const upd = await ensureDownloaded()
    await showAfterUpdate().catch((e) => void reportError('updater-show-after-update', e))
    installing = true
    trackAppExit()
    await upd.install()
    await relaunch()
  } catch (e) {
    installing = false
    st.set({ busy: false })
    markPluginFailed(current.version)
    updateFailed('updater', e)
    showToast(t('Ставим запасным способом…'))
    if (await probeFallback()) await applyFallback()
    else {
      st.set({ failed: true })
      showToast(t('Не удалось обновиться: {error}', { error: tx(e) }), 'error')
    }
  }
}

export async function checkForUpdate(loud = false): Promise<UpdateInfo | null> {
  if (!updatesAllowed()) {
    if (loud) showToast(hasTauri() ? t('В дев-запуске обновления отключены') : t('Обновления доступны в приложении лаунчера'), 'error')
    return null
  }
  if (await updatesManagedOutside()) {
    const f = await noticeManagedUpdate()
    if (f && loud) showManagedUpdateHint()
    else if (loud) showToast(t('Установлена последняя версия'))
    return f ? pending : null
  }
  try {
    if (await pluginGaveUp()) {
      const f = await probeFallback()
      if (!f && loud) showToast(t('Установлена последняя версия'))
      return pending
    }
    const upd = await timedCheck()
    if (!upd) {
      const f = await probeFallback()
      if (!f && loud) showToast(t('Установлена последняя версия'))
      return f ? pending : null
    }
    if (!current || current.version !== upd.version) remember(upd)
    void stageOrDownload(upd.version).catch((err) => {
      downloading = null
      updateFailed('updater', err)
      void probeFallback()
    })
    return pending
  } catch (e) {
    updateFailed('updater', e)
    const f = await probeFallback()
    if (f) return pending
    if (loud) showToast(t('Не удалось проверить обновления: {error}', { error: tx(e) }), 'error')
    return null
  }
}
