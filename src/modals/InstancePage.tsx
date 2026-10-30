import { ModDownloader } from '../components/build/ModDownloader'
import { UpdateAllModal } from '../components/build/UpdateAllModal'
import { TagEditor } from '../components/build/TagEditor'
import { FilesTab } from '../components/build/FilesTab'
import { normalizeGroup } from '../lib/buildGroups'
import { ExportModal } from '../components/build/ExportModal'
import { LinuxToolsRows } from '../components/build/LinuxToolsRows'
import { HorizonBuildRow } from '../components/build/HorizonBeta'
import { PackwizRow } from '../components/build/PackwizRow'
import { DEMO_MODS } from '../lib/demoMods'
import { DEMO_USER } from '../lib/demo'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { BuildIcon } from '../components/playhub/BuildIcon'
import { BuildIconPicker, BuildMenuItems, useMenuDismiss } from '../components/playhub/MyBuilds'
import { WorldManager } from '../components/WorldManager'
import { ScreenshotGallery } from '../components/ScreenshotGallery'
import { SafetyModal } from '../components/SafetyModal'
import { SharePackModal } from '../components/SharePackModal'
import { PackUpdateRow } from '../components/PackUpdateRow'
import { ShadersRow } from '../components/ShadersRow'
import { BuildGfxPresets } from '../components/GfxPresets'
import { GRAPHICS_PRESETS_PUBLIC } from '../lib/graphicsRelease'
import { ShortcutRow } from '../components/ShortcutRow'
import { CommonShareRows } from '../components/CommonShareRows'
import { PackAutoUpdateRow } from '../components/PackAutoUpdateRow'
import { TunePanel } from '../components/TunePanel'
import { buildRamGb, setBuildRamMb } from '../lib/ramPref'
import { IconEditor } from '../components/IconEditor'
import { recallIconRecipe, rememberIconRecipe } from '../lib/iconArt'
import { uiConfirm } from '../state/confirm'
import { isOwnModFile, keepAfterOwnModConfirm, skinModOff } from '../lib/millidaModGuard'
import { copyText } from '../lib/clipboard'
import { hasTauri } from '../ipc/tauri'
import { listenDragDrop, listenDragState } from '../ipc/events'
import { followGameLog } from '../lib/gameLogFeed'
import {
  addLocalFile,
  addServer,
  auditDeps,
  checkUpdates,
  countScreenshots,
  deleteContent,
  deleteProfile,
  detectJava,
  deviceSpecs,
  duplicateProfile,
  exportMrpack,
  getPlayStats,
  getProfileGroups,
  importWorld,
  listContent,
  listLogs,
  listServers,
  loadProfileSettings,
  migratePlan,
  fpsBoostState,
  gpuSwitchSupported,
  liftMillidaModQuarantine,
  setProfileGpu,
  setSkinMod,
  skinModState,
  modpackInfo,
  openProfileFolder,
  openUrl,
  pickContentFiles,
  pickJavaPath,
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
  setContentLocked,
  contentTags,
  dismissEmbeddedJars,
  setProfileJavaVendor,
  saveBuildTemplate,
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
  UpdateInfo,
  JavaVendorId,
} from '../ipc/commands'
import { Select } from '../components/Select'
import { ModVersionPick } from '../components/ModVersionPick'
import { ContextMenu, type ContextItem } from '../components/ContextMenu'
import { Slider } from '../components/Slider'
import { RAM_MAX_GB, maxRamGb } from '../lib/ram'
import { randomIcon } from '../lib/buildIcon'
import { BUILD_NAME_MAX, GROUP_NAME_MAX, LOADER_NAME, fmtPlaytime, fmtSize, loaderId, plural, whenText } from '../lib/format'
import { isLibraryMod } from '../lib/modRole'
import '../styles/pixel/build-page.css'
import { AUTO_LOADER_VERSION, hasLoaderVersions, useLoaderBuilds } from '../lib/loaderBuilds'
import { loaderPinFollowsGame, useCoreUpdate } from '../lib/coreUpdate'
import { incompatibleWith } from '../lib/compat'
import { fixItems, issueInstall } from '../lib/deps'
import { installExtras } from '../lib/install'
import { ensureMcVersionList, useMcVersionList, versionOptions } from '../state/mcVersionList'
import { useGuarded, useProfiles } from '../state/profiles'
import { catalogPackSlug } from '../lib/packUpdate'
import { useInstance } from '../state/instance'
import { closeModal, setScreen, showToast, useUi, openModal } from '../state/ui'
import { repairPack } from '../lib/repair'
import { openMilli } from '../state/milli'
import { joinWithAuth, realLaunch, showLaunchError, startPrelaunch } from '../lib/launch'
import { ALL_CATEGORIES, useMods } from '../state/mods'
import { useModpackVersions } from '../state/modpack'
import { useMigrate } from '../state/migrate'
import { openProject } from '../state/project'
import { stopRunningGame, useGame } from '../state/game'
import { apiErrorText } from '../lib/apiError'
import { trackFailure } from '../lib/telemetry'
import { hasMillidaAccount, mirrorAsset } from '../lib/api'
import { t, tx, useT } from '../i18n'
import { LaunchHooksBlock } from '../components/build/LaunchHooksBlock'
import { noted } from '../lib/noted'
import { versionAtLeast } from '../lib/promoServers'

/// Имя сборки в тексте ошибки — личное.
const maskBuild = (e: unknown, name: string | null | undefined) =>
  name && name.length >= 2 ? String(e).split(name).join('<build>') : String(e)

const AUTO_FIX_ROUNDS = 2

const KIND_ICON: Record<string, string> = {
  mod: 'i-blocks',
  resourcepack: 'i-image',
  datapack: 'i-book',
  shader: 'i-eye',
}

const kinds = (): [string, string][] => [
  ['mod', t('Моды')],
  ['resourcepack', t('Ресурспаки')],
  ['datapack', t('Дата-паки')],
  ['shader', t('Шейдеры')],
]

const auditLabel = (): Record<string, string> => ({
  missing: t('не хватает мода'),
  conflict: t('конфликт'),
  version: t('не для этой версии'),
  loader: t('другой загрузчик'),
})

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

const CATALOG_PACK_PAGE = 'https://millida.net/modpacks/'

/** A protected build is shared by its catalogue page: its own files are the author's to show. */
/** Пресеты графики рисуются, когда ядро ответило: ждём блок до полутора секунд и прокручиваем к нему. */
function scrollToGfx(triesLeft = 30) {
  requestAnimationFrame(() => {
    const block = document.getElementById('bsGfx')
    if (block) block.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else if (triesLeft > 0) setTimeout(() => scrollToGfx(triesLeft - 1), 50)
  })
}

function shareCatalogLink(profile: string) {
  loadProfileSettings(profile)
    .then((s) => {
      const slug = catalogPackSlug(s)
      if (!slug) throw new Error(t('у сборки нет страницы в каталоге'))
      return copyText(CATALOG_PACK_PAGE + slug)
    })
    .then((copied) => {
      if (!copied) throw new Error(t('буфер обмена занят — попробуй ещё раз'))
      showToast(t('Ссылка на сборку в каталоге скопирована'), 'ok')
    })
    .catch((e) => showToast(t('Не удалось скопировать ссылку: {error}', { error: apiErrorText(e, t('попробуй ещё раз')) }), 'error'))
}

const coreOpts = (): [string, string][] => [
  ['vanilla', t('Ванилла')],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
  ['legacyfabric', 'Legacy Fabric'],
]


const kindForms = (kind: string): { one?: string; few?: string; many?: string } =>
  (
    {
      mod: { one: t('мод'), few: t('мода'), many: t('модов') },
      resourcepack: { one: t('ресурс-пак'), few: t('ресурс-пака'), many: t('ресурс-паков') },
      datapack: { one: t('дата-пак'), few: t('дата-пака'), many: t('дата-паков') },
      shader: { one: t('шейдер'), few: t('шейдера'), many: t('шейдеров') },
    } as Record<string, { one: string; few: string; many: string }>
  )[kind] ?? {}
const emptyTitle = (): Record<string, string> => ({ mod: t('Модов пока нет'), resourcepack: t('Ресурс-паков пока нет'), datapack: t('Дата-паков пока нет'), shader: t('Шейдеров пока нет') })

type ContentSort = 'name' | 'new' | 'old'
const sortLabel = (): Record<ContentSort, string> => ({ name: t('По названию'), new: t('Сначала новые'), old: t('Сначала старые') })
const SORT_KEY = 'm-content-sort'
const readSort = (): ContentSort => {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === 'new' || v === 'old' ? v : 'name'
  } catch {
    return 'name'
  }
}
/** «Новый» — файл появился в сборке за последние три часа: видно, что только что добавил. */
const FRESH_SEC = 3 * 3600
/** Sinytra Connector and its Fabric API port: what lets Fabric mods load on Forge and NeoForge. */
const CONNECTOR_ITEMS = [
  { source: 'modrinth', project_id: 'connector' },
  { source: 'modrinth', project_id: 'forgified-fabric-api' },
]
/** Connector has no build for older games: offering it on 1.7.10 ended in «нет версии под 1.7.10». */
const CONNECTOR_MIN_GAME = '1.20.1'
const fabricOnly = (m: ModFile) => {
  const ls = m.loaders?.length ? m.loaders : m.loader ? [m.loader] : []
  return ls.includes('fabric') && !ls.includes('forge') && !ls.includes('neoforge')
}
const isConnector = (m: ModFile) => /(^|[^a-z])connector/i.test(m.name) || /sinytra connector|^connector$/i.test(m.title || '')
/** Tags are cleaned of control characters in the core, so this value never collides with one. */
const MANUAL_FILTER = '\u0000manual'

/** Имя неопознанного файла по-человечески: «dungeons-and-taverns-3.0.3.f.jar» → «Dungeons and taverns». */
function prettyFile(name: string): string {
  const bare = name.replace(/\.(jar|zip|litemod)$/i, '')
  const base = bare.replace(/[-_+ ]v?(mc)?\d+(\.\d+)+.*$/i, '') || bare
  const words = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

/** Значок мода: картинка, а нет её или она битая — значок раздела. Не оба сразу (прозрачные значки просвечивали). */
function ModArt({ src, icon, sm }: { src?: string; icon: string; sm?: boolean }) {
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [src])
  return (
    <span className={'bpg-art' + (sm ? ' sm' : '')}>
      {src && !bad ? <img src={mirrorAsset(src)} alt="" loading="lazy" onError={() => setBad(true)} /> : <Icon id={icon} />}
    </span>
  )
}

