import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Cover } from '../components/Cover'
import { WorldManager } from '../components/WorldManager'
import { ScreenshotGallery } from '../components/ScreenshotGallery'
import { SafetyModal } from '../components/SafetyModal'
import { SharePackModal } from '../components/SharePackModal'
import { TunePanel } from '../components/TunePanel'
import { IconGrid } from '../components/IconGrid'
import { IconEditor } from '../components/IconEditor'
import { recallIconRecipe, rememberIconRecipe } from '../lib/iconArt'
import { uiConfirm } from '../state/confirm'
import { copyText } from '../lib/clipboard'
import { hasTauri } from '../ipc/tauri'
import { listenDragDrop, listenDragState, listenGameLog, listenGameLogStart } from '../ipc/events'
import {
  addLocalFile,
  addServer,
  auditDeps,
  checkUpdates,
  clearProfileCover,
  countScreenshots,
  deleteContent,
  deleteProfile,
  detectJava,
  deviceSpecs,
  duplicateProfile,
  exportMrpack,
  getPlayStats,
  getProfileGroups,
  listContent,
  listLogs,
  listServers,
  loadProfileSettings,
  fpsBoostState,
  gpuSwitchSupported,
  setProfileGpu,
  setSkinMod,
  skinModState,
  modpackInfo,
  openProfileFolder,
  openUrl,
  pickContentFiles,
  pickJavaPath,
  pickProfileCover,
  pingServer,
  readLog,
  removeServer,
  renameProfile,
  saveProfileSettings,
  scanContent,
  setFpsBoost,
  scanContentLocal,
  setProfileGroup,
  setProfileIcon,
  setProfileJavaMajor,
  setProfileLoader,
  javaMajors,
  shareLog,
  testJava,
  toggleContent,
  updateAll,
  updateContent,
} from '../ipc/commands'
import type {
  AuditIssue,
  DepAudit,
  FpsBoostState,
  GpuPref,
  JavaInfo,
  ModFile,
  PingResult,
  ServerEntry,
  SkinModState,
} from '../ipc/commands'
import { Select } from '../components/Select'
import { Slider } from '../components/Slider'
import { isBlockIcon } from '../lib/blockColor'
import { RAM_MAX_GB, maxRamGb } from '../lib/ram'
import { BUILD_NAME_MAX, GROUP_NAME_MAX, LOADER_NAME, fmtPlaytime, fmtSize, loaderId, whenText } from '../lib/format'
import { AUTO_LOADER_VERSION, hasLoaderVersions, useLoaderBuilds } from '../lib/loaderBuilds'
import { incompatibleWith } from '../lib/compat'
import { fixItems, planItem } from '../lib/deps'
import { installExtras } from '../lib/install'
import { ensureMcVersionList, useMcVersionList, versionOptions } from '../state/mcVersionList'
import { useProfiles } from '../state/profiles'
import { useInstance } from '../state/instance'
import { closeModal, setScreen, showToast, useUi } from '../state/ui'
import { runRepair } from '../lib/repair'
import { joinWithAuth, realLaunch, showLaunchError, startPrelaunch } from '../lib/launch'
import { useMods } from '../state/mods'
import { useScreens } from '../state/screens'
import { useModpackVersions } from '../state/modpack'
import { useMigrate } from '../state/migrate'
import { openProject } from '../state/project'
import { stopRunningGame, useGame } from '../state/game'
import { apiErrorText } from '../lib/apiError'
import { mirrorAsset } from '../lib/api'

const ramKey = (p: string) => 'm-ram-' + p

const AUTO_FIX_ROUNDS = 2

const KIND_ICON: Record<string, string> = {
  mod: 'i-blocks',
  resourcepack: 'i-image',
  datapack: 'i-book',
  shader: 'i-eye',
}

const KINDS: [string, string][] = [
  ['mod', 'Моды'],
  ['resourcepack', 'Ресурспаки'],
  ['datapack', 'Дата-паки'],
  ['shader', 'Шейдеры'],
]

const AUDIT_LABEL: Record<string, string> = {
  missing: 'не хватает мода',
  conflict: 'конфликт',
  version: 'не для этой версии',
  loader: 'другой загрузчик',
}

const CONTENT_EXTS: Record<string, string[]> = {
  mod: ['jar', 'zip', 'litemod'],
  resourcepack: ['zip'],
  datapack: ['zip'],
  shader: ['zip'],
}

const extsOf = (kind: string) => CONTENT_EXTS[kind] || ['zip']
const baseName = (p: string) => p.split(/[\\/]/).pop() || p
const acceptsFile = (kind: string, p: string) => {
  const parts = baseName(p).split('.')
  return parts.length > 1 && extsOf(kind).includes(parts[parts.length - 1].toLowerCase())
}

const CORE_OPTS: [string, string][] = [
  ['vanilla', 'Ванилла'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
]

export function InstancePage() {
  const modal = useUi((s) => s.modals.bsModal)
  const profile = useInstance((s) => s.profile)
  const profiles = useProfiles((s) => s.profiles)
  const pr = profiles.find((x) => x.name === profile) || null
  const customCover = pr && pr.icon && !isBlockIcon(pr.icon) ? pr.icon : null

  const [iconEditor, setIconEditor] = useState(false)
  const [tab, setTab] = useState('content')
  const [kind, setKind] = useState('mod')
  const [items, setItems] = useState<ModFile[]>([])
  const [contentQuery, setContentQuery] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [upd, setUpd] = useState<Record<string, string>>({})
  const [itemLabels, setItemLabels] = useState<Record<string, string>>({})
  const [emptyList, setEmptyList] = useState(false)
  const [openInfo, setOpenInfo] = useState('')
  const [scanLabel, setScanLabel] = useState('Сканировать')
  const [audit, setAudit] = useState<DepAudit | null>(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [noticeList, setNoticeList] = useState('')
  const [playtime, setPlaytime] = useState('')
  const [ram, setRam] = useState(4)
  const [ramMax, setRamMax] = useState(RAM_MAX_GB)

  useEffect(() => {
    if (!hasTauri()) return
    void deviceSpecs()
      .then((specs) => setRamMax(maxRamGb(specs.ram_mb)))
      .catch(() => {})
  }, [])

  // The value may have been stored while the slider reached 16 GB on any
  // machine, leaving a build that promises itself memory the machine lacks.
  useEffect(() => {
    if (!profile || ram <= ramMax) return
    setRam(ramMax)
    localStorage.setItem(ramKey(profile), String(ramMax))
  }, [profile, ram, ramMax])
  const [boost, setBoost] = useState<FpsBoostState | null>(null)
  const [boostBusy, setBoostBusy] = useState(false)
  const [skinMod, setSkinModState] = useState<SkinModState | null>(null)
  const [skinModBusy, setSkinModBusy] = useState(false)
  const [jvm, setJvm] = useState('')
  const [w, setW] = useState('')
  const [h, setH] = useState('')
  const [java, setJava] = useState('')
  const [javaList, setJavaList] = useState<JavaInfo[]>([])
  const [javaMajor, setJavaMajor] = useState(0)
  const [gpu, setGpu] = useState<GpuPref>('auto')
  const [gpuOk, setGpuOk] = useState(true)
  const [javaAll, setJavaAll] = useState<number[]>([])
  const [javaBusy, setJavaBusy] = useState(0)
  const [detectLabel, setDetectLabel] = useState('Найти')
  const [shotCount, setShotCount] = useState('—')
  const [mpSlug, setMpSlug] = useState('')
  const [mpVersion, setMpVersion] = useState('')
  const [group, setGroup] = useState('')
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [pings, setPings] = useState<Record<string, PingResult | null>>({})
  const [repairBusy, setRepairBusy] = useState(false)
  const [wFilter, setWFilter] = useState('all')
  const [wsName, setWsName] = useState('')
  const [wsIp, setWsIp] = useState('')
  const [worldsNotice, setWorldsNotice] = useState('')
  const [logFiles, setLogFiles] = useState<string[]>([])
  const [logFile, setLogFile] = useState('')
  const [logBody, setLogBody] = useState('')
  const [logView, setLogView] = useState<'live' | 'files'>('live')
  const [liveLines, setLiveLines] = useState<string[]>([])
  const running = useGame((s) => s.list)
  const gameStopping = useGame((s) => s.stopping)
  const thisRunning = !!profile && running.includes(profile)
  const liveRef = useRef<HTMLPreElement>(null)
  const [shareLabel, setShareLabel] = useState('Поделиться (mclo.gs)')
  const [updateAllLabel, setUpdateAllLabel] = useState('Обновить всё')
  const [bulkUpdLabel, setBulkUpdLabel] = useState('Обновить')
  const [renameVal, setRenameVal] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [newLoader, setNewLoader] = useState('vanilla')
  const [newLoaderVer, setNewLoaderVer] = useState(AUTO_LOADER_VERSION)
  const [newVersion, setNewVersion] = useState('')
  const [coreBusy, setCoreBusy] = useState(false)
  const lb = useLoaderBuilds(newLoader, newVersion, modal.open)
  const mcList = useMcVersionList((s) => s.list)
  const showSnapshots = useMcVersionList((s) => s.show)
  // The build's own version stays selectable even when it is a snapshot and the
  // list is filtered down to releases: hiding it would silently change the build.
  const verOpts = useMemo(
    () => versionOptions(mcList, showSnapshots, newVersion),
    [mcList, showSnapshots, newVersion],
  )
  const [note, setNote] = useState('')
  const logBodyRef = useRef<HTMLPreElement>(null)
  const kindRef = useRef(kind)
  kindRef.current = kind
  const tabRef = useRef(tab)
  tabRef.current = tab
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [dropBusy, setDropBusy] = useState(false)

  const loadMods = useCallback(
    (k?: string) => {
      const kk = k || kindRef.current
      setSel(new Set())
      setUpd({})
      setItemLabels({})
      if (!profile) return
      if (!hasTauri()) {
        setItems([])
        setNoticeList('Список появится в приложении')
        setEmptyList(false)
        return
      }
      setNoticeList('')
      setOpenInfo('')
      listContent(profile, kk)
        .then((list) => {
          setItems(list)
          setEmptyList(!list.length)
          if (list.some((i) => !i.scanned)) {
            scanContentLocal(profile, kk)
              .then((full) => {
                if (kindRef.current === kk) setItems(full)
              })
              .catch(() => {})
          }
          checkUpdates(profile, kk)
            .then((ups) => {
              const m: Record<string, string> = {}
              ;(ups || []).forEach((u) => (m[u.file_name] = u.new_version_number))
              setUpd(m)
            })
            .catch(() => {})
        })
        .catch(() => {
          setItems([])
          setEmptyList(false)
          setNoticeList('—')
        })
    },
    [profile],
  )

  // A dependency the launcher knows how to close is not a question worth asking:
  // the build is broken until it is installed, and the answer is always yes.
  // Bounded rounds, because a freshly installed library may declare one of its
  // own — and because a catalog that keeps offering a file that never satisfies
  // the requirement must not loop forever.
  const autoRound = useRef(0)

  const runAudit = useCallback(
    (auto: boolean) => {
      if (!profile || !hasTauri()) return
      setAuditBusy(true)
      auditDeps(profile)
        .then((r) => {
          setAuditBusy(false)
          setAudit(r)
          if (!auto || autoRound.current >= AUTO_FIX_ROUNDS) return
          const items = fixItems(r)
          if (!items.length) return
          autoRound.current += 1
          installExtras(profile, 'mod', items, () => {
            loadMods('mod')
            runAuditRef.current(true)
          })
        })
        .catch((e) => {
          setAuditBusy(false)
          if (!auto) showToast('Не удалось проверить: ' + e, 'error')
        })
    },
    [profile, loadMods],
  )

  const runAuditRef = useRef(runAudit)
  runAuditRef.current = runAudit

  useEffect(() => {
    if (!modal.open || !profile || !hasTauri()) {
      autoRound.current = 0
      return
    }
    autoRound.current = 0
    runAuditRef.current(true)
  }, [modal.open, profile])

  const loadWorlds = useCallback(() => {
    if (!profile) return
    if (!hasTauri()) {
      setServers([])
      setWorldsNotice('Доступно в приложении')
      return
    }
    setWorldsNotice('')
    listServers(profile)
      .then(setServers)
      .catch(() => {})
  }, [profile])

  const loadLogs = useCallback(() => {
    if (!profile || !hasTauri()) return
    listLogs(profile)
      .then((files) => {
        setLogFiles(files)
        if (!files.length) {
          setLogFile('')
          setLogBody('Логи появятся после первого запуска игры')
          return
        }
        setLogFile(files[0])
      })
      .catch(() => {})
  }, [profile])

  useEffect(() => {
    if (!profile || !logFile || !hasTauri()) return
    readLog(profile, logFile).then((t) => setLogBody(t || '(пусто)'))
  }, [profile, logFile])

  useEffect(() => {
    const b = logBodyRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [logBody])

  // Rust streams the game stdout/stderr as "game-log"; "game-log-start" clears the buffer.
  useEffect(() => {
    let uns: Array<(() => void) | null> = []
    listenGameLogStart(() => setLiveLines([])).then((u) => uns.push(u))
    listenGameLog((lines) => setLiveLines((l) => [...l, ...lines].slice(-800))).then((u) => uns.push(u))
    return () => uns.forEach((u) => u && u())
  }, [])

  useEffect(() => {
    const b = liveRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [liveLines])

  useEffect(() => {
    if (!hasTauri() || !servers.length) return
    let alive = true
    servers.forEach((sv) => {
      if (!sv.ip) return
      pingServer(sv.ip)
        .then((r) => alive && setPings((p) => ({ ...p, [sv.ip]: r })))
        .catch(() => alive && setPings((p) => ({ ...p, [sv.ip]: null })))
    })
    return () => {
      alive = false
    }
  }, [servers])

  useEffect(() => {
    if (!modal.open || !profile) return
    const { tab: wantTab, focusRename, share: wantShare } = useInstance.getState()
    setTab(wantTab)
    if (wantTab === 'worlds') loadWorlds()
    if (wantTab === 'logs') loadLogs()
    // The rename input lives on the Settings tab, so focus is set after that
    // tab has been rendered.
    if (focusRename) {
      requestAnimationFrame(() => {
        const input = document.getElementById('bsRename') as HTMLInputElement | null
        input?.focus()
        input?.select()
      })
      useInstance.getState().set({ focusRename: false })
    }
    setShareOpen(wantShare)
    if (wantShare) useInstance.getState().set({ share: false })
    setKind('mod')
    setPlaytime('')
    setRam(parseInt(localStorage.getItem(ramKey(profile)) || '4'))
    setJavaList([])
    setDetectLabel('Найти')
    setShotCount('—')
    setMpSlug('')
    setMpVersion('')
    setWFilter('all')
    setWsName('')
    setWsIp('')
    setShareLabel('Поделиться (mclo.gs)')
    setUpdateAllLabel('Обновить всё')
    setBulkUpdLabel('Обновить')
    setRenameVal(profile)
    try {
      setNote(localStorage.getItem('m-note-' + profile) || '')
    } catch {
      setNote('')
    }
    if (hasTauri()) {
      ensureMcVersionList().catch((e) =>
        showToast('Список версий Minecraft не загрузился: ' + e + '. Проверь интернет и открой сборку заново', 'error'),
      )
      getPlayStats()
        .then((s) => {
          const b = s.builds.find((x) => x.key === profile)
          if (!b || !b.seconds) return
          setPlaytime(' · играно ' + fmtPlaytime(b.seconds) + (b.last ? ' · заходил ' + whenText(b.last) : ''))
        })
        .catch(() => {})
      gpuSwitchSupported()
        .then(setGpuOk)
        .catch(() => setGpuOk(false))
      fpsBoostState(profile)
        .then(setBoost)
        .catch(() => setBoost(null))
      skinModState(profile)
        .then(setSkinModState)
        .catch(() => setSkinModState(null))
      loadProfileSettings(profile)
        .then((cfg) => {
          setJvm(cfg.jvmArgs || '')
          setW(cfg.width ? String(cfg.width) : '')
          setH(cfg.height ? String(cfg.height) : '')
          setJava(cfg.javaPath || '')
          setJavaMajor(Number(cfg.javaMajor) || 0)
          setGpu(cfg.gpu || 'auto')
        })
        .catch(() => {})
      detectJava()
        .then((list) => setJavaList(list))
        .catch(() => {})
      javaMajors()
        .then(setJavaAll)
        .catch(() => {})
      countScreenshots(profile)
        .then((n) => setShotCount(n ? n + ' шт.' : 'пока нет'))
        .catch(() => {})
      modpackInfo(profile)
        .then((mp) => {
          if (mp && mp.slug) {
            setMpSlug(mp.slug)
            setMpVersion(mp.versionId || '')
          }
        })
        .catch(() => {})
      getProfileGroups()
        .then((g) => setGroup((g && g[profile]) || ''))
        .catch(() => {})
    }
    loadMods('mod')
  }, [modal.open, profile, loadMods])

  useEffect(() => {
    if (!pr) return
    setNewLoader(loaderId(pr))
    setNewLoaderVer(pr.loader_version || AUTO_LOADER_VERSION)
    setNewVersion(pr.version)
  }, [modal.open, profile, pr?.version, pr?.loader, pr?.fabric, pr?.loader_version])

  const toggleBoost = async () => {
    if (!profile) return
    if (!hasTauri()) {
      showToast('Буст FPS доступен в приложении', 'error')
      return
    }
    const on = !(boost && boost.enabled)
    setBoostBusy(true)
    try {
      const next = await setFpsBoost(profile, on)
      setBoost(next)
      loadMods()
      if (!on) {
        showToast('Буст FPS выключен — моды сняты, настройки графики вернули как было')
      } else if (next.vanilla) {
        showToast('Буст FPS включён: профиль JVM и лёгкая графика. Моды-ускорители работают только на Fabric/Forge.')
      } else {
        showToast(
          'Буст FPS включён: ' +
            next.mods.length +
            ' мод(ов), профиль JVM и лёгкая графика' +
            (next.skipped.length ? '. Без сборки под эту версию: ' + next.skipped.join(', ') : ''),
        )
      }
    } catch (e) {
      showToast('Не удалось переключить буст FPS: ' + e, 'error')
    } finally {
      setBoostBusy(false)
    }
  }

  const toggleSkinMod = async () => {
    if (!profile) return
    const on = !skinMod?.on
    setSkinModBusy(true)
    try {
      setSkinModState(await setSkinMod(profile, on))
      loadMods()
      showToast(
        on
          ? 'Мод скинов вернётся в сборку при следующем запуске'
          : 'Мод скинов убран — лаунчер больше не будет добавлять его в эту сборку',
      )
    } catch (e) {
      showToast('Не удалось переключить мод скинов: ' + e, 'error')
    } finally {
      setSkinModBusy(false)
    }
  }

  const doRename = () => {
    const nn = renameVal.trim()
    if (!profile || !nn || nn === profile) return
    if (!hasTauri()) {
      showToast('Переименование доступно в приложении', 'error')
      return
    }
    setRenameBusy(true)
    renameProfile(profile, nn)
      .then(() => {
        for (const pfx of ['m-last-', 'm-ram-']) {
          const v = localStorage.getItem(pfx + profile)
          if (v !== null) {
            localStorage.setItem(pfx + nn, v)
            localStorage.removeItem(pfx + profile)
          }
        }
        useInstance.getState().setProfile(nn)
        useProfiles.getState().setSelected(nn)
        void useProfiles.getState().refresh()
        showToast('Сборка переименована в «' + nn + '»')
      })
      .catch((e) => showToast('Не удалось переименовать: ' + e, 'error'))
      .finally(() => setRenameBusy(false))
  }

  const applyCore = async () => {
    if (!profile || !pr) return
    if (!hasTauri()) {
      showToast('Смена версии/ядра доступна в приложении', 'error')
      return
    }
    const ver = (newVersion || pr.version).trim()
    const lver = hasLoaderVersions(newLoader) ? newLoaderVer : AUTO_LOADER_VERSION
    if (ver === pr.version && newLoader === loaderId(pr) && lver === (pr.loader_version || AUTO_LOADER_VERSION)) {
      showToast('Версия и ядро не менялись')
      return
    }
    const label = (CORE_OPTS.find((c) => c[0] === newLoader)?.[1] || newLoader) + (lver ? ' ' + lver : '')
    if (
      !(await uiConfirm('Сменить сборку на ' + label + ' ' + ver + '? Установленные моды могут стать несовместимы — проверь их после смены.', {
        confirmLabel: 'Сменить',
      }))
    )
      return
    setCoreBusy(true)
    let modCount = 0
    try {
      if (hasTauri()) modCount = (await listContent(profile, 'mod')).length
    } catch {}
    setProfileLoader(profile, ver, newLoader, lver || null)
      .then(() => {
        void useProfiles.getState().refresh()
        if (modCount > 0 && newLoader !== loaderId(pr)) {
          showToast(
            'Ядро сменили на ' + label + '. Проверь моды (' + modCount + ' шт.) — часть может не подойти под новое ядро.',
          )
        } else {
          showToast('Готово: ' + label + ' · ' + ver + '. Ядро доустановим при запуске.')
        }
      })
      .catch((e) => showToast('Не удалось сменить: ' + e, 'error'))
      .finally(() => setCoreBusy(false))
  }

  const addFiles = useCallback(
    async (paths: string[]) => {
      const p = useInstance.getState().profile
      if (!p) return
      const k = kindRef.current
      const accepted = (paths || []).filter((x) => acceptsFile(k, x))
      const skipped = (paths || []).length - accepted.length
      if (!accepted.length) {
        showToast('Нужен файл ' + extsOf(k).map((e) => '.' + e).join(' / '), 'error')
        return
      }
      setDropBusy(true)
      showToast('Добавляем ' + accepted.length + ' файл(ов)…')
      const errors = await Promise.all(
        accepted.map((x) =>
          addLocalFile(p, k, x).then(
            () => '',
            (e) => baseName(x) + ': ' + e,
          ),
        ),
      ).finally(() => setDropBusy(false))
      loadMods()
      const failed = errors.filter(Boolean)
      if (failed.length === accepted.length) {
        showToast('Не удалось добавить: ' + failed[0], 'error')
        return
      }
      if (failed.length) {
        showToast('Добавлено ' + (accepted.length - failed.length) + ', с ошибкой ' + failed.length + ': ' + failed[0], 'error')
        return
      }
      showToast('Добавлено в сборку: ' + accepted.length + (skipped ? ' · пропущено не по формату: ' + skipped : ''))
    },
    [loadMods],
  )

  useEffect(() => {
    if (!modal.open) return
    let unlistenDrop: (() => void) | null = null
    let unlistenState: (() => void) | null = null
    listenDragDrop((paths) => {
      setDropActive(false)
      if (!useUi.getState().modals.bsModal.open || tabRef.current !== 'content') return
      void addFiles(paths || [])
    }).then((u) => {
      unlistenDrop = u
    })
    listenDragState((active) => {
      setDropActive(active && useUi.getState().modals.bsModal.open && tabRef.current === 'content')
    }).then((u) => {
      unlistenState = u
    })
    return () => {
      if (unlistenDrop) unlistenDrop()
      if (unlistenState) unlistenState()
      setDropActive(false)
    }
  }, [modal.open, addFiles])

  if (!modal.open) return null

  const saveOpts = () => {
    if (!hasTauri() || !profile) return
    saveProfileSettings(profile, jvm || '', +w || 0, +h || 0, java || '')
      .then(() => {
        if (java.trim()) setJavaMajor(0)
      })
      .catch((e) => showToast('' + e, 'error'))
  }

  const pinJavaMajor = (major: number) => {
    if (!hasTauri() || !profile) return
    if (!major) {
      setJavaMajor(0)
      setProfileJavaMajor(profile, null)
        .then(() => showToast('Java для сборки снова выбирается автоматически'))
        .catch((e) => showToast('' + e, 'error'))
      return
    }
    if (!javaAll.includes(major)) {
      showToast('Лаунчер ставит только Java ' + javaAll.join(', '), 'error')
      return
    }
    setJavaBusy(major)
    setProfileJavaMajor(profile, major)
      .then((v) => {
        setJavaMajor(major)
        setJava('')
        showToast('Сборка запускается на Java ' + major + ' · ' + v)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setJavaBusy(0))
  }

  // The path field doubles as a version field: a bare number is what people type
  // when the system Java cannot be reached at all, which is every Flatpak build.
  const saveJavaField = () => {
    const v = java.trim()
    if (/^\d{1,3}$/.test(v)) {
      pinJavaMajor(Number(v))
      return
    }
    saveOpts()
  }

  const close = () => closeModal('bsModal')

  const bulk = (names: string[], fn: (n: string) => Promise<unknown>, after?: () => void) =>
    Promise.all(names.map(fn))
      .then(() => {
        setSel(new Set())
        loadMods()
        if (after) after()
      })
      .catch((e) => showToast(apiErrorText(e, 'Не удалось выполнить действие'), 'error'))

  const filteredServers = wFilter !== 'single' ? servers : []
  const serversEmpty = !worldsNotice && !filteredServers.length

  const cq = contentQuery.trim().toLowerCase()
  const shownItems = cq ? items.filter((i) => (i.title || i.name).toLowerCase().includes(cq)) : items

  return (
    <div
      className={'modal-bg instance-page' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="bsModal"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === 'bsModal') close()
      }}
    >
      <div className="instance-shell">
        <div className="inst-head">
          <button className="inst-back" id="bsClose" data-sound="close" onClick={close}>
            <Icon id="i-chev-l" /> К сборкам
          </button>
          <div className="inst-hero">
            <div className="inst-icon" id="bsIconBig">
              <Cover url={pr ? pr.icon : null} />
            </div>
            <div className="inst-titles">
              <h1 id="bsTitle">{profile}</h1>
              <div className="inst-sub" id="bsSub">
                {(pr ? LOADER_NAME(pr) + ' · ' + pr.version : '—') + playtime}
              </div>
            </div>
            <div className="inst-actions">
              <button
                className="btn lg secondary"
                title="Получить код сборки, чтобы её поставил друг"
                onClick={() => {
                  if (!hasTauri()) {
                    showToast('Доступно в приложении')
                    return
                  }
                  setShareOpen(true)
                }}
              >
                <Icon id="i-link" /> Поделиться
              </button>
              <button
                className={'btn lg ' + (thisRunning ? 'running' : 'primary')}
                id="bsPlay"
                title={thisRunning ? 'Игра идёт — нажми, чтобы запустить ещё одну копию' : undefined}
                onClick={() => {
                  close()
                  if (hasTauri()) realLaunch(profile!)
                  else startPrelaunch(profile!)
                }}
              >
                {thisRunning ? (
                  <>
                    <span className="run-dot"></span> Запущено
                  </>
                ) : (
                  <>
                    <Icon id="i-play" /> Играть
                  </>
                )}
              </button>
              {thisRunning ? (
                <button
                  className="btn lg danger"
                  disabled={gameStopping}
                  title="Остановить игру"
                  onClick={() => stopRunningGame(profile!)}
                >
                  <Icon id="i-power" /> {gameStopping ? 'Останавливаем…' : 'Остановить'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="inst-body">
          <nav className="inst-tabs">
            {[
              ['content', 'i-blocks', 'Контент'],
              ['worlds', 'i-server', 'Миры и серверы'],
              ['shots', 'i-image', 'Скриншоты'],
              ['logs', 'i-list', 'Логи'],
              ['opts', 'i-settings', 'Параметры'],
            ].map(([id, ic, label]) => (
              <button
                key={id}
                className={'inst-tab' + (tab === id ? ' on' : '')}
                data-bstab={id}
                onClick={() => {
                  setTab(id)
                  if (id === 'worlds') loadWorlds()
                  if (id === 'logs') loadLogs()
                }}
              >
                <Icon id={ic} /> {label}
              </button>
            ))}
            <div className="inst-tab-sep"></div>
            <button
              className="inst-tab danger-tab"
              id="bsDelete"
              onClick={async () => {
                if (
                  !(await uiConfirm(
                    'Удалить сборку «' + profile + '» со всеми модами, мирами и часами игры? Отменить будет нельзя.',
                    { confirmLabel: 'Удалить' },
                  ))
                )
                  return
                if (hasTauri()) {
                  deleteProfile(profile!)
                    .then(() => {
                      close()
                      useProfiles.getState().setSelected(null)
                      void useProfiles.getState().refresh()
                      showToast('Сборка удалена', 'ok', 'delete')
                    })
                    .catch((e) => {
                      void useProfiles.getState().refresh()
                      showToast('' + e, 'error')
                    })
                } else {
                  close()
                  showToast('Удалено (демо)')
                }
              }}
            >
              <Icon id="i-trash" /> Удалить сборку
            </button>
          </nav>
          <div className="inst-content">
            <div id="bsTabContent" style={{ display: tab === 'content' ? '' : 'none' }}>
              <div className="segs" style={{ marginBottom: '12px' }}>
                {KINDS.map(([k, label]) => (
                  <button
                    key={k}
                    className={'seg' + (kind === k ? ' on' : '')}
                    data-bskind={k}
                    style={{ height: '32px', fontSize: '12.5px' }}
                    onClick={() => {
                      setKind(k)
                      setAudit(null)
                      loadMods(k)
                    }}
                  >
                    {label}
                  </button>
                ))}
                <span style={{ flex: 1 }}></span>
                {items.length > 4 ? (
                  <div className="input sm" style={{ width: '150px', height: '32px' }}>
                    <Icon id="i-search" />
                    <input placeholder="Поиск…" value={contentQuery} onChange={(e) => setContentQuery(e.target.value)} />
                  </div>
                ) : null}
              </div>
              <div id="bsBulkBar" className="bulk-float" style={{ display: sel.size ? 'flex' : 'none' }}>
                <span
                  className={
                    'chk' + (sel.size > 0 && sel.size === shownItems.length ? ' on' : sel.size ? ' part' : '')
                  }
                  id="bsSelAll"
                  title="Выбрать всё"
                  style={{ flex: 'none' }}
                  onClick={() => {
                    if (sel.size === shownItems.length) setSel(new Set())
                    else setSel(new Set(shownItems.map((i) => i.name)))
                  }}
                ></span>
                <span className="set-val" id="bsSelCount" style={{ color: 'var(--m-accent)' }}>
                  {sel.size + ' выбрано'}
                </span>
                <span style={{ flex: 1 }}></span>
                <button
                  className="btn sm secondary"
                  data-bulk="enable"
                  onClick={() => void bulk([...sel], (n) => toggleContent(profile!, kind, n, true))}
                >
                  Вкл
                </button>
                <button
                  className="btn sm secondary"
                  data-bulk="disable"
                  onClick={() => void bulk([...sel], (n) => toggleContent(profile!, kind, n, false))}
                >
                  Выкл
                </button>
                <button
                  className="btn sm secondary"
                  data-bulk="update"
                  onClick={() => {
                    setBulkUpdLabel('…')
                    void bulk(
                      [...sel],
                      (n) => updateContent(profile!, kind, n).catch(() => {}),
                      () => showToast('Обновлено'),
                    )
                  }}
                >
                  {bulkUpdLabel}
                </button>
                <button
                  className="btn sm danger"
                  data-bulk="delete"
                  onClick={async () => {
                    const names = [...sel]
                    if (await uiConfirm('Удалить выбранное (' + names.length + ')?', { confirmLabel: 'Удалить' }))
                      void bulk(names, (n) => deleteContent(profile!, kind, n))
                  }}
                >
                  Удалить
                </button>
              </div>
              <div className="act-row">
                <button
                  className="btn sm secondary act-row-btn"
                  id="bsDrop"
                  disabled={dropBusy}
                  title={'Выбрать ' + extsOf(kind).map((e) => '.' + e).join(' / ') + ' на диске'}
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast('Доступно в приложении', 'error')
                      return
                    }
                    pickContentFiles(kindRef.current)
                      .then((paths) => {
                        if (paths && paths.length) void addFiles(paths)
                      })
                      .catch((e) => showToast('Не удалось открыть выбор файлов: ' + e, 'error'))
                  }}
                >
                  <Icon id="i-upload" /> {dropBusy ? 'Добавляем…' : 'Файл'}
                </button>
                <button
                  className="btn sm secondary act-row-btn"
                  id="bsAddContent"
                  onClick={() => {
                    useProfiles.getState().setSelected(profile)
                    close()
                    setScreen('mods')
                    useMods.getState().scopeTo(profile)
                    useMods.getState().set({ modTab: 'mod' })
                    void useMods.getState().load()
                  }}
                >
                  <Icon id="i-plus" /> Добавить из каталога
                </button>
                <button
                  className="btn sm secondary act-row-btn"
                  id="bsUpdateAll"
                  onClick={() => {
                    if (!hasTauri()) return
                    setUpdateAllLabel('Обновляем…')
                    updateAll(profile!, kind)
                      .then((n) => {
                        setUpdateAllLabel('Обновить всё')
                        loadMods()
                        showToast(n ? 'Обновлено: ' + n : 'Всё актуально')
                      })
                      .catch((e) => {
                        setUpdateAllLabel('Обновить всё')
                        showToast('' + e)
                      })
                  }}
                >
                  <Icon id="i-restart" /> {updateAllLabel}
                </button>
                <button
                  className="btn sm secondary act-row-btn"
                  id="bsScan"
                  title="Прочитать метаданные файлов и опознать их на Modrinth и CurseForge"
                  disabled={scanLabel !== 'Сканировать' || !items.length}
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast('Доступно в приложении')
                      return
                    }
                    setScanLabel('Сканируем…')
                    scanContent(profile!, kind)
                      .then((r) => {
                        setScanLabel('Сканировать')
                        if (kindRef.current === kind) setItems(r.items)
                        showToast(
                          r.identified
                            ? 'Опознано ' +
                              r.identified +
                              ' из ' +
                              r.scanned +
                              ' (' +
                              [
                                r.modrinth ? 'Modrinth: ' + r.modrinth : '',
                                r.curseforge ? 'CurseForge: ' + r.curseforge : '',
                              ]
                                .filter(Boolean)
                                .join(', ') +
                              ')'
                            : 'Разобрано файлов: ' + r.scanned,
                        )
                      })
                      .catch((e) => {
                        setScanLabel('Сканировать')
                        showToast('Не удалось просканировать: ' + e, 'error')
                      })
                  }}
                >
                  <Icon id="i-search" /> {scanLabel}
                </button>
                <button
                  className="btn sm secondary act-row-btn"
                  disabled={kind !== 'mod' || !items.length}
                  title="Сверить моды с каталогами и заглянуть внутрь jar"
                  onClick={() => setSafetyOpen(true)}
                >
                  <Icon id="i-shield" /> Проверить моды
                </button>
                <button
                  className="btn sm secondary act-row-btn"
                  id="bsExport"
                  title="Экспорт сборки в файл .mrpack"
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast('Доступно в приложении')
                      return
                    }
                    showToast('Собираем .mrpack…')
                    exportMrpack(profile!, profile!, '1.0.0', pr ? LOADER_NAME(pr) + ' ' + pr.version : '')
                      .then((p) => showToast('Экспортировано: ' + ('' + p).split('/').pop()))
                      .catch((e) => showToast('' + e))
                  }}
                >
                  <Icon id="i-download" /> Экспорт
                </button>
              </div>
              {kind === 'mod' ? (
                <div
                  style={{
                    margin: '0 0 14px',
                    borderTop: '1px solid var(--m-border)',
                    borderBottom: '1px solid var(--m-border)',
                    padding: '12px 0 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="set-val">Зависимости и совместимость</span>
                    <span style={{ flex: 1 }}></span>
                    {fixItems(audit).length ? (
                      <button
                        className="btn sm secondary"
                        onClick={() =>
                          installExtras(profile!, 'mod', fixItems(audit), () => {
                            loadMods('mod')
                            runAuditRef.current(false)
                          })
                        }
                      >
                        Доустановить ({fixItems(audit).length})
                      </button>
                    ) : null}
                    <button
                      className="btn sm secondary"
                      disabled={auditBusy}
                      title="Проверить, всё ли нужное стоит и не конфликтуют ли моды между собой"
                      onClick={() => {
                        if (!hasTauri()) {
                          showToast('Доступно в приложении')
                          return
                        }
                        runAudit(false)
                      }}
                    >
                      <Icon id="i-check" /> {auditBusy ? 'Проверяем…' : 'Проверить'}
                    </button>
                  </div>
                  {!audit ? (
                    <p className="faint-note">
                      Найдём моды, которым не хватает библиотек, конфликтующие пары и файлы не под эту версию игры.
                    </p>
                  ) : !audit.issues.length ? (
                    <p className="faint-note">
                      Проверено файлов: {audit.checked} — недостающих зависимостей и конфликтов не нашли.
                    </p>
                  ) : (
                    <div style={{ marginTop: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                      {audit.issues.map((it: AuditIssue, i) => (
                        <div className="mod-card" key={it.kind + it.title + it.detail + i} style={{ marginBottom: '6px' }}>
                          <div className="mod-card-row">
                            <span className="mod-art">
                              <Icon id={it.kind === 'missing' ? 'i-download' : 'i-alert'} />
                            </span>
                            <span className="mod-card-body">
                              <span className="mod-card-title">
                                {it.title}
                                <span
                                  className="mod-upd"
                                  style={
                                    it.kind === 'missing'
                                      ? undefined
                                      : { background: 'var(--m-danger-soft)', color: 'var(--m-danger)' }
                                  }
                                >
                                  {AUDIT_LABEL[it.kind]}
                                </span>
                              </span>
                              <span className="mod-card-sub">{it.detail}</span>
                            </span>
                            {it.fix ? (
                              <button
                                className="btn sm secondary"
                                style={{ height: '26px' }}
                                onClick={() =>
                                  installExtras(profile!, 'mod', [planItem(it.fix!)], () => {
                                    loadMods('mod')
                                    runAuditRef.current(false)
                                  })
                                }
                              >
                                Поставить
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <div className="mod-list-head">
                <span className="set-val" id="bsModCount">
                  {noticeList ? '' : shownItems.length ? shownItems.length + ' шт.' : ''}
                </span>
              </div>
              <div className="mod-list-wrap">
                {dropActive ? (
                  <div className="mod-drop">
                    <Icon id="i-upload" />
                    <b>Отпусти — добавим в сборку</b>
                    <span>{extsOf(kind).map((e) => '.' + e).join(' / ')}</span>
                  </div>
                ) : null}
              <div id="bsMods" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                {noticeList ? (
                  <p className="faint-note">{noticeList}</p>
                ) : emptyList ? (
                  <p className="faint-note">Пусто. Добавь из каталога или перетащи .jar сюда.</p>
                ) : !shownItems.length ? (
                  <p className="faint-note">Ничего не найдено по «{contentQuery.trim()}».</p>
                ) : (
                  shownItems.map((md) => {
                    const up = upd[md.name]
                    const title = md.title || md.name.replace(/\.(jar|zip)$/, '')
                    const info = openInfo === md.name
                    const modrinth = md.project_id && !md.project_id.startsWith('cf:') ? md.project_id : ''
                    const curse = md.project_id && md.project_id.startsWith('cf:') ? md.project_id.slice(3) : ''
                    const facts = [
                      md.version_number ? 'версия ' + md.version_number : '',
                      md.mc ? 'MC ' + md.mc : '',
                      md.author ? 'автор: ' + md.author : '',
                      fmtSize(md.size),
                    ].filter(Boolean)
                    return (
                      <div className={'mod-card' + (md.enabled ? '' : ' off') + (info ? ' open' : '')} key={md.name}>
                        <div className="mod-card-row">
                          <span
                            className={'chk mod-sel' + (sel.has(md.name) ? ' on' : '')}
                            data-sel={md.name}
                            title={sel.has(md.name) ? 'Убрать из выбора' : 'Выбрать'}
                            onClick={() => {
                              const next = new Set(sel)
                              if (next.has(md.name)) next.delete(md.name)
                              else next.add(md.name)
                              setSel(next)
                            }}
                          ></span>
                          <span className="mod-art">
                            {md.icon_url ? <img src={mirrorAsset(md.icon_url)} alt="" loading="lazy" /> : <Icon id={KIND_ICON[kind]} />}
                          </span>
                          <span className="mod-card-body" title={md.name}>
                            <span className="mod-card-title">
                              {title}
                              {md.version_number ? <span className="mod-ver">{md.version_number}</span> : null}
                              {up ? (
                                <span className="mod-upd" title={'Новая версия: ' + up}>
                                  обновление
                                </span>
                              ) : null}
                              {md.loaders?.length || md.loader ? (
                                <span className="mod-tag">
                                  {md.loaders?.length ? md.loaders.join(' · ') : md.loader}
                                </span>
                              ) : null}
                              {incompatibleWith(md.mc, pr ? pr.version : '') ? (
                                <span
                                  className="mod-upd"
                                  style={{ background: 'var(--m-danger-soft)', color: 'var(--m-danger)' }}
                                  title={'Файл собран под MC ' + md.mc + ', а сборка на ' + (pr ? pr.version : '—') + ' — вероятная причина вылета'}
                                >
                                  не для {pr ? pr.version : 'этой версии'}
                                </span>
                              ) : null}
                            </span>
                            <span className="mod-card-sub">{md.description || md.name}</span>
                          </span>
                          {up ? (
                            <button
                              className="btn sm secondary"
                              data-upd={md.name}
                              style={{ height: '26px' }}
                              onClick={() => {
                                setItemLabels((l) => ({ ...l, [md.name]: '…' }))
                                updateContent(profile!, kind, md.name)
                                  .then(() => {
                                    loadMods()
                                    showToast('Обновлено')
                                  })
                                  .catch((er) => {
                                    loadMods()
                                    showToast('' + er)
                                  })
                              }}
                            >
                              {itemLabels[md.name] || 'Обновить'}
                            </button>
                          ) : null}
                          <button
                            className={'icon-btn mod-info' + (info ? ' on' : '')}
                            title="Подробнее"
                            onClick={() => setOpenInfo(info ? '' : md.name)}
                          >
                            <Icon id="i-info" />
                          </button>
                          <span
                            className={'tgl' + (md.enabled ? ' on' : '')}
                            data-tg={md.name}
                            title={md.enabled ? 'Выключить в игре' : 'Включить в игре'}
                            onClick={() => {
                              // Отказ ядра обязан доехать до игрока: пока `.then`
                              // стоял без пары, переключение мода при запущенной
                              // игре молча роняло промис, тумблер оставался как
                              // был, а причину видели только мы в журнале ошибок.
                              toggleContent(profile!, kind, md.name, !md.enabled)
                                .then(() => loadMods())
                                .catch((e) => showToast(apiErrorText(e, 'Не удалось выполнить действие'), 'error'))
                            }}
                          ></span>
                          <button
                            className="icon-btn del"
                            data-del={md.name}
                            title="Удалить файл"
                            onClick={async () => {
                              if (await uiConfirm('Удалить ' + md.name + '?', { confirmLabel: 'Удалить' }))
                                deleteContent(profile!, kind, md.name)
                                  .then(() => loadMods())
                                  .catch((e) => showToast(apiErrorText(e, 'Не удалось выполнить действие'), 'error'))
                            }}
                          >
                            <Icon id="i-trash" />
                          </button>
                        </div>
                        {info ? (
                          <div className="mod-card-info">
                            <p className="mod-card-desc">{md.description || 'Автор не оставил описания в файле.'}</p>
                            {facts.length ? (
                              <div className="mod-card-facts">
                                {facts.map((f) => (
                                  <span className="pill" key={f}>
                                    {f}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <div className="mod-card-file">{md.name}</div>
                            <div className="mod-card-acts">
                              {modrinth ? (
                                <button className="btn sm secondary" onClick={() => openProject(modrinth, kind)}>
                                  Карточка на Modrinth
                                </button>
                              ) : null}
                              {curse ? (
                                <button
                                  className="btn sm secondary"
                                  onClick={() => openUrl('https://www.curseforge.com/projects/' + curse)}
                                >
                                  Открыть на CurseForge
                                </button>
                              ) : null}
                              {!md.project_id ? (
                                <span className="faint-note" style={{ margin: 0 }}>
                                  Файла нет в каталогах — нажми «Сканировать», поищем его на Modrinth.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
              </div>
            </div>

            <div id="bsTabWorlds" style={{ display: tab === 'worlds' ? '' : 'none' }}>
              <div className="segs" style={{ marginBottom: '12px' }}>
                {[
                  ['all', 'Все'],
                  ['single', 'Одиночные'],
                  ['server', 'Серверы'],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    className={'seg' + (wFilter === k ? ' on' : '')}
                    data-wfilter={k}
                    style={{ height: '32px', fontSize: '12.5px' }}
                    onClick={() => {
                      setWFilter(k)
                      loadWorlds()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {wFilter !== 'server' ? (
                <WorldManager
                  profile={profile!}
                  onPlay={(folder, name) => {
                    close()
                    showToast('Заходим в мир «' + name + '»…')
                    joinWithAuth(profile!, folder, null).catch((e) => showLaunchError(e))
                  }}
                />
              ) : null}
              <div id="bsWorlds" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {worldsNotice ? (
                  <p className="faint-note">{worldsNotice}</p>
                ) : serversEmpty ? (
                  <p className="faint-note">Серверов пока нет — добавь адрес ниже.</p>
                ) : (
                  <>
                    {filteredServers.map((s2) => {
                      const pg = pings[s2.ip]
                      const online = pg && pg.online >= 0 && (pg.max > 0 || pg.online > 0 || pg.version)
                      return (
                      <div className="mod-line srv-line" key={'s' + s2.ip}>
                        <span className="mod-mini">
                          <Icon id="i-server" />
                        </span>
                        <span className="srv-line-body">
                          <b>
                            {s2.name}
                            {pg === undefined ? (
                              <span className="srv-ping-dot loading"></span>
                            ) : online ? (
                              <span className="srv-ping-dot on"></span>
                            ) : (
                              <span className="srv-ping-dot off"></span>
                            )}
                          </b>
                          <span className="srv-line-meta">
                            {online ? (
                              <>
                                {pg!.online}/{pg!.max} онлайн{pg!.version ? ' · ' + pg!.version : ''}
                                {pg!.motd ? ' · ' + pg!.motd.slice(0, 40) : ''}
                              </>
                            ) : pg === undefined ? (
                              'проверяем…'
                            ) : (
                              s2.ip + ' · офлайн'
                            )}
                          </span>
                        </span>
                        <button
                          className="btn sm secondary w-join"
                          data-ip={s2.ip}
                          style={{ marginLeft: '8px' }}
                          onClick={() => {
                            close()
                            showToast('Подключаемся к ' + s2.ip + '…')
                            joinWithAuth(profile!, null, s2.ip, s2.name).catch((e) => showLaunchError(e))
                          }}
                        >
                          Зайти
                        </button>
                        <button
                          className="icon-btn del w-del"
                          data-ip={s2.ip}
                          onClick={() => removeServer(profile!, s2.ip).then(() => loadWorlds())}
                        >
                          <Icon id="i-trash" />
                        </button>
                      </div>
                      )
                    })}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <div className="input sm" style={{ flex: 1 }}>
                  <input
                    id="wsName"
                    placeholder="Название сервера"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                  />
                </div>
                <div className="input sm" style={{ flex: 1 }}>
                  <input id="wsIp" placeholder="mc.example.net" value={wsIp} onChange={(e) => setWsIp(e.target.value)} />
                </div>
                <button
                  className="btn sm secondary"
                  id="wsAdd"
                  onClick={() => {
                    const n = wsName.trim() || wsIp.trim()
                    const ip = wsIp.trim()
                    if (!ip) return
                    addServer(profile!, n, ip).then(() => {
                      setWsName('')
                      setWsIp('')
                      loadWorlds()
                      showToast('Сервер добавлен')
                    })
                  }}
                >
                  Добавить
                </button>
              </div>
              <button
                className="btn sm secondary"
                id="bsAddWorld"
                style={{ width: '100%', marginTop: '8px' }}
                onClick={() => {
                  useProfiles.getState().setSelected(profile)
                  close()
                  setScreen('mods')
                  useMods.getState().scopeTo(profile)
                  useMods.getState().set({ modTab: 'world', fCats: [], fCat: 'все', fWorldCat: 0 })
                  void useMods.getState().load()
                }}
              >
                <Icon id="i-map" /> Скачать карту из каталога
              </button>
            </div>

            {tab === 'shots' ? (
              <div id="bsTabShots">
                <ScreenshotGallery profile={profile!} />
              </div>
            ) : null}

            <div id="bsTabLogs" style={{ display: tab === 'logs' ? '' : 'none' }}>
              <div className="segs" style={{ marginBottom: '10px', width: 'auto' }}>
                <button
                  className={'seg' + (logView === 'live' ? ' on' : '')}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => setLogView('live')}
                >
                  <Icon id="i-list" /> Прямой эфир
                  {liveLines.length ? <span className="log-live-dot"></span> : null}
                </button>
                <button
                  className={'seg' + (logView === 'files' ? ' on' : '')}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => setLogView('files')}
                >
                  <Icon id="i-book" /> Файлы
                </button>
              </div>

              {logView === 'live' ? (
                <>
                  <pre ref={liveRef} className="host-console" style={{ height: '300px', margin: 0 }}>
                    {liveLines.length ? (
                      liveLines.map((l, i) => <div key={i}>{l}</div>)
                    ) : (
                      <div className="faint-note">Запусти игру — здесь будет живой вывод консоли в реальном времени.</div>
                    )}
                  </pre>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    {thisRunning ? (
                      <button
                        className="btn sm danger"
                        style={{ flex: 1 }}
                        disabled={gameStopping}
                        onClick={() => stopRunningGame(profile!)}
                      >
                        <Icon id="i-power" /> {gameStopping ? 'Останавливаем…' : 'Остановить игру'}
                      </button>
                    ) : null}
                    <button className="btn sm secondary" style={{ flex: 1 }} onClick={() => setLiveLines([])}>
                      <Icon id="i-trash" /> Очистить
                    </button>
                    <button
                      className="btn sm secondary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        void copyText(liveLines.join('\n')).then((ok) =>
                          showToast(ok ? 'Консоль скопирована' : 'Не удалось скопировать консоль'),
                        )
                      }}
                    >
                      <Icon id="i-copy" /> Скопировать
                    </button>
                  </div>
                </>
              ) : null}

              <div style={{ display: logView === 'files' ? '' : 'none' }}>
                {logFiles.length ? (
                  <div className="log-files">
                    {logFiles.map((f) => (
                      <button
                        key={f}
                        className={'log-file-chip' + (f === logFile ? ' on' : '')}
                        onClick={() => setLogFile(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                ) : null}
                <pre
                  id="bsLogBody"
                  ref={logBodyRef}
                  style={{
                    maxHeight: '280px',
                    overflow: 'auto',
                    background: 'var(--m-inset)',
                    borderRadius: '12px',
                    padding: '12px',
                    fontFamily: 'var(--m-mono)',
                    fontSize: '11.5px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    color: 'var(--m-fg-muted)',
                  }}
                >
                  {logBody}
                </pre>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  className="btn sm secondary"
                  id="bsLogCopy"
                  style={{ flex: 1 }}
                  onClick={() => {
                    void copyText(logBody)
                    showToast('Лог скопирован')
                  }}
                >
                  Скопировать
                </button>
                <button
                  className="btn sm secondary"
                  id="bsLogShare"
                  style={{ flex: 1 }}
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast('Доступно в приложении')
                      return
                    }
                    const name = logFiles.length ? logFile : 'нет логов'
                    if (!name || name === 'нет логов') {
                      showToast('Нет лога для отправки')
                      return
                    }
                    setShareLabel('Загружаем…')
                    shareLog(profile!, name)
                      .then((url) => {
                        setShareLabel('Поделиться (mclo.gs)')
                        void copyText(url)
                        showToast('Ссылка на лог скопирована: ' + url)
                        openUrl(url)
                      })
                      .catch((e) => {
                        setShareLabel('Поделиться (mclo.gs)')
                        showToast('' + e)
                      })
                  }}
                >
                  {shareLabel}
                </button>
              </div>
              </div>
            </div>

            <div id="bsTabOpts" style={{ display: tab === 'opts' ? '' : 'none' }}>
              <div className="set-row">
                <span className="lab">
                  Название сборки<small>Переименуем и перенесём все файлы</small>
                </span>
                <div className="input sm" style={{ width: '220px' }}>
                  <input
                    id="bsRename"
                    maxLength={BUILD_NAME_MAX}
                    value={renameVal}
                    placeholder="Название сборки"
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doRename()
                    }}
                  />
                </div>
                <button
                  className="btn sm secondary"
                  disabled={renameBusy || !renameVal.trim() || renameVal.trim() === profile}
                  onClick={doRename}
                >
                  {renameBusy ? 'Переименовываем…' : 'Переименовать'}
                </button>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lab">
                  Версия и ядро<small>Загрузчик и версия Minecraft — доустановим при запуске</small>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '300px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Select
                      width={148}
                      value={newLoader}
                      options={CORE_OPTS.map(([v, label]) => ({ value: v, label }))}
                      onChange={(v) => {
                        setNewLoader(v)
                        setNewLoaderVer(AUTO_LOADER_VERSION)
                      }}
                    />
                    <Select
                      width={144}
                      value={newVersion}
                      options={verOpts}
                      onChange={(v) => {
                        setNewVersion(v)
                        setNewLoaderVer(AUTO_LOADER_VERSION)
                      }}
                    />
                  </div>
                  {hasLoaderVersions(newLoader) ? (
                    <Select
                      width={300}
                      value={newLoaderVer}
                      options={lb.withPinned(newLoaderVer)}
                      disabled={lb.loading}
                      placeholder={lb.loading ? 'Загружаем версии загрузчика…' : 'Рекомендуемая'}
                      onChange={setNewLoaderVer}
                    />
                  ) : null}
                  <button
                    className="btn sm primary"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={
                      coreBusy ||
                      (newVersion === (pr ? pr.version : '') &&
                        newLoader === (pr ? loaderId(pr) : '') &&
                        newLoaderVer === (pr ? pr.loader_version || AUTO_LOADER_VERSION : ''))
                    }
                    onClick={() => void applyCore()}
                  >
                    {coreBusy ? 'Меняем…' : 'Применить версию и ядро'}
                  </button>
                </div>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lab">
                  Заметка<small>Личная пометка к сборке — видишь только ты</small>
                </span>
                <div className="input sm" style={{ width: '300px' }}>
                  <input
                    id="bsNote"
                    placeholder="Например: сборка для игры с друзьями"
                    value={note}
                    maxLength={200}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => {
                      try {
                        if (profile) {
                          if (note.trim()) localStorage.setItem('m-note-' + profile, note.trim())
                          else localStorage.removeItem('m-note-' + profile)
                        }
                      } catch {}
                    }}
                  />
                </div>
              </div>
              <div className="set-row">
                <span className="lab">
                  Оперативная память
                  <small>
                    {ramMax < RAM_MAX_GB
                      ? `Для этой сборки · больше ${ramMax} ГБ машина не даст: остальное нужно системе`
                      : 'Для этой сборки'}
                  </small>
                </span>
                <span className="set-val" id="bsRamVal">
                  {ram + ' ГБ'}
                </span>
                <Slider
                  width={200}
                  min={1}
                  max={ramMax}
                  value={ram}
                  onChange={(v) => {
                    setRam(v)
                    if (profile) localStorage.setItem(ramKey(profile), String(v))
                  }}
                />
              </div>
              <TunePanel profile={profile!} manualGb={ram} />
              <div className="set-row">
                <span className="lab">
                  Видеокарта
                  <small>
                    {!gpuOk
                      ? 'В этой системе карту выбирает сама ОС — настройка недоступна'
                      : gpu === 'discrete'
                        ? 'Игра пойдёт на дискретной карте — так и нужно на ноутбуках со встройкой'
                        : gpu === 'integrated'
                          ? 'Встроенная карта: меньше нагрев и расход батареи, меньше FPS'
                          : 'Как решит система — обычно это встроенная карта на ноутбуке'}
                  </small>
                </span>
                <Select
                  width={230}
                  value={gpu}
                  disabled={!gpuOk}
                  options={[
                    { value: 'auto', label: 'Авто', sub: 'Как решит система' },
                    { value: 'discrete', label: 'Дискретная', sub: 'NVIDIA или AMD — больше FPS' },
                    { value: 'integrated', label: 'Встроенная', sub: 'Тише и дольше от батареи' },
                  ]}
                  onChange={(v) => {
                    if (!profile) return
                    const prev = gpu
                    setGpu(v as GpuPref)
                    setProfileGpu(profile, v as GpuPref)
                      .then((saved) => {
                        setGpu(saved)
                        showToast(
                          saved === 'discrete'
                            ? 'Запускаем на дискретной карте'
                            : saved === 'integrated'
                              ? 'Запускаем на встроенной карте'
                              : 'Карту выбирает система',
                        )
                      })
                      .catch((e) => {
                        setGpu(prev)
                        showToast('Не удалось сохранить выбор карты: ' + e, 'error')
                      })
                  }}
                />
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lab">
                  Буст FPS
                  <small>
                    {boost && boost.enabled
                      ? 'Включён: моды-ускорители, профиль JVM и лёгкая графика' +
                        (boost.skipped.length ? '. Нет под эту версию: ' + boost.skipped.join(', ') : '')
                      : boost && boost.vanilla
                        ? 'Ускорит JVM и настройки графики; моды доступны на Fabric/Forge'
                        : 'Ставит Sodium/Embeddium и компанию, чинит GC и убирает тяжёлую графику'}
                  </small>
                </span>
                <div className="segs">
                  {[
                    ['on', 'Включить'],
                    ['off', 'Выключить'],
                  ].map(([v, label]) => {
                    const active = (v === 'on') === !!(boost && boost.enabled)
                    return (
                      <button
                        key={v}
                        className={'seg' + (active ? ' on' : '')}
                        data-fpsboost={v}
                        style={{ height: '32px', fontSize: '12.5px' }}
                        disabled={boostBusy || active}
                        onClick={() => void toggleBoost()}
                      >
                        {boostBusy ? 'Меняем…' : label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {pr && loaderId(pr) !== 'vanilla' ? (
                <div className="set-row" style={{ alignItems: 'flex-start' }}>
                  <span className="lab">
                    Скин Millida в игре
                    <small>
                      {skinMod?.conflict
                        ? 'В сборке уже есть свой мод скинов (' + skinMod.conflict + ') — свой лаунчер не добавляет'
                        : skinMod?.on
                          ? 'Лаунчер добавляет в сборку CustomSkinLoader, чтобы твой скин было видно на серверах'
                          : 'Выключено: мод в эту сборку не добавляется. Включай, если скин не виден в игре'}
                    </small>
                  </span>
                  <div className="segs">
                    {[
                      ['on', 'Включить'],
                      ['off', 'Выключить'],
                    ].map(([v, label]) => {
                      const active = (v === 'on') === !!skinMod?.on
                      return (
                        <button
                          key={v}
                          className={'seg' + (active ? ' on' : '')}
                          data-skinmod={v}
                          style={{ height: '32px', fontSize: '12.5px' }}
                          disabled={skinModBusy || active || !skinMod}
                          onClick={() => void toggleSkinMod()}
                        >
                          {skinModBusy ? 'Меняем…' : label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
              <div className="set-row">
                <span className="lab">
                  Аргументы JVM<small>Для опытных — тюнинг сборщика мусора</small>
                </span>
                <div className="input sm" style={{ width: '220px' }}>
                  <input
                    id="bsJvm"
                    placeholder="-XX:+UseG1GC"
                    value={jvm}
                    onChange={(e) => setJvm(e.target.value)}
                    onBlur={saveOpts}
                  />
                </div>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lab">
                  Java
                  <small>
                    {javaBusy
                      ? 'Качаем Java ' + javaBusy + ', это займёт минуту…'
                      : javaMajor
                        ? 'Сборка запускается на Java ' + javaMajor + ' — её скачал лаунчер'
                        : 'Пусто = ставим ту, которую просит версия. Можно вписать номер — например 25'}
                  </small>
                </span>
                <div style={{ width: '300px' }}>
                  <Select
                    width="100%"
                    value={String(javaMajor)}
                    disabled={!!javaBusy}
                    options={[
                      { value: '0', label: 'Версия Java: авто', sub: 'Ту, которую просит сборка' },
                      ...javaAll.map((m) => ({ value: String(m), label: 'Java ' + m, sub: 'Скачаем и закрепим за сборкой' })),
                    ]}
                    onChange={(v) => pinJavaMajor(Number(v))}
                  />
                  <div className="input sm" style={{ margin: '6px 0' }}>
                    <input
                      id="bsJava"
                      placeholder="Номер версии (25) или путь к java"
                      value={java}
                      onChange={(e) => setJava(e.target.value)}
                      onBlur={saveJavaField}
                    />
                  </div>
                  <Select
                    width="100%"
                    value={java && javaList.some((j) => j.path === java) ? java : ''}
                    disabled={!javaList.length}
                    placeholder={
                      javaList.length ? '— выбрать найденную (' + javaList.length + ') —' : 'Ищем Java в системе…'
                    }
                    options={javaList.map((j) => ({ value: j.path, label: j.version, sub: j.path }))}
                    onChange={(v) => {
                      setJava(v)
                      if (hasTauri() && profile)
                        saveProfileSettings(profile, jvm || '', +w || 0, +h || 0, v)
                          .then(() => {
                            setJavaMajor(0)
                            showToast('Java выбрана')
                          })
                          .catch((e) => showToast('' + e, 'error'))
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <button
                      className="btn sm secondary"
                      id="bsJavaBrowse"
                      style={{ flex: 1 }}
                      onClick={() => {
                        if (!hasTauri()) {
                          showToast('Доступно в приложении')
                          return
                        }
                        pickJavaPath()
                          .then((j) => {
                            if (!j) return
                            setJava(j.path)
                            setJavaList((l) => (l.some((x) => x.path === j.path) ? l : [j, ...l]))
                            if (profile)
                              saveProfileSettings(profile, jvm || '', +w || 0, +h || 0, j.path)
                                .then(() => setJavaMajor(0))
                                .catch((e) => showToast('' + e, 'error'))
                            showToast('Java выбрана: ' + j.version)
                          })
                          .catch((e) => showToast('' + e, 'error'))
                      }}
                    >
                      Обзор…
                    </button>
                    <button
                      className="btn sm secondary"
                      id="bsJavaDetect"
                      style={{ flex: 1 }}
                      onClick={() => {
                        if (!hasTauri()) {
                          showToast('Доступно в приложении')
                          return
                        }
                        setDetectLabel('Ищем…')
                        detectJava()
                          .then((list) => {
                            setDetectLabel('Найти')
                            setJavaList(list)
                            showToast(
                              list.length
                                ? 'Найдено Java: ' + list.length
                                : 'Java в системе не найдена — жми «Обзор…» или оставь пусто, скачаем сами',
                            )
                          })
                          .catch((e) => {
                            setDetectLabel('Найти')
                            showToast('' + e)
                          })
                      }}
                    >
                      {detectLabel}
                    </button>
                    <button
                      className="btn sm secondary"
                      id="bsJavaTest"
                      style={{ flex: 1 }}
                      onClick={() => {
                        if (!hasTauri()) {
                          showToast('Доступно в приложении')
                          return
                        }
                        const p = java.trim()
                        if (!p) {
                          showToast('Пусто = скачаем нужную Java сами')
                          return
                        }
                        testJava(p)
                          // Статус несёт иконка тоста (i-check / i-alert), дингбаты в тексте не нужны
                          .then((v) => showToast(String(v)))
                          .catch((e) => showToast(apiErrorText(e, 'Не удалось выполнить действие'), 'error'))
                      }}
                    >
                      Тест
                    </button>
                  </div>
                </div>
              </div>
              <div className="set-row">
                <span className="lab">
                  Разрешение окна<small>0 = как в игре</small>
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div className="input sm" style={{ width: '80px' }}>
                    <input
                      id="bsW"
                      type="number"
                      placeholder="Ширина"
                      value={w}
                      onChange={(e) => setW(e.target.value)}
                      onBlur={saveOpts}
                    />
                  </div>
                  <div className="input sm" style={{ width: '80px' }}>
                    <input
                      id="bsH"
                      type="number"
                      placeholder="Высота"
                      value={h}
                      onChange={(e) => setH(e.target.value)}
                      onBlur={saveOpts}
                    />
                  </div>
                </div>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lab">
                  Иконка сборки<small>Блок Millida, своя сборная или картинка</small>
                </span>
                <div style={{ width: '340px' }}>
                  <IconGrid
                    id="bsIcons"
                    current={pr ? pr.icon : null}
                    style={{ width: '100%', gridTemplateColumns: 'repeat(7,1fr)', maxHeight: '140px' }}
                    onPick={(v) => {
                      if (hasTauri() && profile)
                        setProfileIcon(profile, v).then(() => {
                          void useProfiles.getState().refresh()
                          showToast('Иконка обновлена')
                        })
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                    {customCover ? (
                      <img
                        src={customCover}
                        alt=""
                        width={32}
                        height={32}
                        style={{ borderRadius: '8px', objectFit: 'cover', flex: '0 0 auto' }}
                      />
                    ) : null}
                    <button
                      className="btn sm secondary"
                      id="bsIconBuild"
                      style={{ flex: 1 }}
                      data-sound="open"
                      onClick={() => setIconEditor(true)}
                    >
                      Собрать свою…
                    </button>
                    <button
                      className="btn sm secondary"
                      id="bsCoverPick"
                      style={{ flex: 1 }}
                      onClick={() => {
                        if (!hasTauri()) {
                          showToast('Доступно в приложении')
                          return
                        }
                        if (!profile) return
                        pickProfileCover(profile)
                          .then((all) => {
                            if (!all) return
                            void useProfiles.getState().refresh()
                            showToast('Обложка обновлена')
                          })
                          .catch((e) => showToast('' + e, 'error'))
                      }}
                    >
                      Своя картинка…
                    </button>
                    {customCover ? (
                      <button
                        className="btn sm secondary"
                        id="bsCoverClear"
                        onClick={() => {
                          if (!hasTauri() || !profile) return
                          clearProfileCover(profile).then(() => {
                            void useProfiles.getState().refresh()
                            showToast('Вернули блок Millida')
                          })
                        }}
                      >
                        Убрать
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="set-row" id="bsModpackRow" style={{ display: mpSlug ? '' : 'none' }}>
                <span className="lab">
                  Модпак<small>Обновить версию или откатиться</small>
                </span>
                <button
                  className="btn sm secondary"
                  id="bsModpackUpd"
                  onClick={() => useModpackVersions.getState().open(profile!, mpSlug, mpVersion)}
                >
                  Версии…
                </button>
              </div>
              <div className="set-row">
                <span className="lab">
                  Группа<small>Для порядка в списке сборок</small>
                </span>
                <div className="input sm" style={{ width: '180px' }}>
                  <input
                    id="bsGroup"
                    placeholder="Напр. Технические"
                    maxLength={GROUP_NAME_MAX}
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    onBlur={() => {
                      if (!hasTauri() || !profile) return
                      const g = group.trim()
                      setProfileGroup(profile, g).then(() => {
                        void useProfiles.getState().refresh()
                        showToast(g ? 'Группа: ' + g : 'Убрано из группы')
                      })
                    }}
                  />
                </div>
              </div>
              <div className="set-row">
                <span className="lab">
                  Скриншоты<small id="bsShotCount">{shotCount}</small>
                </span>
                <button
                  className="btn sm secondary"
                  id="bsShots"
                  onClick={() => {
                    if (hasTauri()) void useScreens.getState().open(profile!)
                    else showToast('Доступно в приложении')
                  }}
                >
                  Открыть папку
                </button>
              </div>
              <div className="set-row">
                <span className="lab">Папка сборки</span>
                <button
                  className="btn sm secondary"
                  id="bsFolder"
                  onClick={() => {
                    if (hasTauri()) openProfileFolder(profile!)
                    else showToast('Папка (демо)')
                  }}
                >
                  Открыть
                </button>
              </div>
              <div className="set-row">
                <span className="lab">
                  Перенести на другую версию<small>Копия сборки с модами под другую версию Minecraft</small>
                </span>
                <button
                  className="btn sm secondary"
                  id="bsMigrate"
                  onClick={() => {
                    if (!profile || !pr) return
                    useMigrate.getState().open(profile, pr.version, loaderId(pr))
                  }}
                >
                  <Icon id="i-arrow-r" /> Перенести
                </button>
              </div>
              <div className="set-row">
                <span className="lab">
                  Дублировать сборку<small>Копия со всем контентом</small>
                </span>
                <button
                  className="btn sm secondary"
                  id="bsDup"
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast('Доступно в приложении')
                      return
                    }
                    duplicateProfile(profile!)
                      .then(() => {
                        close()
                        void useProfiles.getState().refresh()
                        showToast('Сборка продублирована')
                      })
                      .catch((e) => showToast('Не удалось продублировать: ' + e, 'error'))
                  }}
                >
                  Дублировать
                </button>
              </div>
              <div className="set-row">
                <span className="lab">
                  Починить сборку<small>Сверить файлы игры и моды по хешам, перекачать битые</small>
                </span>
                <button
                  className="btn sm secondary"
                  id="bsRepair"
                  disabled={repairBusy}
                  onClick={() => {
                    setRepairBusy(true)
                    runRepair(profile!).finally(() => setRepairBusy(false))
                  }}
                >
                  <Icon id="i-restart" /> {repairBusy ? 'Чиним…' : 'Починить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {safetyOpen ? (
        <SafetyModal profile={profile!} onClose={() => setSafetyOpen(false)} onChanged={() => loadMods()} />
      ) : null}
      {shareOpen ? <SharePackModal profile={profile!} onClose={() => setShareOpen(false)} /> : null}
      {iconEditor && profile ? (
        <IconEditor
          title={profile}
          current={recallIconRecipe(profile)}
          onCancel={() => setIconEditor(false)}
          onSave={(data, r) => {
            if (!hasTauri()) {
              showToast('Доступно в приложении', 'error')
              return
            }
            setProfileIcon(profile, data)
              .then(() => {
                rememberIconRecipe(profile, r)
                setIconEditor(false)
                void useProfiles.getState().refresh()
                showToast('Иконка обновлена')
              })
              .catch((e) => showToast('Не удалось сохранить иконку: ' + e, 'error'))
          }}
        />
      ) : null}
    </div>
  )
}