/** Главная кнопка вкладки «Контент»: что именно добавляем (владелец 07.10.2026: «Скачать» непонятно). */
const addLabel = (): Record<string, string> => ({ mod: t('Добавить моды'), resourcepack: t('Добавить ресурс-паки'), shader: t('Добавить шейдеры'), datapack: t('Добавить дата-паки') })
export function InstancePage() {
  const t = useT()
  const modal = useUi((s) => s.modals.bsModal)
  const profile = useInstance((s) => s.profile)
  const profiles = useProfiles((s) => s.profiles)
  const pr = profiles.find((x) => x.name === profile) || null
  const guarded = useGuarded(profile)

  const [iconEditor, setIconEditor] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [pickIcon, setPickIcon] = useState(false)
  useMenuDismiss(moreOpen, () => setMoreOpen(false), '.inst-menu, .inst-more')
  const [tab, setTab] = useState('content')
  const [kind, setKind] = useState('mod')
  const [items, setItems] = useState<ModFile[]>([])
  const [contentQuery, setContentQuery] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [dlOpen, setDlOpen] = useState(false)
  const [upd, setUpd] = useState<Record<string, string>>({})
  const [updList, setUpdList] = useState<UpdateInfo[]>([])
  const [updAsk, setUpdAsk] = useState(false)
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [packSafetyOpen, setPackSafetyOpen] = useState(false)
  const [fileSafetyOpen, setFileSafetyOpen] = useState(false)
  const [authorRamGb, setAuthorRamGb] = useState(0)
  const [authorLocked, setAuthorLocked] = useState(false)
  const [embedded, setEmbedded] = useState<string[]>([])
  const [itemLabels, setItemLabels] = useState<Record<string, string>>({})
  const [emptyList, setEmptyList] = useState(false)
  const [openInfo, setOpenInfo] = useState('')
  const [scanLabel, setScanLabel] = useState(t('Сканировать'))
  const [audit, setAudit] = useState<DepAudit | null>(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [noticeList, setNoticeList] = useState('')
  const [playtime, setPlaytime] = useState('')
  const [ram, setRam] = useState(0)
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
    void setBuildRamMb(profile, ramMax * 1024)
  }, [profile, ram, ramMax])
  const [boost, setBoost] = useState<FpsBoostState | null>(null)
  const [boostBusy, setBoostBusy] = useState(false)
  /// Пресет графики меняет шейдеры и буст: строка шейдеров перечитывает своё состояние.
  const [gfxRev, setGfxRev] = useState(0)
  const [skinMod, setSkinModState] = useState<SkinModState | null>(null)
  const [skinModBusy, setSkinModBusy] = useState(false)
  const skinOff = skinModOff(skinMod)
  const [jvm, setJvm] = useState('')
  const [w, setW] = useState('')
  const [h, setH] = useState('')
  const [java, setJava] = useState('')
  const [javaList, setJavaList] = useState<JavaInfo[]>([])
  const [javaMajor, setJavaMajor] = useState(0)
  const [gpu, setGpu] = useState<GpuPref>('auto')
  const [gpuOk, setGpuOk] = useState(true)
  const [javaAll, setJavaAll] = useState<number[]>([])
  const [javaVendor, setJavaVendor] = useState<JavaVendorId>('temurin')
  const [vendorBusy, setVendorBusy] = useState(false)
  const [javaBusy, setJavaBusy] = useState(0)
  const [detectLabel, setDetectLabel] = useState(t('Найти'))
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
  const [worldCount, setWorldCount] = useState(0)
  const [worldsReload, setWorldsReload] = useState(0)
  const [serverForm, setServerForm] = useState(false)
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const [logFiles, setLogFiles] = useState<string[]>([])
  const [logFile, setLogFile] = useState('')
  const [logBody, setLogBody] = useState('')
  const [logView, setLogView] = useState<'live' | 'files'>('live')
  const [liveLines, setLiveLines] = useState<string[]>([])
  const liveBuffer = useRef<string[]>([])
  const logsShown = useRef(false)
  const running = useGame((s) => s.list)
  const gameStopping = useGame((s) => s.stopping)
  const thisRunning = !!profile && running.includes(profile)
  const liveRef = useRef<HTMLPreElement>(null)
  const [shareLabel, setShareLabel] = useState(t('Поделиться'))
  const [updateAllLabel, setUpdateAllLabel] = useState(t('Обновить всё'))
  const [renameVal, setRenameVal] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [newLoader, setNewLoader] = useState('vanilla')
  const [newLoaderVer, setNewLoaderVer] = useState(AUTO_LOADER_VERSION)
  const [newVersion, setNewVersion] = useState('')
  const [coreBusy, setCoreBusy] = useState(false)
  const [coreEdit, setCoreEdit] = useState(false)
  const lb = useLoaderBuilds(newLoader, newVersion, modal.open)
  const mcList = useMcVersionList((s) => s.list)
  const showSnapshots = useMcVersionList((s) => s.show)
  // The build's own version stays selectable even when it is a snapshot and the
  // list is filtered down to releases: hiding it would silently change the build.
  const verOpts = useMemo(
    () => versionOptions(mcList, showSnapshots, newVersion),
    [mcList, showSnapshots, newVersion],
  )
  const coreUpd = useCoreUpdate(
    pr ? pr.version : '',
    pr ? loaderId(pr) : 'vanilla',
    pr ? pr.loader_version : null,
    mcList,
    modal.open && tab === 'opts' && !guarded,
  )
  const [note, setNote] = useState('')
  const logBodyRef = useRef<HTMLPreElement>(null)
  const kindRef = useRef(kind)
  kindRef.current = kind
  const tabRef = useRef(tab)
  tabRef.current = tab
  const authorLockedRef = useRef(false)
  authorLockedRef.current = authorLocked
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [dropBusy, setDropBusy] = useState(false)
  // Редкие действия со списком (опознать, проверить, экспорт) — в меню «Ещё»:
  // семь кнопок в ряд читались как одна серая полоса (аудит 22.09.2026).
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null)
  // Java, аргументы JVM и размер окна — для опытных, по умолчанию свёрнуты.
  const [advanced, setAdvanced] = useState(false)
  // Страница сборки как в Modrinth App (владелец 10.10.2026: «неприятно собирать сборку»):
  // сортировка, фильтры, библиотеки отдельно, действия над выбранным — снизу.
  const [sort, setSort] = useState<ContentSort>(readSort)
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null)
  const [filter, setFilter] = useState<'' | 'updates' | 'off'>('')
  const [libsOpen, setLibsOpen] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const visibleRef = useRef<string[]>([])
  const selRef = useRef(sel)
  selRef.current = sel
  const pickSort = (v: ContentSort) => {
    setSort(v)
    try {
      localStorage.setItem(SORT_KEY, v)
    } catch {
      /* не запомнится — не страшно */
    }
  }

  // Сколько чего в сборке — на вкладках «Моды 10 · Ресурспаки 2» и в шапке.
  useEffect(() => {
    if (!modal.open || !profile) return
    if (!hasTauri()) {
      setCounts({ mod: DEMO_USER ? DEMO_MODS.length : 0 })
      return
    }
    let alive = true
    void Promise.all(kinds().map(([k]) => listContent(profile, k).then((l) => [k, l.length] as const, () => [k, 0] as const))).then(
      (rows) => alive && setCounts(Object.fromEntries(rows)),
    )
    return () => {
      alive = false
    }
  }, [modal.open, profile])
  useEffect(() => {
    if (!noticeList) setCounts((c) => (c[kind] === items.length ? c : { ...c, [kind]: items.length }))
  }, [items, kind, noticeList])

  // «/» — в поиск, Ctrl/⌘+A — выбрать всё видимое, Esc — снять выбор (а не закрыть сборку).
  useEffect(() => {
    if (!modal.open || tab !== 'content') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
      if (document.querySelector('.mdl-back, .ip-bg, .modal-bg.open:not(#bsModal)')) return
      if (e.key === '/' && !typing) {
        e.preventDefault()
        document.getElementById('bsSearch')?.focus()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault()
        setSel(new Set(visibleRef.current))
      } else if (e.key === 'Escape' && selRef.current.size) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setSel(new Set())
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [modal.open, tab])

  const loadMods = useCallback(
    (k?: string) => {
      const kk = k || kindRef.current
      setSel(new Set())
      setUpd({})
      setUpdList([])
      setItemLabels({})
      if (!profile) return
      if (useProfiles.getState().guarded.includes(profile)) {
        setItems([])
        setEmptyList(false)
        setNoticeList('')
        return
      }
      if (!hasTauri()) {
        // Демо (?preview): список модов как в настоящей сборке, чтобы видеть экран целиком.
        const demo = DEMO_USER && kk === 'mod' ? DEMO_MODS : []
        setItems(demo)
        setNoticeList(demo.length ? '' : t('Список появится в приложении'))
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
              setUpdList(ups || [])
            })
            .catch(() => {})
          contentTags(profile, kk)
            .then((tags) => {
              setKnownTags(tags)
              setTagFilter((f) => (f && !tags.includes(f) ? '' : f))
            })
            .catch(() => setKnownTags([]))
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
    (auto: boolean, fix: boolean = auto) => {
      if (!profile || !hasTauri() || useProfiles.getState().guarded.includes(profile)) return
      setAuditBusy(true)
      auditDeps(profile)
        .then((r) => {
          setAuditBusy(false)
          setAudit(r)
          if (!fix || autoRound.current >= AUTO_FIX_ROUNDS) return
          const items = fixItems(r)
          if (!items.length) return
          autoRound.current += 1
          installExtras(profile, 'mod', items, () => {
            loadMods('mod')
            runAuditRef.current(auto, fix)
          })
        })
        .catch((e) => {
          setAuditBusy(false)
          if (!auto) showToast(t('Не удалось проверить: {error}', { error: tx(e) }), 'error')
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
      setWorldsNotice(t('Доступно в приложении'))
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
          setLogBody(t('Логи появятся после первого запуска игры'))
          return
        }
        setLogFile(files[0])
      })
      .catch(() => {})
  }, [profile])

  useEffect(() => {
    if (!profile || !logFile || !hasTauri()) return
    readLog(profile, logFile).then((text) => setLogBody(text || t('(пусто)')))
  }, [profile, logFile])

  useEffect(() => {
    const b = logBodyRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [logBody])

  // The core keeps the log from the launch on, so a page opened mid-game shows the start too.
  // The console is the only reader: off its tab the lines only pile up, so a game that
  // writes a batch every 120 ms does not redraw the whole page with its mod list.
  useEffect(
    () =>
      followGameLog(800, (lines) => {
        liveBuffer.current = lines
        if (logsShown.current) setLiveLines(lines)
      }),
    [],
  )

  const consoleShown = modal.open && tab === 'logs'
  useEffect(() => {
    logsShown.current = consoleShown
    if (consoleShown) setLiveLines(liveBuffer.current)
  }, [consoleShown])

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
    const { tab: wantTab, focusRename, share: wantShare, focusGfx } = useInstance.getState()
    setTab(wantTab)
    if (focusGfx) {
      useInstance.getState().set({ focusGfx: false })
      scrollToGfx()
    }
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
    const shareLink = wantShare && useProfiles.getState().guarded.includes(profile)
    setShareOpen(wantShare && !shareLink)
    if (shareLink) shareCatalogLink(profile)
    if (wantShare) useInstance.getState().set({ share: false })
    setKind('mod')
    setPlaytime('')
    setRam(0)
    void buildRamGb(profile)
      .then(setRam)
      .catch(() => {})
    setJavaList([])
    setDetectLabel(t('Найти'))
    setShotCount('—')
    setMpSlug('')
    setMpVersion('')
    setWFilter('all')
    setCoreEdit(false)
    setServerForm(false)
    setWsName('')
    setWsIp('')
    setShareLabel(t('Поделиться'))
    setUpdateAllLabel(t('Обновить всё'))
    setRenameVal(profile)
    setAuthorRamGb(0)
    setAuthorLocked(false)
    setEmbedded([])
    try {
      setNote(localStorage.getItem('m-note-' + profile) || '')
    } catch {
      setNote('')
    }
    if (hasTauri()) {
      ensureMcVersionList().catch((e) =>
        showToast(t('Список версий Minecraft не загрузился: {error}. Проверь интернет и открой сборку заново', { error: tx(e) }), 'error'),
      )
      getPlayStats()
        .then((s) => {
          const b = s.builds.find((x) => x.key === profile)
          if (!b || !b.seconds) return
          setPlaytime(
            b.last
              ? t(' · играно {time} · заходил {when}', { time: fmtPlaytime(b.seconds), when: whenText(b.last) })
              : t(' · играно {time}', { time: fmtPlaytime(b.seconds) }),
          )
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
          setJavaVendor(cfg.javaVendor === 'zulu' || cfg.javaVendor === 'semeru' ? cfg.javaVendor : 'temurin')
          setGpu(cfg.gpu || 'auto')
          setAuthorRamGb(Math.round((Number(cfg.authorRamMb) || 0) / 1024))
          setAuthorLocked(cfg.authorLocked === true)
          setEmbedded(Array.isArray(cfg.embeddedJars) ? cfg.embeddedJars : [])
        })
        .catch(() => {})
      detectJava()
        .then((list) => setJavaList(list))
        .catch(() => {})
      javaMajors()
        .then(setJavaAll)
        .catch(() => {})
      countScreenshots(profile)
        .then((n) => setShotCount(n ? t('{n} шт.', { n }) : t('пока нет')))
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
      showToast(t('Буст FPS доступен в приложении'), 'error')
      return
    }
    const on = !(boost && boost.enabled)
    setBoostBusy(true)
    try {
      const next = await setFpsBoost(profile, on)
      setBoost(next)
      loadMods()
      if (!on) {
        showToast(t('Буст FPS выключен — моды сняты, настройки графики вернули как было'))
      } else if (next.vanilla) {
        showToast(t('Буст FPS включён: профиль JVM и лёгкая графика. Моды-ускорители работают только на Fabric/Forge.'))
      } else {
        showToast(
          next.skipped.length
            ? t('Буст FPS включён: {n} мод(ов), профиль JVM и лёгкая графика. Без сборки под эту версию: {list}', { n: next.mods.length, list: next.skipped.join(', ') })
            : t('Буст FPS включён: {n} мод(ов), профиль JVM и лёгкая графика', { n: next.mods.length }),
        )
      }
    } catch (e) {
      showToast(t('Не удалось переключить буст FPS: {error}', { error: tx(e) }), 'error')
    } finally {
      setBoostBusy(false)
    }
  }

  const toggleVulkan = async () => {
    if (!profile || !boost) return
    const want = !boost.vulkan
    setBoostBusy(true)
    try {
      const next = await setFpsBoost(profile, boost.enabled, false, undefined, want)
      setBoost(next)
      loadMods()
      if (next.enabled) showToast(want ? t('Рендер сменён на VulkanMod') : t('Рендер снова Sodium'))
    } catch (e) {
      showToast(t('Не удалось сменить рендер: {error}', { error: tx(e) }), 'error')
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
          ? t('Мод скинов вернётся в сборку при следующем запуске')
          : t('Мод скинов убран — лаунчер больше не будет добавлять его в эту сборку'),
      )
    } catch (e) {
      showToast(t('Не удалось переключить мод скинов: {error}', { error: tx(e) }), 'error')
    } finally {
      setSkinModBusy(false)
    }
  }

  const liftQuarantine = async () => {
    if (!profile) return
    setSkinModBusy(true)
    try {
      setSkinModState(await liftMillidaModQuarantine(profile))
      showToast(t('Косметика Millida вернётся в сборку при следующем запуске'))
    } catch (e) {
      showToast(t('Не удалось вернуть косметику Millida: {error}', { error: tx(e) }), 'error')
    } finally {
      setSkinModBusy(false)
    }
  }

  const askOwnModRemoval = () =>
    uiConfirm(t('Скины, плащи и косметика Millida пропадут в этой сборке. Вернуть можно в настройках сборки.'), {
      title: t('Отключить косметику Millida в этой сборке?'),
      confirmLabel: t('Отключить'),
      cancelLabel: t('Отмена'),
    })

  const doRename = () => {
    const nn = renameVal.trim()
    if (!profile || !nn || nn === profile) return
    if (!hasTauri()) {
      showToast(t('Переименование доступно в приложении'), 'error')
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
        showToast(t('Сборка переименована в «{name}»', { name: nn }))
      })
      .catch((e) => showToast(t('Не удалось переименовать: {error}', { error: tx(e) }), 'error'))
      .finally(() => setRenameBusy(false))
  }

  const applyCore = async () => {
    if (!profile || !pr) return
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'), 'error')
      return
    }
    const ver = (newVersion || pr.version).trim()
    const lver = hasLoaderVersions(newLoader) ? newLoaderVer : AUTO_LOADER_VERSION
    if (ver === pr.version && newLoader === loaderId(pr) && lver === (pr.loader_version || AUTO_LOADER_VERSION)) {
      showToast(t('Ничего не поменялось'))
      return
    }
    const label = (coreOpts().find((c) => c[0] === newLoader)?.[1] || newLoader) + (lver ? ' ' + lver : '')
    if (
      !(await uiConfirm(t('Сменить сборку на {loader} {version}? Установленные моды могут стать несовместимы — проверь их после смены.', { loader: label, version: ver }), {
        confirmLabel: t('Сменить'),
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
        setCoreEdit(false)
        void useProfiles.getState().refresh()
        if (modCount > 0 && newLoader !== loaderId(pr)) {
          showToast(
            t('Загрузчик сменили на {loader}. Проверь моды ({n} шт.) — часть может не подойти.', { loader: label, n: modCount }),
          )
        } else {
          showToast(t('Готово: {loader} · {version}. Доустановим при запуске.', { loader: label, version: ver }))
        }
      })
      .catch((e) => showToast(t('Не удалось сменить: {error}', { error: tx(e) }), 'error'))
      .finally(() => setCoreBusy(false))
  }

  const applyGameUpdate = async (target: string) => {
    if (!profile || !pr) return
    const loader = loaderId(pr)
    const lver = loaderPinFollowsGame(loader) ? pr.loader_version || null : null
    setCoreBusy(true)
    try {
      const mods = await listContent(profile, 'mod')
      const plan = mods.length ? await migratePlan(profile, target, loader) : null
      const installed = new Map(mods.map((m) => [m.name.replace(/\.disabled$/, ''), m.version_number || '']))
      const refit = plan ? plan.items.filter((i) => i.ok && installed.get(i.file_name) !== i.version_number) : []
      const blocked = plan ? plan.items.filter((i) => !i.ok).map((i) => i.title) : []
      const unchecked = plan ? plan.unlinked : []
      const listed = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? t(' и ещё {n}', { n: names.length - 5 }) : '')
      const text =
        t('Обновить Minecraft {from} → {to}?', { from: pr.version, to: target }) +
        (refit.length ? t(' Моды под новую версию обновятся сами: {n} шт.', { n: refit.length }) : '') +
        (blocked.length ? t(' Нет сборки под {version}: {list} — останутся как есть и могут не запуститься.', { version: target, list: listed(blocked) }) : '') +
        (unchecked.length ? t(' Не проверить, добавлены вручную: {list}.', { list: listed(unchecked) }) : '')
      if (!(await uiConfirm(text, { confirmLabel: t('Обновить') }))) return
      await setProfileLoader(profile, target, loader, lver)
      const failed: string[] = []
      for (const i of refit) {
        await updateContent(profile, 'mod', i.file_name).catch(() => failed.push(i.title))
      }
      void useProfiles.getState().refresh()
      loadMods()
      if (failed.length) {
        showToast(t('Minecraft обновлён до {version}, но не обновились моды: {list}. Обнови их на вкладке модов.', { version: target, list: listed(failed) }), 'error')
      } else {
        showToast(t('Minecraft обновлён до {version}. Доустановим при запуске.', { version: target }))
      }
    } catch (e) {
      showToast(t('Не удалось обновить Minecraft: {error}', { error: tx(e) }), 'error')
    } finally {
      setCoreBusy(false)
    }
  }

  const applyLoaderUpdate = async (target: string) => {
    if (!profile || !pr) return
    const loader = loaderId(pr)
    const label = LOADER_NAME(pr)
    if (!(await uiConfirm(t('Обновить {loader} {from} → {to}?', { loader: label, from: pr.loader_version ?? '', to: target }), { confirmLabel: t('Обновить') })))
      return
    setCoreBusy(true)
    setProfileLoader(profile, pr.version, loader, target)
      .then(() => {
        void useProfiles.getState().refresh()
        showToast(t('{loader} обновлён до {version}. Доустановим при запуске.', { loader: label, version: target }))
      })
      .catch((e) => showToast(t('Не удалось обновить загрузчик: {error}', { error: tx(e) }), 'error'))
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
        showToast(t('Нужен файл {exts}', { exts: extsOf(k).map((e) => '.' + e).join(' / ') }), 'error')
        return
      }
      setDropBusy(true)
      showToast(t('Добавляем {n} файл(ов)…', { n: accepted.length }))
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
        showToast(t('Не удалось добавить: {error}', { error: failed[0] ?? '' }), 'error')
        return
      }
      if (failed.length) {
        showToast(t('Добавлено {ok}, с ошибкой {bad}: {error}', { ok: accepted.length - failed.length, bad: failed.length, error: failed[0] ?? '' }), 'error')
        return
      }
      showToast(skipped ? t('Добавлено в сборку: {n} · пропущено не по формату: {skipped}', { n: accepted.length, skipped }) : t('Добавлено в сборку: {n}', { n: accepted.length }))
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
      if (useProfiles.getState().guarded.includes(useInstance.getState().profile || '')) return
      if (authorLockedRef.current) return
      void addFiles(paths || [])
    }).then((u) => {
      unlistenDrop = u
    })
    listenDragState((active) => {
      const shut = useProfiles.getState().guarded.includes(useInstance.getState().profile || '')
      setDropActive(active && !shut && useUi.getState().modals.bsModal.open && tabRef.current === 'content')
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
      .catch((e) => {
        trackFailure('build_settings', maskBuild(e, profile), { step: 'save' })
        showToast('' + e, 'error')
      })
  }

  const pinJavaMajor = (major: number) => {
    if (!hasTauri() || !profile) return
    if (!major) {
      setJavaMajor(0)
      setProfileJavaMajor(profile, null)
        .then(() => showToast(t('Java для сборки снова выбирается автоматически')))
        .catch((e) => showToast('' + e, 'error'))
      return
    }
    if (!javaAll.includes(major)) {
      showToast(t('Лаунчер ставит только Java {list}', { list: javaAll.join(', ') }), 'error')
      return
    }
    setJavaBusy(major)
    setProfileJavaMajor(profile, major)
      .then((v) => {
        setJavaMajor(major)
        setJava('')
        showToast(t('Сборка запускается на Java {major} · {version}', { major, version: v }))
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

  const runScan = () => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    setScanLabel(t('Сканируем…'))
    scanContent(profile!, kind)
      .then((r) => {
        setScanLabel(t('Сканировать'))
        if (kindRef.current === kind) setItems(r.items)
        showToast(
          r.identified
            ? t('Опознано {found} из {total} ({sources})', {
                found: r.identified,
                total: r.scanned,
                sources: [r.modrinth ? 'Modrinth: ' + r.modrinth : '', r.curseforge ? 'CurseForge: ' + r.curseforge : ''].filter(Boolean).join(', '),
              })
            : t('Разобрано файлов: {n}', { n: r.scanned }),
        )
      })
      .catch((e) => {
        setScanLabel(t('Сканировать'))
        showToast(t('Не удалось просканировать: {error}', { error: tx(e) }), 'error')
      })
  }

  const runExport = () => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    showToast(t('Собираем .mrpack…'))
    exportMrpack(profile!, profile!, '1.0.0', pr ? LOADER_NAME(pr) + ' ' + pr.version : '')
      .then((p) => showToast(t('Экспортировано: {file}', { file: ('' + p).split('/').pop() ?? '' })))
      .catch((e) => showToast('' + e))
  }

  const close = () => closeModal('bsModal')

  /** Каталог на разделе «Карты», ставить — в эту сборку. */
  const openMapsCatalog = () => {
    useProfiles.getState().setSelected(profile)
    close()
    setScreen('mods')
    useMods.getState().scopeTo(profile)
    useMods.getState().set({ modTab: 'world', fCat: ALL_CATEGORIES })
    void useMods.getState().load()
  }
  const saveTemplate = () => {
    if (!hasTauri() || !profile) {
      showToast(t('Доступно в приложении'))
      return
    }
    saveBuildTemplate(profile, profile)
      .then((x) => showToast(t('Шаблон «{name}» сохранён — он появится в «Новой сборке»', { name: x.name }), 'ok'))
      .catch((e) => showToast(apiErrorText(e, t('Не удалось сохранить шаблон')), 'error'))
  }
  const openDatapackCatalog = () => {
    useProfiles.getState().setSelected(profile)
    close()
    setScreen('mods')
    useMods.getState().scopeTo(profile)
    useMods.getState().set({ modTab: 'datapack', fCat: ALL_CATEGORIES })
    void useMods.getState().load()
  }
  const importWorldArchive = () => {
    if (!hasTauri() || !profile) {
      showToast(t('Доступно в приложении'))
      return
    }
    importWorld(profile)
      .then((w) => {
        if (w) showToast(t('Мир внесён в сборку'), 'ok')
        setWorldsReload((n) => n + 1)
      })
      .catch((e) => showToast('' + e, 'error'))
  }

  const bulk = (names: string[], fn: (n: string) => Promise<unknown>, after?: () => void) =>
    Promise.all(names.map(fn))
      .then(() => {
        setSel(new Set())
        loadMods()
        if (after) after()
      })
      .catch((e) => showToast(apiErrorText(e, t('Не удалось выполнить действие')), 'error'))


  const cq = contentQuery.trim().toLowerCase()
  const updCount = items.filter((i) => upd[i.name]).length
  const offCount = items.filter((i) => !i.enabled).length
  const titleOf = (i: ModFile) => i.title || prettyFile(i.name)
  const shownItems = items
    .filter((i) => !cq || (titleOf(i) + ' ' + (i.author || '') + ' ' + i.name).toLowerCase().includes(cq))
    .filter((i) => (filter === 'updates' ? !!upd[i.name] : filter === 'off' ? !i.enabled : true))
    .filter((i) => (tagFilter === MANUAL_FILTER ? i.origin === 'manual' : !tagFilter || (i.tags || []).includes(tagFilter)))
    .slice()
    .sort((a, b) =>
      sort === 'name'
        ? titleOf(a).localeCompare(titleOf(b), 'ru', { sensitivity: 'base' })
        : sort === 'new'
          ? (b.added || 0) - (a.added || 0) || titleOf(a).localeCompare(titleOf(b))
          : (a.added || 0) - (b.added || 0) || titleOf(a).localeCompare(titleOf(b)),
    )
  // Свои моды — сверху, библиотеки (Fabric API, Cloth Config…) — свёрнутой строкой: их
  // ставят ради других модов, и в списке они только мешали искать своё.
  const grouped = kind === 'mod' && !cq && !filter && !tagFilter
  const manualCount = items.filter((i) => i.origin === 'manual').length
  const forgeLike = !!pr && (loaderId(pr) === 'forge' || loaderId(pr) === 'neoforge')
  const bridgeable = forgeLike && kind === 'mod' && !!pr && versionAtLeast(pr.version, CONNECTOR_MIN_GAME)
  const fabricOnForge = bridgeable ? items.filter((i) => i.enabled && fabricOnly(i)) : []
  const hasConnector = items.some(isConnector)
  const libs = grouped ? shownItems.filter((i) => isLibraryMod(i)) : []
  const mains = grouped ? shownItems.filter((i) => !isLibraryMod(i)) : shownItems
  visibleRef.current = (libsOpen ? [...mains, ...libs] : mains).map((i) => i.name)
  const allSel = shownItems.length > 0 && shownItems.every((i) => sel.has(i.name))
  const nowSec = Date.now() / 1000
  // «Новый» — только когда новое выделяется: сборку целиком поставили только что — меток нет
  // (владелец 10.10.2026: «Новый» висел на каждом моде).
  const freshAll = items.filter((i) => !!i.added && nowSec - i.added < FRESH_SEC)
  const freshNames = new Set(freshAll.length && freshAll.length <= Math.max(3, items.length * 0.25) ? freshAll.map((i) => i.name) : [])

  const toggleOne = (md: ModFile) =>
    toggleContent(profile!, kind, md.name, !md.enabled)
      .then(() => loadMods())
      .catch((e) => showToast(apiErrorText(e, t('Не удалось выполнить действие')), 'error'))

  const row = (md: ModFile) => {
    const up = upd[md.name]
    const title = titleOf(md)
    const info = openInfo === md.name
    const picked = sel.has(md.name)
    const modrinth = md.project_id && !md.project_id.startsWith('cf:') && !md.project_id.startsWith('millida:') ? md.project_id : ''
    const curse = md.project_id && md.project_id.startsWith('cf:') ? md.project_id.slice(3) : ''
    const src = modrinth ? 'Modrinth' : curse ? 'CurseForge' : md.project_id && md.project_id.startsWith('millida:') ? 'Millida' : t('Файл')
    const fresh = freshNames.has(md.name)
    const facts = [
      md.version_number ? t('версия {version}', { version: md.version_number }) : '',
      md.mc ? 'MC ' + md.mc : '',
      md.author ? t('автор: {author}', { author: md.author }) : '',
      md.loaders?.length ? md.loaders.join(' · ') : md.loader || '',
      fmtSize(md.size),
    ].filter(Boolean)
    return (
      <div className={'bpg-row' + (md.enabled ? '' : ' off') + (info ? ' open' : '') + (picked ? ' sel' : '')} key={md.name}>
        <div
          className="bpg-row-main"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, .tgl, .chk')) return
            setOpenInfo(info ? '' : md.name)
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest('button, .tgl, .chk')) return
            void toggleOne(md)
          }}
        >
          <span
            className={'chk bpg-chk' + (picked ? ' on' : '')}
            data-sel={md.name}
            role="checkbox"
            aria-checked={picked}
            aria-label={t('Выбрать {name}', { name: title })}
            onClick={() =>
              setSel((cur) => {
                const next = new Set(cur)
                if (next.has(md.name)) next.delete(md.name)
                else next.add(md.name)
                return next
              })
            }
          />
          <ModArt src={md.icon_url} icon={KIND_ICON[kind]!} />
          <span className="bpg-body">
            <span className="bpg-title">
              <b>{title}</b>
              {fresh ? <span className="bpg-tag new">{t('Новый')}</span> : null}
              {incompatibleWith(md.mc, pr ? pr.version : '') ? <span className="bpg-tag bad">{t('для {version}', { version: md.mc ?? '' })}</span> : null}
              {!md.enabled ? <span className="bpg-tag">{t('выключен')}</span> : null}
              {md.pending ? <span className="bpg-tag upd">{t('после перезапуска')}</span> : null}
              {md.locked ? (
                <span className="bpg-tag" title={t('Версия закреплена')}>
                  <Icon id="i-lock" />
                </span>
              ) : null}
              {md.origin === 'manual' ? <span className="bpg-tag">{t('вручную')}</span> : md.origin === 'pack' ? <span className="bpg-tag">{t('из сборки')}</span> : null}
              {(md.tags || []).map((tag) => (
                <span className="bpg-tag" key={tag}>
                  {'#' + tag}
                </span>
              ))}
            </span>
            <span className="bpg-sub">{md.author ? t('от {author}', { author: md.author }) : md.title ? md.description || md.name : t('Файл · {name}', { name: md.name })}</span>
          </span>
          <span className="bpg-ver">
            <b title={md.version_number || md.name}>{md.version_number || '—'}</b>
            {up ? (
              // Обновление — тихой зелёной строкой под версией, а не кнопкой посреди ряда.
              <button
                className="bpg-verup"
                data-upd={md.name}
                title={t('Обновить {name} до {version}', { name: title, version: up })}
                onClick={() => {
                  setItemLabels((l) => ({ ...l, [md.name]: t('Обновляем…') }))
                  updateContent(profile!, kind, md.name)
                    .then(() => {
                      loadMods()
                      showToast(t('Обновлено: {name}', { name: title }))
                    })
                    .catch((er) => {
                      loadMods()
                      showToast('' + er)
                    })
                }}
              >
                {itemLabels[md.name] || (
                  <>
                    <Icon id="i-arrow-up" />
                    <span>{t('до {version}', { version: up })}</span>
                  </>
                )}
              </button>
            ) : (
              <small>{src}</small>
            )}
          </span>
          <span className="bpg-acts">
            <span
              className={'tgl' + (md.enabled ? ' on' : '')}
              data-tg={md.name}
              role="switch"
              aria-checked={md.enabled}
              aria-label={md.enabled ? t('Выключить {name}', { name: title }) : t('Включить {name}', { name: title })}
              onClick={() => void toggleOne(md)}
            />
            <button
              className="icon-btn del bpg-del"
              data-del={md.name}
              aria-label={t('Удалить')}
              title={t('Удалить (Shift — без вопроса)')}
              onClick={async (e) => {
                if (kind === 'mod' && isOwnModFile(md.name)) {
                  if (!(await askOwnModRemoval())) return
                } else if (!e.shiftKey && !(await uiConfirm(t('Удалить «{name}» из сборки?', { name: title }), { confirmLabel: t('Удалить') }))) return
                deleteContent(profile!, kind, md.name)
                  .then(() => loadMods())
                  .catch((er) => showToast(apiErrorText(er, t('Не удалось выполнить действие')), 'error'))
              }}
            >
              <Icon id="i-trash" />
            </button>
          </span>
        </div>
        {info ? (
          <div className="mod-card-info bpg-info">
            {md.description ? <p className="mod-card-desc">{md.description}</p> : null}
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
            <TagEditor profile={profile!} kind={kind} file={md.name} tags={md.tags || []} known={knownTags} onSaved={() => loadMods()} />
            <div className="mod-card-acts">
              {md.project_id ? (
                <button
                  className={'btn sm ' + (md.locked ? 'primary' : 'secondary')}
                  aria-pressed={!!md.locked}
                  onClick={() =>
                    hasTauri()
                      ? void setContentLocked(profile!, kind, md.name, !md.locked)
                          .then(() => loadMods())
                          .catch((er) => showToast(apiErrorText(er, t('Не удалось выполнить действие')), 'error'))
                      : showToast(t('Доступно в приложении'))
                  }
                >
                  <Icon id="i-lock" /> {md.locked ? t('Снять замок') : t('Закрепить версию')}
                </button>
              ) : null}
              {md.project_id ? (
                <ModVersionPick profile={profile!} kind={kind} file={md.name} current={md.version_number || ''} onChanged={() => loadMods()} />
              ) : null}
              {modrinth ? (
                <button className="btn sm secondary" onClick={() => openProject(modrinth, kind)}>
                  <Icon id="i-ext" /> {t('Страница мода')}
                </button>
              ) : null}
              {curse ? (
                <button className="btn sm secondary" onClick={() => openUrl('https://www.curseforge.com/projects/' + curse)}>
                  <Icon id="i-ext" /> CurseForge
                </button>
              ) : null}
              {!md.project_id ? (
                <button className="btn sm secondary" disabled={scanLabel !== t('Сканировать')} onClick={runScan}>
                  <Icon id="i-search" /> {scanLabel === t('Сканировать') ? t('Найти в каталогах') : scanLabel}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

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
            <Icon id="i-chev-l" /> {t('К сборкам')}
          </button>
          <div className="inst-hero">
            <div className="inst-icon" id="bsIconBig">
              <BuildIcon icon={pr ? pr.icon : null} name={profile || ''} size={70} />
            </div>
            <div className="inst-titles">
              <h1 id="bsTitle">{profile}</h1>
              <div className="inst-sub" id="bsSub">
                {(pr ? LOADER_NAME(pr) + ' · ' + pr.version : '—') +
                  (counts.mod ? ' · ' + counts.mod + ' ' + plural(counts.mod, t('мод'), t('мода'), t('модов')) : '') +
                  playtime}
              </div>
            </div>
            <div className="inst-actions">
              <button
                className="btn md secondary inst-share"
                onClick={() => {
                  if (!hasTauri()) {
                    showToast(t('Доступно в приложении'))
                    return
                  }
                  if (guarded) {
                    shareCatalogLink(profile!)
                    return
                  }
                  setShareOpen(true)
                }}
              >
                <Icon id="i-link" /> {t('Поделиться')}
              </button>
              {GRAPHICS_PRESETS_PUBLIC ? (
                <button
                  className="btn lg secondary inst-gfx"
                  data-track="build_gfx"
                  onClick={() => {
                    setTab('opts')
                    scrollToGfx()
                  }}
                >
                  <Icon id="i-settings" /> {t('Графика')}
                </button>
              ) : null}
              {thisRunning ? (
                <button
                  className="btn lg stop"
                  id="bsPlay"
                  data-track="stop_game"
                  disabled={gameStopping}
                  onClick={() => stopRunningGame(profile!)}
                >
                  <Icon id="i-power" /> {gameStopping ? t('Останавливаем…') : t('Остановить')}
                </button>
              ) : (
                <button
                  className="btn lg primary"
                  id="bsPlay"
                  onClick={() => {
                    close()
                    if (hasTauri()) realLaunch(profile!)
                    else startPrelaunch(profile!)
                  }}
                >
                  <Icon id="i-play" /> {t('Играть')}
                </button>
              )}
              {/* «⋯» — те же изменения, что на карточке «Мои сборки» (24.09.2026, 18:35). */}
              <span className="inst-more-wrap">
                <button
                  type="button"
                  className={'btn lg secondary inst-more' + (moreOpen ? ' on' : '')}
                  aria-label={t('Управление сборкой')}
                  aria-expanded={moreOpen}
                  data-track="build_menu"
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  <Icon id={moreOpen ? 'i-x' : 'i-dots'} />
                </button>
                {moreOpen && profile ? (
                  <span className="ph-mine-menu inst-menu" role="menu">
                    <BuildMenuItems
                      name={profile}
                      onClose={() => setMoreOpen(false)}
                      onIcon={() => setPickIcon(true)}
                      onRemoved={close}
                      onTab={(t, rename) => {
                        setTab(t)
                        if (rename)
                          requestAnimationFrame(() => {
                            const input = document.getElementById('bsRename') as HTMLInputElement | null
                            input?.focus()
                            input?.select()
                          })
                      }}
                    />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </div>
        <div className="inst-body">
          <nav className="inst-tabs">
            {[
              ['content', 'i-blocks', t('Контент')],
              ['worlds', 'i-server', t('Миры и серверы')],
              ['shots', 'i-image', t('Скриншоты')],
              ['logs', 'i-list', t('Логи')],
              ['files', 'i-folder', t('Файлы')],
              ['opts', 'i-settings', t('Параметры')],
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
                {id === 'shots' && /^\d/.test(shotCount) ? (
                  <span className="nav-count" style={{ marginLeft: 'auto' }}>
                    {parseInt(shotCount)}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="inst-content">
            {modal.open && profile ? <PackUpdateRow profile={profile} onUpdated={() => loadMods()} /> : null}
            <div id="bsTabContent" style={{ display: tab === 'content' ? '' : 'none' }}>
              {dlOpen && pr ? (
                <ModDownloader
                  build={pr}
                  kind={kind}
                  installed={items}
                  onClose={() => setDlOpen(false)}
                  onDone={(demo) => (demo ? setItems((l) => [...demo, ...l.filter((m) => !demo.some((d) => d.name === m.name))]) : loadMods())}
                  onRemove={async (file) => {
                    if (kind === 'mod' && isOwnModFile(file) && !(await askOwnModRemoval())) return
                    if (!hasTauri()) {
                      setItems((l) => l.filter((m) => m.name !== file))
                      showToast(t('Удалено из сборки'), 'ok')
                      return
                    }
                    await deleteContent(profile!, kind, file)
                      .then(() => (loadMods(), showToast(t('Удалено из сборки'), 'ok')))
                      .catch((e) => showToast(apiErrorText(e, t('Не удалось удалить')), 'error'))
                  }}
                />
              ) : null}
              {guarded ? (
                <div className="bx-mini-empty pr-locked" id="bsGuarded">
                  <Icon id="i-lock" />
                  <b>{t('Эту сборку менять нельзя')}</b>
                  <span>{t('Моды в ней ставит сервер — так она всегда совпадает с ним')}</span>
                  <button
                    type="button"
                    className="btn md primary"
                    data-track="guarded_new_build"
                    onClick={() => {
                      close()
                      openModal('nbModal')
                    }}
                  >
                    <Icon id="i-plus" /> {t('Своя сборка с модами')}
                  </button>
                </div>
              ) : (
              <>
              {/* Ряд 1: что редактируем (вкладки со счётчиками) и как добавить — как в Modrinth App. */}
              <div className="bpg-bar">
                <div className="bpg-kinds" role="tablist" aria-label={t('Что в сборке')}>
                  {kinds().map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={kind === k}
                      className={'bpg-kind' + (kind === k ? ' on' : '')}
                      data-bskind={k}
                      onClick={() => {
                        if (k === kind) return
                        setKind(k)
                        setFilter('')
                        setTagFilter('')
                        setContentQuery('')
                        setLibsOpen(false)
                        loadMods(k)
                      }}
                    >
                      <Icon id={KIND_ICON[k]} />
                      {label}
                      {counts[k] ? <span className="bpg-kind-n">{counts[k]}</span> : null}
                    </button>
                  ))}
                </div>
                <span className="bpg-grow" />
                {authorLocked ? null : (
                <>
                <button
                  className="btn md secondary"
                  id="bsDrop"
                  disabled={dropBusy}
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast(t('Доступно в приложении'), 'error')
                      return
                    }
                    pickContentFiles(kindRef.current)
                      .then((paths) => {
                        if (paths && paths.length) void addFiles(paths)
                      })
                      .catch((e) => showToast(t('Не удалось открыть выбор файлов: {error}', { error: tx(e) }), 'error'))
                  }}
                >
                  <Icon id="i-upload" /> {dropBusy ? t('Добавляем…') : t('Из файла')}
                </button>
                <button className="btn md primary" id="bsAddContent" data-track="build_download" onClick={() => setDlOpen(true)}>
                  <Icon id="i-plus" /> {addLabel()[kind] || t('Добавить')}
                </button>
                </>
                )}
              </div>
              {authorLocked ? (
                <div className="bx-note">
                  <Icon id="i-lock" />
                  <span>{t('Автор сборки запретил добавлять моды')}</span>
                  <button
                    type="button"
                    className="btn sm secondary"
                    onClick={() =>
                      void duplicateProfile(profile!)
                        .then(() => {
                          void useProfiles.getState().refresh()
                          showToast(t('Копия готова — в ней можно добавлять моды'), 'ok')
                        })
                        .catch((e) => showToast(apiErrorText(e, t('Не удалось скопировать')), 'error'))
                    }
                  >
                    <Icon id="i-copy" /> {t('Сделать копию')}
                  </button>
                </div>
              ) : null}
              {kind === 'mod' && fabricOnForge.length && !hasConnector ? (
                <div className="bx-note">
                  <Icon id="i-blocks" />
                  <span>{t('Fabric-модов в сборке: {n} — на {loader} они запустятся через Sinytra Connector', { n: fabricOnForge.length, loader: pr ? LOADER_NAME(pr) : '' })}</span>
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() =>
                      installExtras(profile!, 'mod', CONNECTOR_ITEMS, () => {
                        loadMods('mod')
                        runAuditRef.current(false)
                      })
                    }
                  >
                    <Icon id="i-plus" /> {t('Поставить Connector')}
                  </button>
                </div>
              ) : null}
              {kind === 'mod' && embedded.length ? (
                <div className="bx-note warn">
                  <Icon id="i-shield" />
                  <span>{t('В архиве сборки были свои файлы: {n} — их не проверял ни один каталог', { n: embedded.length })}</span>
                  <button type="button" className="btn sm primary" onClick={() => setSafetyOpen(true)}>
                    {t('Проверить')}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Скрыть')}
                    onClick={() => {
                      setEmbedded([])
                      if (hasTauri()) void dismissEmbeddedJars(profile!).catch(() => {})
                    }}
                  >
                    <Icon id="i-x" />
                  </button>
                </div>
              ) : null}

              {/* Проблемы совместимости — только когда они есть, с починкой в один клик. */}
              {kind === 'mod' && audit && audit.issues.length ? (
                <div className="bx-audit bad bpg-problems">
                  <div className="bx-audit-row">
                    <Icon id="i-alert" />
                    <span className="bx-audit-text">
                      {t('Проблем: {n} — сборка может не запуститься', { n: audit.issues.length })}
                    </span>
                    <span style={{ flex: 1 }}></span>
                    {fixItems(audit).length ? (
                      <button
                        className="btn sm primary"
                        onClick={() =>
                          installExtras(profile!, 'mod', fixItems(audit), () => {
                            loadMods('mod')
                            runAuditRef.current(false)
                          })
                        }
                      >
                        {t('Доустановить ({n})', { n: fixItems(audit).length })}
                      </button>
                    ) : null}
                  </div>
                  <div className="bpg-problems-list">
                    {audit.issues.map((it: AuditIssue, i) => (
                      <div className="bpg-problem" key={it.kind + it.title + it.detail + i}>
                        <Icon id={it.kind === 'missing' ? 'i-download' : 'i-alert'} />
                        <span className="bpg-problem-t">
                          <b>{it.title}</b>
                          <span className={'bpg-tag' + (it.kind === 'missing' ? '' : ' bad')}>{auditLabel()[it.kind]}</span>
                          <small>{tx(it.detail)}</small>
                        </span>
                        {issueInstall(it) ? (
                          <button
                            className="btn sm secondary"
                            onClick={() =>
                              installExtras(profile!, 'mod', [issueInstall(it)!], () => {
                                loadMods('mod')
                                runAuditRef.current(false)
                              })
                            }
                          >
                            {t('Поставить')}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {items.length || contentQuery ? (
                <>
                  {/* Ряд 2: поиск во всю ширину. «/» — сразу в поле. */}
                  <label className="input bpg-search">
                    <Icon id="i-search" />
                    <input
                      id="bsSearch"
                      placeholder={t('Искать среди {count}', { count: items.length + ' ' + plural(items.length, kindForms(kind).one || t('файла'), kindForms(kind).few || t('файлов'), kindForms(kind).many || t('файлов')) })}
                      value={contentQuery}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setContentQuery(e.target.value)}
                    />
                    {contentQuery ? (
                      <button type="button" className="bpg-search-x" aria-label={t('Очистить')} onClick={() => setContentQuery('')}>
                        <Icon id="i-x" />
                      </button>
                    ) : (
                      <kbd className="bpg-kbd">/</kbd>
                    )}
                  </label>

                  {/* Ряд 3: сортировка и фильтры слева, проверка и «обновить всё» справа. */}
                  <div className="bpg-tools">
                    <button
                      type="button"
                      className="bpg-sort"
                      data-track="content_sort"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setSortMenu({ x: r.left, y: r.bottom + 4 })
                      }}
                    >
                      <Icon id="i-list" />
                      {sortLabel()[sort]}
                      <Icon id="i-chev-d" />
                    </button>
                    <span className="bpg-vsep" />
                    <div className="bpg-chips" role="group" aria-label={t('Фильтр')}>
                      <button type="button" className={'bpg-chip' + (!filter ? ' on' : '')} onClick={() => setFilter('')}>
                        {t('Все')} <span>{items.length}</span>
                      </button>
                      {updCount ? (
                        <button type="button" className={'bpg-chip is-upd' + (filter === 'updates' ? ' on' : '')} onClick={() => setFilter(filter === 'updates' ? '' : 'updates')}>
                          {t('Есть обновления')} <span>{updCount}</span>
                        </button>
                      ) : null}
                      {offCount ? (
                        <button type="button" className={'bpg-chip' + (filter === 'off' ? ' on' : '')} onClick={() => setFilter(filter === 'off' ? '' : 'off')}>
                          {t('Выключенные')} <span>{offCount}</span>
                        </button>
                      ) : null}
                      {manualCount && manualCount < items.length ? (
                        <button type="button" className={'bpg-chip' + (tagFilter === MANUAL_FILTER ? ' on' : '')} onClick={() => setTagFilter(tagFilter === MANUAL_FILTER ? '' : MANUAL_FILTER)}>
                          {t('Добавлены вручную')} <span>{manualCount}</span>
                        </button>
                      ) : null}
                      {knownTags.map((tag) => (
                        <button key={tag} type="button" className={'bpg-chip' + (tagFilter === tag ? ' on' : '')} onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}>
                          {'#' + tag} <span>{items.filter((i) => (i.tags || []).includes(tag)).length}</span>
                        </button>
                      ))}
                    </div>
                    <span className="bpg-grow" />
                    {kind === 'mod' ? (
                      <button
                        type="button"
                        className={'bpg-status' + (auditBusy ? ' busy' : audit && audit.issues.length ? ' bad' : audit ? ' ok' : '')}
                        disabled={auditBusy}
                        data-tip={t('Проверить совместимость ещё раз')}
                        onClick={() => {
                          if (!hasTauri()) {
                            showToast(t('Доступно в приложении'))
                            return
                          }
                          autoRound.current = 0
                          runAudit(false, true)
                        }}
                      >
                        {auditBusy ? <span className="mr-spin" aria-hidden="true" /> : <Icon id={audit && audit.issues.length ? 'i-alert' : 'i-shield'} />}
                        {auditBusy ? t('Проверяем…') : !audit ? t('Проверить совместимость') : audit.issues.length ? t('Проблем: {n}', { n: audit.issues.length }) : t('Всё совместимо')}
                      </button>
                    ) : null}
                    {updCount ? (
                      <button
                        type="button"
                        className="btn sm primary bpg-updall"
                        id="bsUpdateAll"
                        onClick={() => {
                          if (!hasTauri()) return
                          setUpdAsk(true)
                        }}
                      >
                        <Icon id="i-arrow-up" /> {updateAllLabel === t('Обновить всё') ? t('Обновить всё · {n}', { n: updCount }) : updateAllLabel}
                      </button>
                    ) : null}
                    {updAsk ? (
                      <UpdateAllModal
                        updates={updList.filter((u) => items.some((i) => i.name === u.file_name))}
                        titleOf={(file) => {
                          const it = items.find((i) => i.name === file)
                          return it ? titleOf(it) : prettyFile(file)
                        }}
                        onClose={() => setUpdAsk(false)}
                        onConfirm={() => {
                          setUpdAsk(false)
                          setUpdateAllLabel(t('Обновляем…'))
                          updateAll(profile!, kind)
                            .then((n) => {
                              setUpdateAllLabel(t('Обновить всё'))
                              loadMods()
                              showToast(n ? t('Обновлено: {n}', { n }) : t('Всё актуально'))
                            })
                            .catch((e) => {
                              setUpdateAllLabel(t('Обновить всё'))
                              showToast('' + e)
                            })
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="btn sm ghost bpg-more"
                      id="bsMore"
                      aria-label={t('Ещё')}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setMoreMenu({ x: r.right - 220, y: r.bottom + 4 })
                      }}
                    >
                      <Icon id="i-dots" />
                    </button>
                  </div>
                </>
              ) : null}
              {sortMenu ? (
                <ContextMenu
                  x={sortMenu.x}
                  y={sortMenu.y}
                  onClose={() => setSortMenu(null)}
                  items={(['name', 'new', 'old'] as const).map((id) => ({
                    id,
                    label: (sort === id ? '✓ ' : '') + sortLabel()[id],
                    icon: id === 'name' ? 'i-list' : 'i-clock',
                    onPick: () => pickSort(id),
                  }))}
                />
              ) : null}
              {packSafetyOpen && profile ? <SafetyModal profile={profile} scope="packs" onClose={() => setPackSafetyOpen(false)} onChanged={() => loadMods()} /> : null}
              {fileSafetyOpen ? <SafetyModal profile="" scope="files" onClose={() => setFileSafetyOpen(false)} onChanged={() => {}} /> : null}
              {exportOpen && profile ? <ExportModal profile={profile} ramGb={ram} onClose={() => setExportOpen(false)} /> : null}
              {moreMenu ? (
                <ContextMenu
                  x={moreMenu.x}
                  y={moreMenu.y}
                  onClose={() => setMoreMenu(null)}
                  items={
                    [
                      items.length && scanLabel === t('Сканировать') ? { id: 'scan', label: t('Опознать файлы'), icon: 'i-search', onPick: runScan } : null,
                      kind === 'mod' && items.length ? { id: 'safety', label: t('Проверить безопасность'), icon: 'i-shield', onPick: () => setSafetyOpen(true) } : null,
                      kind !== 'mod' ? { id: 'safety-packs', label: t('Проверить паки и карты'), icon: 'i-shield', onPick: () => setPackSafetyOpen(true) } : null,
                      kind === 'mod' && hasTauri() ? { id: 'safety-files', label: t('Проверить любой файл на вирусы'), icon: 'i-shield', onPick: () => setFileSafetyOpen(true) } : null,
                      { id: 'export', label: t('Экспорт в .mrpack'), icon: 'i-download', onPick: runExport },
                      { id: 'export-other', label: t('Экспорт для других лаунчеров'), icon: 'i-download', onPick: () => setExportOpen(true) },
                      { id: 'template', label: t('Сохранить как шаблон'), icon: 'i-copy', onPick: saveTemplate },
                      { id: 'folder', label: t('Открыть папку сборки'), icon: 'i-folder', onPick: () => (hasTauri() ? void openProfileFolder(profile!) : showToast(t('Доступно в приложении'))) },
                    ].filter(Boolean) as ContextItem[]
                  }
                />
              ) : null}

              {thisRunning && items.length ? <p className="faint-note bx-running">{t('Игра запущена — изменения вступят после перезапуска')}</p> : null}
              <div className="bpg-list mod-list-wrap" id="bsMods">
                {dropActive ? (
                  <div className="mod-drop">
                    <Icon id="i-upload" />
                    <b>{t('Отпусти — добавим в сборку')}</b>
                    <span>{extsOf(kind).map((e) => '.' + e).join(' / ')}</span>
                  </div>
                ) : null}
                {noticeList ? (
                  <p className="faint-note">{noticeList}</p>
                ) : emptyList || !items.length ? (
                  <div className="bpg-empty">
                    <span className="bpg-empty-ic">
                      <Icon id={KIND_ICON[kind]} />
                    </span>
                    <b>{emptyTitle()[kind] || t('Пока пусто')}</b>
                    {authorLocked ? null : (
                      <>
                        <span>{t('Найди в каталоге — всё нужное для работы поставится само. Или перетащи {exts} сюда.', { exts: extsOf(kind).map((e) => '.' + e).join(' / ') })}</span>
                        <button className="btn md primary" onClick={() => setDlOpen(true)}>
                          <Icon id="i-plus" /> {addLabel()[kind] || t('Добавить')}
                        </button>
                      </>
                    )}
                  </div>
                ) : !shownItems.length ? (
                  <div className="bpg-none">
                    <span>{contentQuery.trim() ? t('Ничего по «{query}»', { query: contentQuery.trim() }) : t('Здесь пусто')}</span>
                    <button
                      type="button"
                      className="btn sm secondary"
                      onClick={() => {
                        setContentQuery('')
                        setFilter('')
                      }}
                    >
                      {t('Показать всё')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="bpg-head">
                      <span
                        className={'chk bpg-chk' + (allSel ? ' on' : sel.size ? ' part' : '')}
                        role="checkbox"
                        aria-checked={allSel}
                        aria-label={t('Выбрать все')}
                        onClick={() => setSel(allSel ? new Set() : new Set(shownItems.map((x) => x.name)))}
                      />
                      <span className="bpg-head-t">
                        {grouped ? mains.length + ' ' + plural(mains.length, kindForms(kind).one || t('файл'), kindForms(kind).few || t('файла'), kindForms(kind).many || t('файлов')) + (libs.length ? ' · ' + libs.length + ' ' + plural(libs.length, t('библиотека'), t('библиотеки'), t('библиотек')) : '') : shownItems.length + ' ' + plural(shownItems.length, kindForms(kind).one || t('файл'), kindForms(kind).few || t('файла'), kindForms(kind).many || t('файлов'))}
                      </span>
                      <span className="bpg-head-ver">{t('Версия')}</span>
                      <span className="bpg-head-acts">{t('Вкл')}</span>
                    </div>
                    {mains.map(row)}
                    {libs.length ? (
                      <div className={'bpg-libs' + (libsOpen ? ' open' : '')}>
                        <button type="button" className="bpg-libs-head" aria-expanded={libsOpen} onClick={() => setLibsOpen((v) => !v)}>
                          <span className="bpg-libs-arts" aria-hidden="true">
                            {libs.slice(0, 4).map((l) => (
                              <ModArt key={l.name} src={l.icon_url} icon={KIND_ICON[kind]!} sm />
                            ))}
                          </span>
                          <span className="bpg-libs-t">
                            <b>
                              {t('Библиотеки · {n}', { n: libs.length })}
                              {libs.some((l) => upd[l.name]) ? <span className="bpg-tag upd">{t('есть обновления')}</span> : null}
                            </b>
                            <small>{t('Нужны другим модам — лаунчер ставит их сам, трогать не обязательно')}</small>
                          </span>
                          <Icon id="i-chev-d" />
                        </button>
                        {libsOpen ? libs.map(row) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Выбрали несколько — действия прилипают снизу, а не висят серыми всё время. */}
              {sel.size ? (
                <div className="bpg-selbar" role="toolbar" aria-label={t('Действия с выбранным')}>
                  <b>{t('Выбрано: {n}', { n: sel.size })}</b>
                  <span className="bpg-grow" />
                  <button className="btn sm secondary" data-bulk="enable" onClick={() => void bulk([...sel], (n) => toggleContent(profile!, kind, n, true))}>
                    <Icon id="i-check" /> {t('Включить')}
                  </button>
                  <button className="btn sm secondary" data-bulk="disable" onClick={() => void bulk([...sel], (n) => toggleContent(profile!, kind, n, false))}>
                    <Icon id="i-ban" /> {t('Выключить')}
                  </button>
                  {[...sel].some((n) => upd[n]) ? (
                    <button
                      className="btn sm primary"
                      data-bulk="update"
                      onClick={() => void bulk([...sel].filter((n) => upd[n]), (n) => updateContent(profile!, kind, n), () => showToast(t('Обновлено')))}
                    >
                      <Icon id="i-arrow-up" /> {t('Обновить · {n}', { n: [...sel].filter((n) => upd[n]).length })}
                    </button>
                  ) : null}
                  <button
                    className="btn sm danger"
                    data-bulk="delete"
                    onClick={async () => {
                      const names = [...sel]
                      if (!(await uiConfirm(t('Удалить из сборки: {n}?', { n: names.length }), { confirmLabel: t('Удалить') }))) return
                      const go = kind === 'mod' ? await keepAfterOwnModConfirm(names, askOwnModRemoval) : names
                      void bulk(go, (n) => deleteContent(profile!, kind, n))
                    }}
                  >
                    <Icon id="i-trash" /> {t('Удалить')}
                  </button>
                  <button className="btn sm ghost" aria-label={t('Снять выбор')} data-tip="Esc" onClick={() => setSel(new Set())}>
                    <Icon id="i-x" />
                  </button>
                </div>
              ) : null}
              </>
              )}
            </div>

            <div id="bsTabWorlds" style={{ display: tab === 'worlds' ? '' : 'none' }}>
              {/* Миры и серверы (владелец 10.10.2026: «как тут человек поймёт? слишком много кнопок»):
                  сверху фильтр и одна кнопка «Добавить», ниже — два понятных раздела. Пусто —
                  объясняем, откуда берутся миры, и даём два действия; форма сервера — только по кнопке. */}
              <div className="bpg-bar">
                <div className="bpg-kinds" role="tablist" aria-label={t('Что показать')}>
                  {(
                    [
                      ['all', t('Всё'), 'i-blocks'],
                      ['single', t('Миры'), 'i-map'],
                      ['server', t('Серверы'), 'i-server'],
                    ] as const
                  ).map(([k, label, ic]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={wFilter === k}
                      className={'bpg-kind' + (wFilter === k ? ' on' : '')}
                      data-wfilter={k}
                      onClick={() => {
                        setWFilter(k)
                        loadWorlds()
                      }}
                    >
                      <Icon id={ic} />
                      {label}
                      {k === 'single' && worldCount ? <span className="bpg-kind-n">{worldCount}</span> : null}
                      {k === 'server' && servers.length ? <span className="bpg-kind-n">{servers.length}</span> : null}
                    </button>
                  ))}
                </div>
                <span className="bpg-grow" />
                <button
                  type="button"
                  className="btn md primary"
                  id="bsAddWorldMenu"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setAddMenu({ x: r.right - 240, y: r.bottom + 4 })
                  }}
                >
                  <Icon id="i-plus" /> {t('Добавить')}
                </button>
                {addMenu ? (
                  <ContextMenu
                    x={addMenu.x}
                    y={addMenu.y}
                    onClose={() => setAddMenu(null)}
                    items={[
                      { id: 'maps', label: t('Карту из каталога'), icon: 'i-map', onPick: openMapsCatalog },
                      { id: 'archive', label: t('Мир из архива (.zip)'), icon: 'i-upload', onPick: importWorldArchive },
                      {
                        id: 'server',
                        label: t('Сервер по адресу'),
                        icon: 'i-server',
                        onPick: () => {
                          setServerForm(true)
                          requestAnimationFrame(() => document.getElementById('wsIp')?.focus())
                        },
                      },
                    ]}
                  />
                ) : null}
              </div>

              {wFilter !== 'server' ? (
                <section className="bpg-sec">
                  {wFilter === 'all' ? <h3 className="bpg-sec-h">{t('Миры')}{worldCount ? <span>{worldCount}</span> : null}</h3> : null}
                  <WorldManager
                    profile={profile!}
                    reloadKey={worldsReload}
                    onDatapackCatalog={openDatapackCatalog}
                    hideImport
                    onCount={setWorldCount}
                    empty={
                      <div className="bpg-empty sm">
                        <span className="bpg-empty-ic">
                          <Icon id="i-map" />
                        </span>
                        <b>{t('Миров пока нет')}</b>
                        <span>{t('Мир появится здесь, когда создашь его в игре. Или поставь готовую карту — паркур, хоррор, выживание на острове.')}</span>
                        <div className="bpg-empty-acts">
                          <button className="btn md primary" onClick={openMapsCatalog}>
                            <Icon id="i-map" /> {t('Карты из каталога')}
                          </button>
                          <button className="btn md secondary" onClick={importWorldArchive}>
                            <Icon id="i-upload" /> {t('Мир из архива')}
                          </button>
                        </div>
                      </div>
                    }
                    onPlay={(folder, name) => {
                      close()
                      showToast(t('Заходим в мир «{name}»…', { name }))
                      joinWithAuth(profile!, folder, null).catch((e) => showLaunchError(e))
                    }}
                  />
                </section>
              ) : null}

              {wFilter !== 'single' ? (
                <section className="bpg-sec">
                  {wFilter === 'all' ? <h3 className="bpg-sec-h">{t('Серверы')}{servers.length ? <span>{servers.length}</span> : null}</h3> : null}
                  {worldsNotice ? (
                    <p className="faint-note">{worldsNotice}</p>
                  ) : servers.length ? (
                    <div id="bsWorlds" className="bpg-srv-list">
                      {servers.map((s2) => {
                        const pg = pings[s2.ip]
                        const online = pg && pg.online >= 0 && (pg.max > 0 || pg.online > 0 || pg.version)
                        return (
                          <div className="mod-line srv-line bpg-srv" key={'s' + s2.ip}>
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
                                    {t('{online}/{max} онлайн', { online: pg!.online, max: pg!.max })}{pg!.version ? ' · ' + pg!.version : ''}
                                    {pg!.motd ? ' · ' + pg!.motd.slice(0, 40) : ''}
                                  </>
                                ) : pg === undefined ? (
                                  t('проверяем…')
                                ) : (
                                  t('{address} · не отвечает', { address: s2.ip })
                                )}
                              </span>
                            </span>
                            <button
                              className="btn sm primary w-join"
                              data-ip={s2.ip}
                              onClick={() => {
                                close()
                                showToast(t('Подключаемся к {address}…', { address: s2.ip }))
                                joinWithAuth(profile!, null, s2.ip, s2.name).catch((e) => showLaunchError(e))
                              }}
                            >
                              <Icon id="i-play" /> {t('Играть')}
                            </button>
                            <button
                              className="icon-btn del w-del"
                              aria-label={t('Убрать сервер')}
                              data-ip={s2.ip}
                              onClick={() => removeServer(profile!, s2.ip).then(() => loadWorlds())}
                            >
                              <Icon id="i-trash" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : !serverForm ? (
                    <div className="bpg-none left">
                      <span>{t('Серверов в этой сборке нет — добавь адрес, и он появится в списке серверов в игре.')}</span>
                      <button type="button" className="btn sm secondary" onClick={() => setServerForm(true)}>
                        <Icon id="i-plus" /> {t('Добавить сервер')}
                      </button>
                    </div>
                  ) : null}
                  {serverForm ? (
                    <form
                      className="bpg-srv-form"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const ip = wsIp.trim()
                        if (!ip) return
                        if (!hasTauri()) {
                          showToast(t('Доступно в приложении'))
                          return
                        }
                        addServer(profile!, wsName.trim() || ip, ip).then(() => {
                          setWsName('')
                          setWsIp('')
                          setServerForm(false)
                          loadWorlds()
                          showToast(t('Сервер добавлен'))
                        })
                      }}
                    >
                      <div className="input sm">
                        <input id="wsIp" placeholder={t('Адрес сервера, например mc.example.net')} value={wsIp} onChange={(e) => setWsIp(e.target.value)} />
                      </div>
                      <div className="input sm bpg-srv-name">
                        <input id="wsName" placeholder={t('Название (не обязательно)')} value={wsName} onChange={(e) => setWsName(e.target.value)} />
                      </div>
                      <button type="submit" className="btn sm primary" id="wsAdd" disabled={!wsIp.trim()}>
                        {t('Добавить')}
                      </button>
                      <button type="button" className="btn sm ghost" onClick={() => setServerForm(false)}>
                        {t('Отмена')}
                      </button>
                    </form>
                  ) : null}
                </section>
              ) : null}
            </div>

            {tab === 'shots' ? (
              <div id="bsTabShots">
                <ScreenshotGallery profile={profile!} />
              </div>
            ) : null}

            {tab === 'files' && profile ? <FilesTab profile={profile} active /> : null}
            <div id="bsTabLogs" style={{ display: tab === 'logs' ? '' : 'none' }}>
              <div className="segs" style={{ marginBottom: '10px', width: 'auto' }}>
                <button
                  className={'seg' + (logView === 'live' ? ' on' : '')}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => setLogView('live')}
                >
                  <Icon id="i-list" /> {t('Консоль')}
                  {liveLines.length ? <span className="log-live-dot"></span> : null}
                </button>
                <button
                  className={'seg' + (logView === 'files' ? ' on' : '')}
                  style={{ height: '32px', fontSize: '12.5px' }}
                  onClick={() => setLogView('files')}
                >
                  <Icon id="i-book" /> {t('Файлы')}
                </button>
              </div>

              {logView === 'live' ? (
                <>
                  <pre ref={liveRef} className="host-console" style={{ height: '300px', margin: 0 }}>
                    {liveLines.length ? (
                      liveLines.map((l, i) => <div key={i}>{l}</div>)
                    ) : (
                      <div className="faint-note">{t('Запусти игру — вывод появится здесь')}</div>
                    )}
                  </pre>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button className="btn sm secondary" style={{ flex: 1 }} onClick={() => {
                      liveBuffer.current = []
                      setLiveLines([])
                    }}>
                      <Icon id="i-trash" /> {t('Очистить')}
                    </button>
                    <button
                      className="btn sm secondary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        void copyText(liveLines.join('\n')).then((ok) =>
                          showToast(ok ? t('Консоль скопирована') : t('Не удалось скопировать консоль')),
                        )
                      }}
                    >
                      <Icon id="i-copy" /> {t('Скопировать')}
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
                    showToast(t('Лог скопирован'))
                  }}
                >
                  <Icon id="i-copy" /> {t('Скопировать')}
                </button>
                <button
                  className="btn sm secondary"
                  id="bsLogShare"
                  style={{ flex: 1 }}
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast(t('Доступно в приложении'))
                      return
                    }
                    const name = logFiles.length ? logFile : ''
                    if (!name) {
                      showToast(t('Нет лога для отправки'))
                      return
                    }
                    setShareLabel(t('Загружаем…'))
                    shareLog(profile!, name)
                      .then((url) => {
                        setShareLabel(t('Поделиться'))
                        void copyText(url)
                        showToast(t('Ссылка на лог скопирована: {url}', { url }))
                        openUrl(url)
                      })
                      .catch((e) => {
                        setShareLabel(t('Поделиться'))
                        showToast('' + e)
                      })
                  }}
                >
                  <Icon id="i-link" /> {shareLabel}
                </button>
              </div>
              </div>
            </div>

            <div id="bsTabOpts" style={{ display: tab === 'opts' ? '' : 'none' }}>
              <div className="bx-opts-cap">{t('Сборка')}</div>
              <div className="set-row">
                <span className="lab">
                  {t('Название')}
                </span>
                <div className="input sm" style={{ width: '220px' }}>
                  <input
                    id="bsRename"
                    maxLength={BUILD_NAME_MAX}
                    value={renameVal}
                    placeholder={t('Название')}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doRename()
                    }}
                  />
                </div>
                {/* Кнопка — только когда имя правда меняют: серой «Переименовать» на виду не стоит. */}
                {renameVal.trim() && renameVal.trim() !== profile ? (
                  <button className="btn sm primary" disabled={renameBusy} onClick={doRename}>
                    {renameBusy ? t('Сохраняем…') : t('Сохранить')}
                  </button>
                ) : null}
              </div>
              <div className="set-row" style={{ alignItems: coreEdit ? 'flex-start' : 'center' }}>
                <span className="lab">
                  {t('Версия и загрузчик')}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '300px', alignItems: 'flex-end' }}>
                  {/* Сводкой: «Forge 47.4.10 · Minecraft 1.20.1». Три выпадающих списка — только по «Изменить». */}
                  {!coreEdit ? (
                    <div className="bpg-core">
                      <span className="bpg-core-v">
                        <b>{pr ? LOADER_NAME(pr) : '—'}</b>
                        {pr && pr.loader_version ? <small>{pr.loader_version}</small> : null}
                        <span className="bpg-core-dot">·</span>
                        <b>Minecraft {pr ? pr.version : ''}</b>
                      </span>
                      <button type="button" className="btn sm secondary" onClick={() => setCoreEdit(true)}>
                        {t('Изменить')}
                      </button>
                    </div>
                  ) : (
                  <>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Select
                      width={148}
                      value={newLoader}
                      options={coreOpts().map(([v, label]) => ({ value: v, label }))}
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
                      placeholder={lb.loading ? t('Загружаем версии загрузчика…') : t('Рекомендуемая')}
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
                    {coreBusy ? t('Меняем…') : t('Сменить')}
                  </button>
                  <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setCoreEdit(false)}>
                    {t('Отмена')}
                  </button>
                  </>
                  )}
                  {pr && (coreUpd.mc || coreUpd.loader) ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {coreUpd.mc ? (
                        <button
                          className="btn sm secondary"
                          disabled={coreBusy || thisRunning}
                          onClick={() => coreUpd.mc && void applyGameUpdate(coreUpd.mc)}
                        >
                          {t('Обновить Minecraft до {version}', { version: coreUpd.mc })}
                        </button>
                      ) : null}
                      {coreUpd.loader ? (
                        <button
                          className="btn sm secondary"
                          disabled={coreBusy || thisRunning}
                          onClick={() => coreUpd.loader && void applyLoaderUpdate(coreUpd.loader)}
                        >
                          {t('Обновить {loader} до {version}', { loader: LOADER_NAME(pr), version: coreUpd.loader })}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {profile && pr ? <HorizonBuildRow profile={profile} version={pr.version} loader={loaderId(pr)} /> : null}
              <div className="set-row" style={{ alignItems: 'center' }}>
                <span className="lab">
                  {t('Иконка')}
                </span>
                <div className="bpg-iconset">
                  {/* Иконка — набором Modrinth App (10.10.2026: «тут старое, надо новые»): окно выбора,
                      «Случайная» и своя картинка. Старые блоки и «Собрать» убраны. */}
                  <button type="button" className="bi-edit" aria-label={t('Сменить иконку')} data-sound="open" onClick={() => setPickIcon(true)}>
                    <BuildIcon icon={pr ? pr.icon : null} name={profile || ''} size={72} />
                    <span className="bi-edit-lab" aria-hidden="true">
                      <Icon id="i-edit" />
                      {t('Сменить')}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Одна кнопка «Сменить» (там и набор Modrinth, и своя картинка) и «Случайная». */}
                    <button className="btn sm secondary" id="bsIconPick" data-sound="open" onClick={() => setPickIcon(true)}>
                      {t('Сменить')}
                    </button>
                    <button
                      className="btn sm secondary"
                      id="bsIconRandom"
                      data-track="icon_random"
                      onClick={() => {
                        if (!profile) return
                        const next = randomIcon()
                        if (!hasTauri()) {
                          useProfiles.setState((st) => ({ profiles: st.profiles.map((x) => (x.name === profile ? { ...x, icon: next } : x)) }))
                          return
                        }
                        setProfileIcon(profile, next)
                          .then((list) => {
                            if (Array.isArray(list)) useProfiles.setState({ profiles: list })
                            else void useProfiles.getState().refresh()
                          })
                          .catch((e) => showToast(t('Иконка не сохранилась: {error}', { error: tx(e) }), 'error'))
                      }}
                    >
                      <span aria-hidden="true">🎲</span> {t('Случайная')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="set-row">
                <span className="lab">
                  {t('Группа')}
                </span>
                <div className="input sm" style={{ width: '180px' }}>
                  <input
                    id="bsGroup"
                    placeholder={t('Технические')}
                    maxLength={GROUP_NAME_MAX}
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    onBlur={() => {
                      if (!hasTauri() || !profile) return
                      const g = normalizeGroup(group)
                      setProfileGroup(profile, g).then(() => {
                        void useProfiles.getState().refresh()
                        showToast(g ? t('Группа: {name}', { name: g }) : t('Убрано из группы'))
                      })
                    }}
                  />
                </div>
              </div>
              <div className="set-row" style={{ alignItems: 'flex-start' }}>
                <span className="lab">
                  {t('Заметка')}
                </span>
                <div className="input sm" style={{ width: '300px' }}>
                  <input
                    id="bsNote"
                    placeholder={t('Для игры с друзьями')}
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
              <div className="set-row" id="bsModpackRow" style={{ display: mpSlug ? '' : 'none' }}>
                <span className="lab">
                  {t('Версия модпака')}
                </span>
                <button
                  className="btn sm secondary"
                  id="bsModpackUpd"
                  onClick={() => useModpackVersions.getState().open(profile!, mpSlug, mpVersion)}
                >
                  {t('Версии')}
                </button>
              </div>
              {profile ? <PackAutoUpdateRow profile={profile} /> : null}
              {profile ? <PackwizRow profile={profile} running={thisRunning} onUpdated={() => loadMods()} /> : null}
              <div className="bx-opts-cap">{t('Игра')}</div>
              {profile ? <LinuxToolsRows profile={profile} /> : null}
              <div className="set-row">
                <span className="lab">
                  {t('Память')}
                  {ramMax < RAM_MAX_GB ? <small>{t('Максимум {n} ГБ — остальное нужно системе', { n: ramMax })}</small> : null}
                </span>
                <span className="set-val" id="bsRamVal">
                  {ram > 0 ? t('{n} ГБ', { n: ram }) : authorRamGb > 0 ? t('{n} ГБ · от автора', { n: authorRamGb }) : t('Авто')}
                </span>
                <Slider
                  width={200}
                  min={0}
                  max={ramMax}
                  value={ram}
                  onChange={(v) => {
                    setRam(v)
                    if (!profile) return
                    void setBuildRamMb(profile, v * 1024).then((ok) => {
                      if (!ok) showToast(t('Не удалось сохранить память для сборки'), 'error')
                    })
                  }}
                />
                <span className="set-range">{t('{n} ГБ', { n: ramMax })}</span>
              </div>
              <TunePanel profile={profile!} manualGb={ram} />
              <div className="set-row">
                <span className="lab">
                  {t('Видеокарта')}
                  {!gpuOk ? <small>{t('Здесь карту выбирает система')}</small> : null}
                </span>
                <Select
                  width={230}
                  value={gpu}
                  disabled={!gpuOk}
                  options={[
                    { value: 'auto', label: t('Авто'), sub: t('Как решит система') },
                    { value: 'discrete', label: t('Дискретная'), sub: t('NVIDIA или AMD — больше FPS') },
                    { value: 'integrated', label: t('Встроенная'), sub: t('Тише и дольше от батареи') },
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
                            ? t('Запускаем на дискретной карте')
                            : saved === 'integrated'
                              ? t('Запускаем на встроенной карте')
                              : t('Карту выбирает система'),
                        )
                      })
                      .catch((e) => {
                        setGpu(prev)
                        showToast(t('Не удалось сохранить выбор карты: {error}', { error: tx(e) }), 'error')
                      })
                  }}
                />
              </div>
              {GRAPHICS_PRESETS_PUBLIC && profile && pr ? (
                <BuildGfxPresets
                  profile={profile}
                  loader={loaderId(pr)}
                  version={pr.version}
                  onChange={() => {
                    loadMods()
                    setGfxRev((n) => n + 1)
                    void fpsBoostState(profile).then(setBoost).catch(noted('instance-boost'))
                  }}
                />
              ) : null}
              {boost && boost.applicable === false && !boost.enabled ? null : (
              <div className="set-row">
                <span className="lab">
                  {t('Буст FPS')}
                  <small>
                    {boost && boost.enabled && boost.skipped.length
                      ? t('Нет под эту версию: {list}', { list: boost.skipped.join(', ') })
                      : boost && boost.vanilla
                        ? t('Java и графика; моды — на Fabric/Forge')
                        : t('Sodium, настройки Java и лёгкая графика')}
                  </small>
                </span>
                <span
                  className={'tgl' + (boost && boost.enabled ? ' on' : '') + (boostBusy ? ' busy' : '')}
                  data-fpsboost={boost && boost.enabled ? 'on' : 'off'}
                  role="switch"
                  aria-checked={!!(boost && boost.enabled)}
                  aria-label={t('Буст FPS')}
                  onClick={() => {
                    if (!boostBusy) void toggleBoost()
                  }}
                ></span>
              </div>
              )}
              {boost && boost.vulkanAvailable && boost.applicable !== false ? (
                <div className="set-row">
                  <span className="lab">
                    {t('VulkanMod вместо Sodium')}
                    <small>
                      {boost.vulkanBlocked
                        ? t('Не работает вместе с шейдерами')
                        : t('Рендер на Vulkan: на многих видеокартах быстрее, часть модов с ним несовместима')}
                    </small>
                  </span>
                  <span
                    className={'tgl' + (boost.vulkan ? ' on' : '') + (boostBusy || boost.vulkanBlocked ? ' busy' : '')}
                    role="switch"
                    aria-checked={!!boost.vulkan}
                    aria-disabled={!!boost.vulkanBlocked}
                    aria-label={t('VulkanMod вместо Sodium')}
                    onClick={() => {
                      if (!boostBusy && (!boost.vulkanBlocked || boost.vulkan)) void toggleVulkan()
                    }}
                  ></span>
                </div>
              ) : null}
              {profile ? <ShadersRow key={'shaders-' + gfxRev} profile={profile} onChange={() => loadMods()} /> : null}
              {pr && loaderId(pr) !== 'vanilla' ? (
                <div className="set-row">
                  <span className="lab">
                    {t('Скин Millida в игре')}
                    <small>
                      {skinMod?.conflict
                        ? t('Уже есть свой мод скинов: {name}', { name: skinMod.conflict })
                        : skinOff?.kind === 'quarantine'
                          ? skinOff.version
                            ? t('Отключён после вылета (версия {version})', { version: skinOff.version })
                            : t('Отключён после вылета')
                          : skinOff?.kind === 'removed'
                            ? t('Удалён вручную')
                            : skinOff?.kind === 'off'
                              ? t('Выключен вами')
                              : skinMod?.on
                                ? t('Твой скин видно на серверах')
                                : t('Включи, если скин не виден в игре')}
                    </small>
                  </span>
                  {skinOff?.kind === 'quarantine' || skinOff?.kind === 'removed' ? (
                    <button
                      className="btn sm secondary"
                      data-skinmod-restore={skinOff.kind}
                      disabled={skinModBusy}
                      onClick={() => void (skinOff.kind === 'quarantine' ? liftQuarantine() : toggleSkinMod())}
                    >
                      {t('Вернуть мод')}
                    </button>
                  ) : null}
                  <span
                    className={'tgl' + (skinMod?.on ? ' on' : '') + (skinModBusy || !skinMod ? ' busy' : '')}
                    data-skinmod={skinMod?.on ? 'on' : 'off'}
                    role="switch"
                    aria-checked={!!skinMod?.on}
                    aria-label={t('Скин Millida в игре')}
                    onClick={() => {
                      if (!skinModBusy && skinMod) void toggleSkinMod()
                    }}
                  ></span>
                </div>
              ) : null}
              {profile ? <CommonShareRows profile={profile} /> : null}
              <div className="bx-opts-cap">{t('Файлы')}</div>
              {profile ? <ShortcutRow profile={profile} /> : null}
              <div className="set-row">
                <span className="lab">
                  {t('Починить сборку')}
                </span>
                <button
                  className="btn sm secondary"
                  id="bsRepair"
                  disabled={repairBusy}
                  onClick={() => {
                    setRepairBusy(true)
                    const name = profile!
                    repairPack(name)
                      .then((r) => {
                        // Причину вылета ядро не опознало — Милли смотрит лог и сборку целиком.
                        if (!r?.unresolved || !hasMillidaAccount()) return
                        const crash = r.unresolved
                        void import('../lib/milliDoctor').then((d) => {
                          d.startMilliDoctor()
                          const { text, action } = d.crashAction({ profile: name, reason: crash.reason, tail: '', culprits: crash.culprits, actions: crash.actions, kind: crash.kind })
                          openMilli({ src: 'repair' })
                          void d.pushMilliAction(text, action, [t('Почему так?'), t('Осмотри сборку')])
                        })
                      })
                      .finally(() => setRepairBusy(false))
                  }}
                >
                  <Icon id="i-restart" /> {repairBusy ? t('Чиним…') : t('Починить')}
                </button>
              </div>
              {guarded ? null : (
              <div className="set-row">
                <span className="lab">{t('Папка сборки')}</span>
                <button
                  className="btn sm secondary"
                  id="bsFolder"
                  onClick={() => {
                    if (hasTauri()) openProfileFolder(profile!)
                    else showToast(t('Папка (демо)'))
                  }}
                >
                  <Icon id="i-folder" /> {t('Открыть')}
                </button>
              </div>
              )}
              <div className="set-row">
                <span className="lab">
                  {t('Копия сборки')}
                </span>
                <button
                  className="btn sm secondary"
                  id="bsDup"
                  onClick={() => {
                    if (!hasTauri()) {
                      showToast(t('Доступно в приложении'))
                      return
                    }
                    duplicateProfile(profile!)
                      .then(() => {
                        close()
                        void useProfiles.getState().refresh()
                        showToast(t('Сборка продублирована'))
                      })
                      .catch((e) => showToast(t('Не удалось продублировать: {error}', { error: tx(e) }), 'error'))
                  }}
                >
                  <Icon id="i-copy" /> {t('Дублировать')}
                </button>
              </div>
              <div className="set-row">
                <span className="lab">
                  {t('Копия под другую версию')}
                </span>
                <button
                  className="btn sm secondary"
                  id="bsMigrate"
                  onClick={() => {
                    if (!profile || !pr) return
                    useMigrate.getState().open(profile, pr.version, loaderId(pr))
                  }}
                >
                  <Icon id="i-arrow-r" /> {t('Перенести')}
                </button>
              </div>
              <button
                className={'bx-opts-cap bx-opts-toggle' + (advanced ? ' on' : '')}
                aria-expanded={advanced}
                onClick={() => setAdvanced((v) => !v)}
              >
                <Icon id={advanced ? 'i-chev-d' : 'i-chev-r'} /> {t('Для опытных')}
              </button>
              <div style={{ display: advanced ? '' : 'none' }}>
                <div className="set-row">
                  <span className="lab">
                    {t('Аргументы JVM')}
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
                <LaunchHooksBlock profile={profile} />
                <div className="set-row" style={{ alignItems: 'flex-start' }}>
                  <span className="lab">
                    Java
                    <small>
                      {javaBusy
                        ? t('Качаем Java {n}…', { n: javaBusy })
                        : javaMajor
                          ? t('Java {n} от лаунчера', { n: javaMajor })
                          : t('Пусто — подберём сами')}
                    </small>
                  </span>
                  <div style={{ width: '300px' }}>
                    <Select
                      width="100%"
                      value={String(javaMajor)}
                      disabled={!!javaBusy}
                      options={[
                        { value: '0', label: t('Версия Java: авто'), sub: t('Ту, которую просит сборка') },
                        ...javaAll.map((m) => ({ value: String(m), label: 'Java ' + m, sub: t('Скачаем и закрепим за сборкой') })),
                      ]}
                      onChange={(v) => pinJavaMajor(Number(v))}
                    />
                    {javaMajor ? (
                      <Select
                        width="100%"
                        value={javaVendor}
                        disabled={vendorBusy}
                        options={[
                          { value: 'temurin', label: 'Eclipse Temurin', sub: t('По умолчанию') },
                          { value: 'zulu', label: 'Azul Zulu' },
                          { value: 'semeru', label: 'IBM Semeru', sub: 'OpenJ9' },
                        ]}
                        onChange={(v) => {
                          if (!hasTauri() || !profile || v === javaVendor) return
                          setVendorBusy(true)
                          setProfileJavaVendor(profile, v as JavaVendorId)
                            .then((ver) => {
                              setJavaVendor(v as JavaVendorId)
                              showToast(t('Сборка запускается на Java {major} · {version}', { major: javaMajor, version: ver }))
                            })
                            .catch((e) => showToast(apiErrorText(e, t('Не удалось скачать эту Java')), 'error'))
                            .finally(() => setVendorBusy(false))
                        }}
                      />
                    ) : null}
                    <div className="input sm" style={{ margin: '6px 0' }}>
                      <input
                        id="bsJava"
                        placeholder={t('Номер версии (25) или путь к java')}
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
                        javaList.length ? t('Найденные ({n})', { n: javaList.length }) : t('Ищем Java…')
                      }
                      options={javaList.map((j) => ({ value: j.path, label: j.version, sub: j.path }))}
                      onChange={(v) => {
                        setJava(v)
                        if (hasTauri() && profile)
                          saveProfileSettings(profile, jvm || '', +w || 0, +h || 0, v)
                            .then(() => {
                              setJavaMajor(0)
                              showToast(t('Java выбрана'))
                            })
                            .catch((e) => {
                              trackFailure('build_settings', maskBuild(e, profile), { step: 'java_select' })
                              showToast('' + e, 'error')
                            })
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button
                        className="btn sm secondary"
                        id="bsJavaBrowse"
                        style={{ flex: 1 }}
                        onClick={() => {
                          if (!hasTauri()) {
                            showToast(t('Доступно в приложении'))
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
                                  .catch((e) => {
                                    trackFailure('build_settings', maskBuild(e, profile), { step: 'java_save' })
                                    showToast('' + e, 'error')
                                  })
                              showToast(t('Java выбрана: {version}', { version: j.version }))
                            })
                            .catch((e) => {
                              trackFailure('build_settings', e, { step: 'java_pick' })
                              showToast('' + e, 'error')
                            })
                        }}
                      >
                        {t('Обзор…')}
                      </button>
                      <button
                        className="btn sm secondary"
                        id="bsJavaDetect"
                        style={{ flex: 1 }}
                        onClick={() => {
                          if (!hasTauri()) {
                            showToast(t('Доступно в приложении'))
                            return
                          }
                          setDetectLabel(t('Ищем…'))
                          detectJava()
                            .then((list) => {
                              setDetectLabel(t('Найти'))
                              setJavaList(list)
                              showToast(
                                list.length
                                  ? t('Найдено Java: {n}', { n: list.length })
                                  : t('Java в системе не найдена — жми «Обзор…» или оставь пусто, скачаем сами'),
                              )
                            })
                            .catch((e) => {
                              setDetectLabel(t('Найти'))
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
                            showToast(t('Доступно в приложении'))
                            return
                          }
                          const p = java.trim()
                          if (!p) {
                            showToast(t('Пусто = скачаем нужную Java сами'))
                            return
                          }
                          testJava(p)
                            // Статус несёт иконка тоста (i-check / i-alert), дингбаты в тексте не нужны
                            .then((v) => showToast(String(v)))
                            .catch((e) => showToast(apiErrorText(e, t('Не удалось выполнить действие')), 'error'))
                        }}
                      >
                        {t('Тест')}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="set-row">
                  <span className="lab">
                    {t('Размер окна')}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <div className="input sm" style={{ width: '80px' }}>
                      <input
                        id="bsW"
                        type="number"
                        placeholder={t('Ширина')}
                        value={w}
                        onChange={(e) => setW(e.target.value)}
                        onBlur={saveOpts}
                      />
                    </div>
                    <div className="input sm" style={{ width: '80px' }}>
                      <input
                        id="bsH"
                        type="number"
                        placeholder={t('Высота')}
                        value={h}
                        onChange={(e) => setH(e.target.value)}
                        onBlur={saveOpts}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="set-row bx-danger-row">
                <span className="lab">{t('Удалить сборку')}</span>
                <button
                  className="btn sm danger"
                  id="bsDelete"
                  onClick={async () => {
                    if (
                      !(await uiConfirm(
                        t('Удалить сборку «{name}» со всеми модами, мирами и часами игры? Отменить будет нельзя.', { name: profile ?? '' }),
                        { confirmLabel: t('Удалить') },
                      ))
                    )
                      return
                    if (hasTauri()) {
                      deleteProfile(profile!)
                        .then(() => {
                          close()
                          useProfiles.getState().setSelected(null)
                          void useProfiles.getState().refresh()
                          showToast(t('Сборка удалена'), 'ok', 'delete')
                        })
                        .catch((e) => {
                          void useProfiles.getState().refresh()
                          showToast('' + e, 'error')
                        })
                    } else {
                      close()
                      showToast(t('Удалено (демо)'))
                    }
                  }}
                >
                  <Icon id="i-trash" /> {t('Удалить')}
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
      {pickIcon && profile ? <BuildIconPicker name={profile} icon={pr ? pr.icon : null} onClose={() => setPickIcon(false)} /> : null}
      {iconEditor && profile ? (
        <IconEditor
          title={profile}
          current={recallIconRecipe(profile)}
          onCancel={() => setIconEditor(false)}
          onSave={(data, r) => {
            if (!hasTauri()) {
              showToast(t('Доступно в приложении'), 'error')
              return
            }
            setProfileIcon(profile, data)
              .then(() => {
                rememberIconRecipe(profile, r)
                setIconEditor(false)
                void useProfiles.getState().refresh()
                showToast(t('Иконка обновлена'))
              })
              .catch((e) => showToast(t('Не удалось сохранить иконку: {error}', { error: tx(e) }), 'error'))
          }}
        />
      ) : null}
    </div>
  )
}
