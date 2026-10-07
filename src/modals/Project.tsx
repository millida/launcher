import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { PxIcon } from '../components/PxIcon'
import { PauseInstall } from '../components/PauseInstall'
import { openImage, useLightbox } from '../components/ImageLightbox'
import { hasTauri } from '../ipc/tauri'
import {
  cfInstall,
  cfInstallModpack,
  cfInstallWorld,
  installModpack,
  installModpackVersion,
  installVersion,
  openUrl,
} from '../ipc/commands'
import { LOADER_NAME, RU_LOADER } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import {
  askPlanForVersion,
  catalogInstallTracker,
  installContentFlow,
  installExtras,
  resolveTargetBuild,
  runPickedVersionInstall,
} from '../lib/install'
import { keyCatalogPack, keyCfModpack, keyContent, keyMillida, keyMillidaModpack, keyMrModpack, pickTargetName } from '../lib/installKeys'
import { installFromCatalog } from '../lib/catalogInstall'
import { runInstall, stopInstall, useInstalls } from '../state/installs'
import { trackTimed } from '../lib/telemetry'
import { uiConfirm } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { openCfProject, openMillidaProject, openProject, useProject } from '../state/project'
import { catalogTargetBuild, useMods } from '../state/mods'
import { isInstalledInBuild } from '../lib/catalogInstalled'
import { millidaPid } from '../components/catalog/millidaInstall'
import type { ProjectLink, ProjectVersion } from '../state/project'
import { closeModal, showToast, useUi } from '../state/ui'
import { benchOp, useBench } from '../state/milliBench'
import { backdropClose } from '../lib/dismiss'
import { mirrorAsset, openExt } from '../lib/api'
import { modpackVersionFor } from '../lib/modpackVersion'
import { fmtNum, loaderIconSrc, loaderLabel } from '../components/catalog/site'
import { sizeLabel, spanOf } from '../components/catalog/itemView'
import { agoLabel, compatOf, compatText, isForeign, kindLabel, licenseLabel, sideLabel, tidyBody } from './projectView'
import type { BuildTarget, Compat } from './projectView'
import { cachedTranslation, depProjects, saveLang, savedLang, translateProject, trErrorText } from './projectTranslate'
import type { DepProject, TrView } from './projectTranslate'
import { ProjectRuBody, TrMark, ruDescription, ruGallery, ruVersionName, useRuVersions } from './ProjectRuBody'
import '../styles/pixel/project-modal.css'

/*
 * Страница мода в окне (редизайн 04.10.2026, владелец: «полный мусор, размеры
 * сломаны»). Окно всегда влезает в окно лаунчера: шапка с иконкой, автором и
 * главным действием стоит на месте, прокручивается только содержимое вкладки.
 * Картинки описания ограничены по высоте и открываются на весь экран, галерея —
 * просмотрщик с лентой миниатюр, версии — таблица с отметкой «подходит сборке».
 */

const VER_PAGE = 40

/// Значки категорий Modrinth лежат в public/mr-icons/categories под тем же slug.
const MR_CATS = new Set(
  (
    'adventure atmosphere audio blocks bloom cartoon challenging colored-lighting combat core-shaders cursed decoration ' +
    'economy entities environment equipment fantasy foliage fonts food game-mechanics gui high items kitchen-sink library ' +
    'lightweight locale low magic management medium minigame mobs modded models multiplayer optimization path-tracing pbr ' +
    'potato quests realistic reflections screenshot semi-realistic shadows simplistic social storage technology themed ' +
    'transportation tweaks utility vanilla-like worldgen'
  ).split(' '),
)

const LINK_ICON: Record<ProjectLink['kind'], string> = {
  source: 'blocks',
  wiki: 'book',
  discord: 'msg',
  issues: 'alert',
  donate: 'heart',
}

const maskIcon = (src: string): CSSProperties =>
  ({ WebkitMaskImage: 'url(' + src + ')', maskImage: 'url(' + src + ')' }) as CSSProperties

function LoaderChip({ id }: { id: string }) {
  const src = loaderIconSrc(id)
  return (
    <span className="pjx-chip" data-ld={id}>
      {src ? <i className="pjx-mi" style={maskIcon(src)} aria-hidden="true" /> : null}
      {loaderLabel(id) === id ? RU_LOADER(id) : loaderLabel(id)}
    </span>
  )
}

function Plate({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={'pjx-plate' + (className ? ' ' + className : '')}>
      {title ? <h4 className="pjx-plate-h">{title}</h4> : null}
      {children}
    </section>
  )
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="pjx-fact">
      <span className="pjx-fact-k">{k}</span>
      <span className="pjx-fact-v">{children}</span>
    </div>
  )
}

function CompatMark({ c }: { c: Compat }) {
  if (c === 'unknown') return <span className="pjx-cm" aria-hidden="true" />
  const ok = c === 'ok'
  return (
    <span className={'pjx-cm ' + (ok ? 'ok' : 'no')} title={compatText(c)} aria-label={compatText(c)} role="img">
      <PxIcon name={ok ? 'check' : 'x'} size={10} />
    </span>
  )
}

const TYPE_RU: Record<string, string> = { beta: 'Бета', alpha: 'Альфа' }

export function ProjectModal() {
  const modal = useUi((s) => s.modals.pjModal)
  const pj = useProject()
  const tasks = useInstalls((s) => s.tasks)
  const doneKeys = useInstalls((s) => s.done)
  const doneVersion = useInstalls((s) => s.doneVersion)
  // The build this window reports about is the build the install writes into:
  // asking about one and installing into another left the button saying
  // «Установлено» while every press downloaded the mod again.
  const scoped = useMods((s) => s.targetBuild)
  const allProfiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const selectedBuild = pickTargetName(scoped, allProfiles.map((p) => p.name), selected || '')
  const isCf = pj.source === 'curseforge'
  const isMl = pj.source === 'millida'
  const src = isCf ? 'cf' : 'mr'
  const project: string | number = isCf ? pj.cfid : pj.slug
  const packKey = isMl
    ? pj.kind === 'modpack'
      ? pj.launcherOnly
        ? keyCatalogPack(pj.slug)
        : keyMillidaModpack(pj.slug)
      : keyMillida(selectedBuild || '', pj.kind, pj.slug)
    : pj.kind === 'modpack'
      ? isCf
        ? keyCfModpack(pj.cfid)
        : keyMrModpack(pj.slug)
      : keyContent(src, selectedBuild || '', pj.kind, project)
  const installedIds = useMods((s) => s.installedIds)
  const inBuild =
    pj.kind !== 'modpack' &&
    pj.kind !== 'world' &&
    isInstalledInBuild(
      isMl ? { pid: millidaPid(pj.slug) } : isCf ? { cfid: pj.cfid } : { pid: pj.projectId, slug: pj.slug },
      installedIds,
    )
  const isDone = (key: string): boolean => !!doneKeys[key] || (key === packKey && inBuild)
  const label = (key: string, idle: string): string => {
    const t = tasks[key]
    if (t && t.state === 'run') return t.pct > 0 ? t.label + ' ' + Math.round(t.pct) + '%' : t.label
    return isDone(key) ? 'Установлено' : idle
  }
  /// «Установлено» — это состояние, а не кнопка: повторное нажатие качало тот же
  /// файл заново и ничего не меняло на экране. Сменить версию можно во вкладке
  /// «Версии», об этом и говорим.
  const alreadyDone = (key: string): boolean => {
    if (!isDone(key)) return false
    showToast(
      pj.kind === 'modpack'
        ? 'Сборка уже установлена — во вкладке «Версии» можно поставить другую версию'
        : 'Уже в сборке' + (selectedBuild ? ' «' + selectedBuild + '»' : '') +
          ' — другую версию можно выбрать во вкладке «Версии»',
      'ok',
      false,
    )
    return true
  }
  // The install task key covers the whole project (backend refuses two
  // concurrent jobs writing into the same profile slot), so a single running
  // or finished task must not paint every version row as if it were the one
  // in progress — only the row for the version that task actually targets.
  const versionLabel = (key: string, versionId: string, idle: string): string => {
    const t = tasks[key]
    if (t && t.state === 'run') {
      if (t.versionId !== versionId) return idle
      return t.pct > 0 ? t.label + ' ' + Math.round(t.pct) + '%' : t.label
    }
    return doneVersion[key] === versionId ? 'Установлено' : idle
  }
  const [shot, setShot] = useState(0)
  const [verMode, setVerMode] = useState<'auto' | 'fit' | 'all'>('auto')
  const [verLimit, setVerLimit] = useState(VER_PAGE)
  const bodyRef = useRef<HTMLDivElement>(null)
  const desc = useMemo(() => {
    const text = pj.body ? tidyBody(pj.body) : ''
    return { nodes: text ? renderMarkdown(text) : null, foreign: text ? isForeign(text) : false }
  }, [pj.body])
  const stripRef = useRef<HTMLDivElement>(null)
  const projectKey = pj.source + ':' + (pj.source === 'curseforge' ? pj.cfid : pj.slug)
  const [lang, setLang] = useState<'en' | 'ru'>(savedLang)
  const [tr, setTr] = useState<{ key: string; view: TrView | null; err: string; busy: boolean }>({ key: '', view: null, err: '', busy: false })
  const trKey = useRef('')
  const [deps, setDeps] = useState<Map<string, DepProject>>(() => new Map())
  useEffect(() => {
    setShot(0)
    setVerMode('auto')
    setVerLimit(VER_PAGE)
    trKey.current = ''
    setTr({ key: '', view: null, err: '', busy: false })
  }, [projectKey])
  // Перевод описания: только Modrinth (сервер берёт текст сам) и только чужой язык.
  // RU — по умолчанию: английский виден лишь после «Оригинал» (ProjectRuBody.tsx).
  const canTranslate = pj.source === 'modrinth' && !!pj.slug && !!pj.body && desc.foreign
  useEffect(() => {
    if (!modal.open || lang !== 'ru' || !canTranslate || pj.loading) return
    if (trKey.current === projectKey) return
    const key = projectKey
    const slug = pj.slug
    trKey.current = key
    setTr({ key, view: cachedTranslation(slug), err: '', busy: true })
    const mine = (t: { key: string }) => t.key === key && trKey.current === key
    translateProject(
      slug,
      (v) => setTr((t) => (mine(t) ? { ...t, view: v } : t)),
      () => trKey.current === key && useUi.getState().modals.pjModal.open,
    )
      .then((v) => setTr((t) => (mine(t) ? { ...t, view: v, busy: false } : t)))
      .catch((e) => setTr((t) => (mine(t) ? { ...t, view: null, err: trErrorText(e), busy: false } : t)))
  }, [modal.open, lang, canTranslate, pj.loading, pj.slug, projectKey, tr.err])
  // Имена версий по-русски — лениво, пока открыта вкладка «Версии».
  const ruNames = useRuVersions(pj.slug, modal.open && lang === 'ru' && canTranslate && pj.tab === 'versions')
  // Новая вкладка и новый мод начинаются сверху, а не с середины прошлого описания.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [projectKey, pj.tab])
  useEffect(() => {
    const strip = stripRef.current
    const el = strip && strip.querySelector<HTMLElement>('[data-on="1"]')
    if (!strip || !el) return
    const l = el.offsetLeft - strip.offsetLeft
    if (l < strip.scrollLeft || l + el.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: l - (strip.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' })
    }
  }, [shot, pj.tab])
  // Зависимости файла, который игрок поставит: первый подходящий его сборке, иначе свежий.
  const depVer = useMemo(() => {
    const pr = allProfiles.find((p) => p.name === selectedBuild) || null
    const b: BuildTarget | null =
      pr && pj.kind !== 'modpack' && pj.kind !== 'world' ? { version: pr.version, loader: pr.loader || (pr.fabric ? 'fabric' : 'vanilla') } : null
    return pj.versions.find((v) => compatOf(v, b, pj.kind) === 'ok') || pj.versions[0] || null
  }, [pj.versions, pj.kind, allProfiles, selectedBuild])
  const depIds = depVer && depVer.deps ? depVer.deps.filter((d) => d.type !== 'embedded').map((d) => d.id) : []
  const depKey = depIds.join(',')
  useEffect(() => {
    if (!depKey) return
    let live = true
    void depProjects(depKey.split(',')).then((m) => {
      if (live) setDeps(m)
    })
    return () => {
      live = false
    }
  }, [depKey])

  // Esc при открытой картинке закрывает только картинку: общий обработчик окон
  // (App.tsx) пропускает событие с defaultPrevented. Стрелки листают галерею.
  useEffect(() => {
    if (!modal.open) return
    const onKey = (e: KeyboardEvent) => {
      if (useLightbox.getState().src) {
        if (e.key === 'Escape') e.preventDefault()
        return
      }
      const st = useProject.getState()
      if (st.tab !== 'gallery' || !st.gallery.length) return
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return
      const n = st.gallery.length
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setShot((i) => (i + 1) % n)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setShot((i) => (i - 1 + n) % n)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [modal.open])

  // Мод из верстака: «в сборке ли» — из головы ревизии (общий стор), не из замыкания карточки.
  const benchRef = pj.ctx?.bench ?? null
  const benchIn = useBench((s) =>
    benchRef && s.head ? s.head[benchRef.tab].some((m) => m.projectId === benchRef.projectId) : null,
  )

  // Открыли из сборки Милли — любое закрытие окна (крестик, Esc, фон, «← К
  // сборке») возвращает в тот же чат, а не бросает игрока искать его в истории.
  const backRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (modal.open) {
      backRef.current = pj.ctx?.onBack ?? null
      return
    }
    const back = backRef.current
    backRef.current = null
    back?.()
  }, [modal.open, pj.ctx])

  if (!modal.open) return null
  const close = () => closeModal('pjModal')
  const task = tasks[packKey]
  const running = !!task && task.state === 'run'

  const installWorld = (prof: string, force: boolean): void => {
    const installed = catalogInstallTracker('world', pj.cfid, 'project')
    runInstall({
      key: keyContent('cf', prof, 'world', pj.cfid),
      title: pj.title,
      running: force ? 'Ставим всё равно…' : 'Скачивание…',
      run: () => cfInstallWorld(pj.cfid, prof, force),
      keepOpen: (r) => !r.folder,
      onDone: (r) => {
        if (!r.folder) {
          const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
          void uiConfirm(
            'Карта «' +
              pj.title +
              '» рассчитана на ' +
              (r.mismatch || 'другие версии') +
              ', а у сборки «' +
              prof +
              '» версия ' +
              ((pr && pr.version) || '—') +
              '. Мир может не открыться или сломаться. Поставить всё равно?',
            { title: 'Версия не совпадает', confirmLabel: 'Поставить', danger: false },
          ).then((ok) => {
            if (ok) installWorld(prof, true)
          })
          return
        }
        installed()
        showToast('Карта «' + r.folder + '» → «' + prof + '»: заходи в одиночную игру', 'ok', 'install')
      },
    })
  }

  const installPack = (fileId?: number, mrVersionId?: string) => {
    const startedAt = performance.now()
    const installed = catalogInstallTracker('modpack', isCf ? pj.cfid : pj.slug, 'project')
    runInstall({
      key: packKey,
      title: pj.title || pj.slug,
      running: 'Скачивание…',
      versionId: isCf ? (fileId !== undefined ? 'cf' + fileId : undefined) : mrVersionId,
      run: () =>
        isCf
          ? cfInstallModpack(pj.cfid, fileId)
          : mrVersionId
            ? installModpackVersion(pj.slug, mrVersionId)
            : pj.game
              ? modpackVersionFor(pj.slug, pj.game).then((id) => installModpackVersion(pj.slug, id))
              : installModpack(pj.slug),
      onDone: (p) => {
        trackTimed('modpack_install', startedAt, {
          name: pj.title || pj.slug,
          kind: 'modpack',
          mc: p.version,
          loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
          source: isCf ? 'curseforge' : 'modrinth',
        })
        installed()
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Сборка «' + p.name + '» готова — жми «Играть»', 'ok', 'achievement')
      },
      onError: (err) => {
        trackTimed(
          'modpack_install',
          startedAt,
          {
            name: pj.title || pj.slug,
            kind: 'modpack',
            source: isCf ? 'curseforge' : 'modrinth',
            code: String(err).slice(0, 120),
          },
          false,
        )
        showToast('' + err, 'error')
      },
    })
  }

  // fileId pins a concrete CurseForge file; Modrinth uses its own version id.
  const install = (fileId?: number) => {
    if (fileId === undefined && alreadyDone(packKey)) return
    if (!hasTauri()) {
      showToast('Установка доступна в приложении')
      return
    }
    if (isMl) {
      void installFromCatalog(pj.section, pj.slug)
      return
    }
    if (pj.kind === 'modpack') {
      installPack(fileId)
      return
    }
    if (pj.kind === 'world') {
      void resolveTargetBuild('world').then((prof) => {
        if (prof) installWorld(prof, false)
      })
      return
    }
    if (!isCf) {
      void installContentFlow({ source: 'modrinth', slug: pj.slug }, pj.kind, pj.title)
      return
    }
    if (fileId === undefined) {
      void installContentFlow({ source: 'curseforge', cfid: pj.cfid }, pj.kind, pj.title)
      return
    }
    // a file picked by hand in the versions tab installs as picked
    void resolveTargetBuild(pj.kind).then(async (prof) => {
      if (!prof) return
      const extras = await askPlanForVersion(prof, pj.kind, 'curseforge', String(pj.cfid), String(fileId))
      if (!extras) return
      const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
      const installed = catalogInstallTracker(pj.kind, pj.cfid, 'project')
      runPickedVersionInstall({
        key: keyContent('cf', prof, pj.kind, pj.cfid),
        title: pj.title,
        prof,
        versionId: 'cf' + fileId,
        run: (allowMismatch) =>
          cfInstall(pj.cfid, (pr && pr.version) || '', prof, pj.kind, fileId, allowMismatch),
        onInstalled: (r) => {
          void useMods.getState().refreshInstalled()
          installExtras(prof, pj.kind, extras)
          installed()
          showToast('CurseForge → «' + prof + '»: ' + r.file, 'ok', 'install')
        },
      })
    })
  }

  const installVer = (v: ProjectVersion) => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    // Ставить другую версию поверх — обычное дело; ту же самую — уже стоит.
    if (doneVersion[packKey] === v.id) {
      showToast('Эта версия уже стоит' + (selectedBuild ? ' в «' + selectedBuild + '»' : ''), 'ok', false)
      return
    }
    if (isMl) {
      void installFromCatalog(pj.section, pj.slug, { fileId: v.id })
      return
    }
    if (isCf) {
      install(v.cfFileId)
      return
    }
    if (pj.kind === 'modpack') {
      installPack(undefined, v.id)
      return
    }
    const prof = catalogTargetBuild() || (useProfiles.getState().profiles[0] || { name: '' }).name || 'default'
    const installed = catalogInstallTracker(pj.kind, pj.slug, 'project')
    void askPlanForVersion(prof, pj.kind, 'modrinth', pj.slug, v.id).then((extras) => {
      if (!extras) return
      runPickedVersionInstall({
        key: keyContent('mr', prof, pj.kind, pj.slug),
        title: pj.title || pj.slug,
        prof,
        versionId: v.id,
        run: (allowMismatch) => installVersion(pj.slug, v.id, prof, pj.kind, allowMismatch),
        onInstalled: (r) => {
          void useMods.getState().refreshInstalled()
          installExtras(prof, pj.kind, extras)
          installed()
          showToast('В «' + prof + '»: ' + r.file + (r.warning ? ' · ' + r.warning : ''), 'ok', 'install')
        },
      })
    })
  }

  // ── То, что окно знает о сборке, в которую ставит ──
  const prof = allProfiles.find((p) => p.name === selectedBuild) || null
  const isContent = pj.kind !== 'modpack' && pj.kind !== 'world'
  const build: BuildTarget | null = isContent && prof ? { version: prof.version, loader: prof.loader || (prof.fabric ? 'fabric' : 'vanilla') } : null
  const buildText = prof ? prof.version + (pj.kind === 'mod' ? ' · ' + LOADER_NAME(prof) : '') : ''
  const rows = pj.versions.map((v) => ({ v, c: compatOf(v, build, pj.kind) }))
  const fit = rows.filter((r) => r.c === 'ok')
  const mode = verMode === 'auto' ? (build && fit.length ? 'fit' : 'all') : verMode
  const shown = mode === 'fit' ? fit : rows
  const versionsKnown = !pj.loading && pj.versions.length > 0
  const noFit = !!build && versionsKnown && fit.length === 0

  const ctx = pj.ctx && benchIn !== null ? { ...pj.ctx, inPack: benchIn } : pj.ctx
  const canToggle = !!ctx && (benchIn !== null || !!ctx.onToggle)
  const srcName = isMl ? 'Millida' : isCf ? 'CurseForge' : 'Modrinth'
  const lic = licenseLabel(pj.license)
  const side = sideLabel(pj.clientSide, pj.serverSide)
  const loaders = pj.loaders.filter((l) => l !== 'minecraft' && l !== 'datapack' ? true : pj.kind === 'datapack')
  const span = spanOf(pj.gameVersions)
  const hero = pj.gallery.length ? pj.gallery[0].url : ''
  const tint = pj.color !== null ? '#' + pj.color.toString(16).padStart(6, '0') : ''
  const done = !!doneKeys[packKey]
  const idleLabel = pj.kind === 'modpack' ? 'Установить' : pj.kind === 'world' ? 'Добавить карту' : 'Добавить в сборку'
  const shotN = pj.gallery.length ? Math.min(shot, pj.gallery.length - 1) : 0
  const cur = pj.gallery[shotN]

  const depGroups = (['required', 'optional', 'incompatible'] as const)
    .map((type) => ({
      type,
      list: (depVer && depVer.deps ? depVer.deps : []).filter((d) => d.type === type),
    }))
    .filter((g) => g.list.length)
  const neededBy = ctx && ctx.neededBy ? ctx.neededBy : []
  const showDeps = !isCf && !isMl && isContent && (depGroups.length > 0 || neededBy.length > 0 || versionsKnown)
  const trOn = lang === 'ru' && canTranslate
  const pickLang = (v: 'en' | 'ru') => {
    if (v === lang && !(v === 'ru' && tr.err)) return
    if (tr.err) trKey.current = ''
    saveLang(v)
    setLang(v)
    // Снятая ошибка перезапускает эффект перевода (tr.err в его зависимостях).
    if (tr.err) setTr((t) => ({ ...t, err: '' }))
  }

  const ctaNote: { text: string; sub?: string; warn?: boolean } | null =
    pj.kind === 'modpack'
      ? { text: 'Поставится отдельной сборкой' }
      : !selectedBuild
        ? { text: 'Сборку выберешь при установке' }
        : noFit
          ? { text: 'Нет версии под ' + buildText, warn: true }
          : { text: 'в «' + selectedBuild + '»', sub: isContent ? buildText : '' }

  const retry = () => {
    if (isCf) void openCfProject(pj.cfid, pj.kind, pj.title)
    else if (isMl) void openMillidaProject(pj.slug, pj.section, pj.kind)
    else void openProject(pj.slug, pj.kind, pj.game, { ctx: pj.ctx })
  }

  const toggleMilli = () => {
    if (!ctx) return
    if (ctx.bench && benchIn !== null) {
      // Оптимистично: голова меняется за кадр, кнопка перерисуется от стора.
      void benchOp({ op: benchIn ? 'remove' : 'restore', tab: ctx.bench.tab, ref: ctx.bench.projectId })
      return
    }
    if (!ctx.onToggle) return
    ctx.onToggle()
    pj.set({ ctx: { ...ctx, inPack: !ctx.inPack } })
  }

  const backToMilli = () => {
    if (!ctx || !ctx.onBack) return
    // Сам возврат в чат делает эффект закрытия окна.
    close()
  }

  /// Картинка из описания — на весь экран; значки-ссылки (shields) остаются ссылками.
  const zoomFromArticle = (e: ReactMouseEvent) => {
    const img = (e.target as HTMLElement).closest('img')
    if (!img || img.closest('a')) return
    if (img.naturalWidth && img.naturalWidth < 160) return
    openImage(img.currentSrc || img.src)
  }

  const openSite = () => {
    if (!pj.website) return
    if (hasTauri()) openUrl(pj.website)
    else window.open(pj.website, '_blank')
  }

  const tabs: [string, string, number][] = [
    ['desc', 'Описание', 0],
    ['gallery', 'Галерея', pj.gallery.length],
    ['versions', 'Версии', pj.versions.length],
  ]

  const stats = (
    <>
      {pj.downloads !== null ? (
        <span className="pjx-stat dl" title={pj.downloads.toLocaleString('ru-RU') + ' скачиваний'}>
          <PxIcon name="download" size={11} />
          {fmtNum(pj.downloads)}
        </span>
      ) : null}
      {pj.followers !== null ? (
        <span className="pjx-stat fl" title={pj.followers.toLocaleString('ru-RU') + ' подписчиков'}>
          <PxIcon name="heart" size={11} />
          {fmtNum(pj.followers)}
        </span>
      ) : null}
      {pj.updated ? (
        <span className="pjx-stat up" title={'Обновлён ' + new Date(pj.updated).toLocaleDateString('ru-RU')}>
          <PxIcon name="clock" size={11} />
          обновлён {agoLabel(pj.updated)}
        </span>
      ) : null}
    </>
  )

  const skelLines = (ws: number[], h?: string) => (
    <div className="cat-pj-skel" aria-hidden="true">
      {ws.map((w, i) => (
        <span key={i} className="skel skel-line" style={{ width: w + '%', height: h }}></span>
      ))}
    </div>
  )

  return (
    <div
      className={'modal-bg pjx-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="pjModal"
      {...backdropClose(close)}
    >
      <div
        className="modal pjx"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pjTitle"
        data-section="project"
        data-kind={pj.kind === 'world' ? 'map' : pj.kind}
        data-id={isCf ? String(pj.cfid) : pj.slug}
        data-milli={ctx ? (ctx.inPack ? 'in' : 'out') : undefined}
      >
        <header className="pjx-head">
          <div className="pjx-glow" aria-hidden="true">
            {hero ? <img src={hero} alt="" referrerPolicy="no-referrer" /> : tint ? <i style={{ background: tint }} /> : null}
          </div>
          <button className="pjx-x" id="pjClose" aria-label="Закрыть" data-sound="close" data-track="close" onClick={close}>
            <PxIcon name="x" size={12} />
          </button>
          <div className="pjx-id">
            <span className="pjx-icon">
              {pj.icon ? (
                <img id="pjIcon" src={mirrorAsset(pj.icon) || undefined} alt="" referrerPolicy="no-referrer" />
              ) : pj.loading ? (
                <span className="skel pjx-icon-skel" />
              ) : (
                <PxIcon name="box" size={28} />
              )}
            </span>
            <div className="pjx-titles">
              <div className="pjx-kicker">
                <span>{kindLabel(pj.kind)}</span>
                <span className="pjx-dot" aria-hidden="true" />
                <span>{srcName}</span>
                {ctx ? (
                  <span className={'pjx-milli-tag' + (ctx.inPack ? '' : ' out')}>
                    <PxIcon name={ctx.inPack ? 'check' : 'minus'} size={9} />
                    {ctx.inPack ? 'В сборке Милли' : 'Убран из сборки'}
                  </span>
                ) : null}
              </div>
              <h2 id="pjTitle" className="pjx-title" title={pj.title}>
                {pj.loading && (!pj.title || pj.title === 'Загружаем…') ? <span className="skel pjx-title-skel" /> : pj.title}
              </h2>
              <div className="pjx-meta" id="pjSub">
                {pj.author ? (
                  <span className="pjx-by">
                    от{' '}
                    {pj.authorUrl ? (
                      <a
                        href={pj.authorUrl}
                        data-track="project_author"
                        onClick={(e) => {
                          e.preventDefault()
                          openExt(pj.authorUrl)
                        }}
                      >
                        {pj.author}
                      </a>
                    ) : (
                      <b>{pj.author}</b>
                    )}
                  </span>
                ) : null}
                {stats}
                {!pj.author && pj.downloads === null && !pj.updated && pj.sub && !pj.loading ? <span className="pjx-stat">{pj.sub}</span> : null}
              </div>
              {pj.summary ? (
                trOn ? (
                  <p className="pjx-summary" lang="ru">{ruDescription(tr.view, tr.err, pj.summary)}</p>
                ) : (
                  <p className="pjx-summary" title={pj.summary}>{pj.summary}</p>
                )
              ) : null}
            </div>
            <div className="pjx-cta">
              {ctx && (ctx.locked || canToggle) ? (
                ctx.locked ? (
                  <span className="pjx-locked">
                    <PxIcon name="lock" size={11} />
                    Нужен для запуска
                  </span>
                ) : (
                  <button
                    className={'btn md ' + (ctx.inPack ? 'secondary pjx-rm' : 'primary')}
                    data-track="milli_mod_toggle"
                    data-src="project"
                    data-id={pj.slug}
                    onClick={toggleMilli}
                  >
                    <PxIcon name={ctx.inPack ? 'minus' : 'plus'} size={12} />
                    {ctx.inPack ? 'Убрать из сборки' : 'Вернуть в сборку'}
                  </button>
                )
              ) : (
                <div className="pjx-cta-row">
                  <button
                    className={'btn md ' + (done && !running ? 'secondary pjx-done' : 'primary')}
                    id="pjInstall"
                    data-track={pj.kind === 'modpack' ? 'install' : 'add_to_build'}
                    onClick={() => install()}
                  >
                    {running ? null : <PxIcon name={done ? 'check' : pj.kind === 'modpack' ? 'download' : 'plus'} size={12} />}
                    {label(packKey, idleLabel)}
                  </button>
                  {/* Отменить установку можно было только из панели загрузок, а её
                      закрывает это же окно — игрок оставался с бегущим процентом. */}
                  <PauseInstall task={task} className="btn md secondary pjx-cancel" />
                  {running ? (
                    <button className="btn md secondary pjx-cancel" aria-label="Отменить установку" data-track="install_cancel" onClick={() => stopInstall(packKey)}>
                      <PxIcon name="x" size={12} />
                    </button>
                  ) : null}
                </div>
              )}
              {ctx ? (
                ctx.onBack ? (
                  <button className="pjx-note pjx-back" data-track="milli_back" onClick={backToMilli}>
                    <PxIcon name="arrow-l" size={10} />К сборке{ctx.packTitle ? ' «' + ctx.packTitle + '»' : ' Милли'}
                  </button>
                ) : null
              ) : ctaNote && !running ? (
                <span className={'pjx-note' + (ctaNote.warn ? ' warn' : '')} title={ctaNote.text + (ctaNote.sub ? ' · ' + ctaNote.sub : '')}>
                  <span className="pjx-note-t">
                    {ctaNote.warn ? <PxIcon name="alert" size={10} /> : null}
                    <span>{ctaNote.text}</span>
                  </span>
                  {ctaNote.sub ? <span className="pjx-note-s">{ctaNote.sub}</span> : null}
                </span>
              ) : null}
            </div>
          </div>
          {loaders.length || span || pj.tags.length ? (
            <div className="pjx-badges" id="pjTags">
              {loaders.slice(0, 5).map((l) => (
                <LoaderChip key={l} id={l} />
              ))}
              {span ? (
                <span className="pjx-chip ver" title={'Версии игры: ' + pj.gameVersions.slice(-12).join(', ')}>
                  <PxIcon name="blocks" size={10} />
                  {span.replace(' — ', '–')}
                </span>
              ) : null}
              {pj.tags.length ? <span className="pjx-sep" aria-hidden="true" /> : null}
              {pj.tags.slice(0, 4).map((c) => (
                <span className="pjx-chip soft" key={c}>
                  {!isCf && !isMl && MR_CATS.has(c) ? <i className="pjx-mi" style={maskIcon('/mr-icons/categories/' + c + '.svg')} aria-hidden="true" /> : null}
                  {RU_LOADER(c)}
                </span>
              ))}
            </div>
          ) : null}
          <nav className="pjx-tabs">
            <div className="segs" role="tablist" aria-label="Разделы">
              {tabs
                // Пустая вкладка — лишний клик в «Галереи нет»: прячем, пока открыта не она.
                .filter(([k]) => k !== 'gallery' || pj.loading || pj.gallery.length > 0 || pj.tab === 'gallery')
                .map(([k, text, n]) => (
                  <button
                    key={k}
                    className={'seg' + (pj.tab === k ? ' on' : '')}
                    role="tab"
                    aria-selected={pj.tab === k}
                    aria-controls={k === 'desc' ? 'pjDesc' : k === 'gallery' ? 'pjGallery' : 'pjVersions'}
                    data-pjtab={k}
                    data-track={'pj_tab_' + k}
                    onClick={() => pj.set({ tab: k })}
                  >
                    {text}
                    {n ? <span className="pjx-n">{n > 999 ? '999+' : n}</span> : null}
                  </button>
                ))}
            </div>
            <button className="btn sm ghost pjx-site" id="pjOpen" data-track="open_source_site" disabled={!pj.website} onClick={openSite}>
              {srcName}
              <PxIcon name="ext" size={10} />
            </button>
          </nav>
        </header>

        <div className="pjx-body" ref={bodyRef} data-tab={pj.tab}>
          {pj.failed ? (
            <div className="pjx-empty">
              <PxIcon name="alert" size={28} />
              <b>Страница не загрузилась</b>
              <span>Проверь интернет и попробуй ещё раз.</span>
              <button className="btn md secondary" data-track="project_retry" onClick={retry}>
                <PxIcon name="restart" size={12} />
                Повторить
              </button>
            </div>
          ) : null}

          <div id="pjDesc" className="pjx-pane pjx-desc" role="tabpanel" hidden={pj.tab !== 'desc' || pj.failed}>
            <article className="pjx-art" aria-label="Описание">
              <div className="pjx-art-h">
                <PxIcon name="book" size={11} />
                <span className="pjx-art-t">
                  Описание автора
                  {!trOn && desc.foreign ? ' · на английском' : ''}
                </span>
                {canTranslate && (desc.foreign || trOn) ? (
                  <div className="pjx-lang" role="group" aria-label="Язык описания">
                    {trOn && !tr.err ? <TrMark view={tr.view} busy={tr.busy} /> : null}
                    <button className={'pjx-lang-b' + (!trOn ? ' on' : '')} aria-pressed={!trOn} data-track="pj_lang_en" onClick={() => pickLang('en')}>
                      Оригинал
                    </button>
                    <button className={'pjx-lang-b ru' + (trOn ? ' on' : '')} aria-pressed={trOn} data-track="pj_lang_ru" onClick={() => pickLang('ru')}>
                      RU
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="pjx-md pj-body" onClick={zoomFromArticle}>
                {pj.loading ? (
                  skelLines([90, 100, 96, 72, 100, 84, 60])
                ) : trOn ? (
                  <ProjectRuBody key={projectKey} view={tr.view} busy={tr.busy} err={tr.err} onRetry={() => pickLang('ru')} onOriginal={() => pickLang('en')} />
                ) : desc.nodes ? (
                  desc.nodes
                ) : (
                  <p className="faint-note">{pj.summary || 'Автор не написал описание'}</p>
                )}
              </div>
            </article>
            <aside className="pjx-aside">
              {ctx && ctx.why ? (
                <Plate className="pjx-milli" title={ctx.packTitle ? 'Сборка «' + ctx.packTitle + '»' : 'Сборка Милли'}>
                  {ctx.why ? (
                    <p className="pjx-why">
                      <PxIcon name="sparkle" size={11} />
                      <span>{ctx.why}</span>
                    </p>
                  ) : null}
                </Plate>
              ) : null}
              {isContent && (build || side || span) ? (
                <Plate title="Совместимость">
                  {build && versionsKnown ? (
                    <div className={'pjx-fit' + (noFit ? ' no' : ' ok')}>
                      <PxIcon name={noFit ? 'alert' : 'check'} size={11} />
                      <span>
                        {noFit ? 'Нет версии под ' : 'Есть версия под '}
                        <b>{buildText}</b>
                      </span>
                    </div>
                  ) : null}
                  {span ? <Fact k="Версии игры">{span}</Fact> : null}
                  {side ? <Fact k="Где нужен">{side}</Fact> : null}
                </Plate>
              ) : null}
              {showDeps ? (
                <Plate className="pjx-deps" title="Зависимости">
                  {depVer && depGroups.length ? <span className="pjx-deps-v">для версии {depVer.number || depVer.name}</span> : null}
                  {depGroups.map((g) => (
                    <div className={'pjx-dg ' + g.type} key={g.type}>
                      <span className="pjx-dg-h">
                        {g.type === 'required' ? 'Требует' : g.type === 'optional' ? 'Дружит с' : 'Несовместим с'}
                      </span>
                      <div className="pjx-dg-list">
                        {g.list.slice(0, 8).map((d) => {
                          const p = deps.get(d.id)
                          return (
                            <button
                              key={d.id}
                              className="pjx-dep"
                              data-track="project_dep_open"
                              data-id={p ? p.slug : d.id}
                              disabled={!p}
                              title={p ? 'Открыть «' + p.title + '»' : undefined}
                              onClick={() => {
                                if (p) void openProject(p.slug, p.type)
                              }}
                            >
                              {p && p.icon ? <img src={p.icon} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <i className="pjx-dep-ph" />}
                              <span>{p ? p.title : '…'}</span>
                            </button>
                          )
                        })}
                        {g.list.length > 8 ? <span className="pjx-dg-more">+{g.list.length - 8}</span> : null}
                      </div>
                    </div>
                  ))}
                  {neededBy.length ? (
                    <div className="pjx-dg needed">
                      <span className="pjx-dg-h">Нужен для</span>
                      <div className="pjx-dg-list">
                        {neededBy.slice(0, 8).map((t) => (
                          <span className="pjx-dep static" key={t}>
                            <i className="pjx-dep-ph" />
                            <span>{t}</span>
                          </span>
                        ))}
                        {neededBy.length > 8 ? <span className="pjx-dg-more">+{neededBy.length - 8}</span> : null}
                      </div>
                    </div>
                  ) : null}
                  {!depGroups.length && !neededBy.length ? (
                    <span className="pjx-deps-none">
                      <PxIcon name="check" size={10} />
                      Работает сам, ничего не требует
                    </span>
                  ) : null}
                </Plate>
              ) : null}
              <Plate title="О проекте">
                {pj.author ? <Fact k="Автор">{pj.author}</Fact> : null}
                {lic ? (
                  <Fact k="Лицензия">
                    {pj.license && pj.license.url ? (
                      <a
                        href={pj.license.url}
                        title={pj.license.id}
                        onClick={(e) => {
                          e.preventDefault()
                          if (pj.license && pj.license.url) openExt(pj.license.url)
                        }}
                      >
                        {lic.text}
                      </a>
                    ) : (
                      <span title={pj.license ? pj.license.id : undefined}>{lic.text}</span>
                    )}
                    {lic.open ? <em className="pjx-open">открытый код</em> : null}
                  </Fact>
                ) : null}
                {pj.published ? <Fact k="Вышел">{agoLabel(pj.published)}</Fact> : null}
                {pj.updated ? <Fact k="Обновлён">{agoLabel(pj.updated)}</Fact> : null}
                {pj.downloads !== null ? <Fact k="Скачиваний">{pj.downloads.toLocaleString('ru-RU')}</Fact> : null}
                {pj.loading ? skelLines([80, 60, 70]) : null}
              </Plate>
              {pj.links.length ? (
                <Plate title="Ссылки">
                  <div className="pjx-links">
                    {pj.links.map((l) => (
                      <button key={l.kind + l.url} className={'pjx-link ' + l.kind} data-track={'project_link_' + l.kind} onClick={() => openExt(l.url)} title={l.url}>
                        <PxIcon name={LINK_ICON[l.kind]} size={11} />
                        <span>{l.label}</span>
                        <PxIcon name="ext" size={9} className="px-icon pjx-link-ext" />
                      </button>
                    ))}
                  </div>
                </Plate>
              ) : null}
            </aside>
          </div>

          <div id="pjGallery" className="pjx-pane pjx-gal" role="tabpanel" hidden={pj.tab !== 'gallery' || pj.failed}>
            {cur ? (
              <>
                <div className="pjx-stage">
                  <img className="pjx-stage-bg" src={cur.url} alt="" aria-hidden="true" referrerPolicy="no-referrer" />
                  <button
                    className="pjx-stage-img"
                    data-track="pj_shot_zoom"
                    aria-label="Открыть картинку на весь экран"
                    onClick={() => openImage(cur.raw || cur.url)}
                  >
                    <img key={cur.url} src={cur.url} alt={cur.title || ''} referrerPolicy="no-referrer" />
                  </button>
                  <span className="pjx-count">
                    {shotN + 1} / {pj.gallery.length}
                  </span>
                  <span className="pjx-zoom" aria-hidden="true">
                    <PxIcon name="maximize" size={11} />
                  </span>
                  {pj.gallery.length > 1 ? (
                    <>
                      <button className="pjx-nav prev" aria-label="Предыдущая" data-track="pj_shot_prev" onClick={() => setShot((shotN - 1 + pj.gallery.length) % pj.gallery.length)}>
                        <PxIcon name="chev-l" size={14} />
                      </button>
                      <button className="pjx-nav next" aria-label="Следующая" data-track="pj_shot_next" onClick={() => setShot((shotN + 1) % pj.gallery.length)}>
                        <PxIcon name="chev-r" size={14} />
                      </button>
                    </>
                  ) : null}
                </div>
                {cur.title || cur.description ? (
                  <div className="pjx-cap">
                    {cur.title ? <b>{trOn ? ruGallery(tr.view, tr.err, cur.title, 'title') : cur.title}</b> : null}
                    {cur.description ? <span>{trOn ? ruGallery(tr.view, tr.err, cur.description, 'description') : cur.description}</span> : null}
                  </div>
                ) : null}
                {pj.gallery.length > 1 ? (
                  <div className="pjx-strip" ref={stripRef} role="listbox" aria-label="Картинки">
                    {pj.gallery.map((g, i) => (
                      <button
                        key={g.url + i}
                        className={'pjx-thumb' + (i === shotN ? ' on' : '')}
                        data-on={i === shotN ? '1' : undefined}
                        role="option"
                        aria-selected={i === shotN}
                        aria-label={g.title || 'Картинка ' + (i + 1)}
                        onClick={() => setShot(i)}
                      >
                        <img src={g.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : pj.loading ? (
              skelLines([100], '320px')
            ) : (
              <div className="pjx-empty">
                <PxIcon name="image" size={28} />
                <b>Галереи нет</b>
                <span>Автор не добавил картинок.</span>
              </div>
            )}
          </div>

          <div id="pjVersions" className="pjx-pane pjx-vers" role="tabpanel" hidden={pj.tab !== 'versions' || pj.failed}>
            {pj.versions.length ? (
              <>
                <div className="pjx-vbar">
                  {build ? (
                    <div className="segs" role="group" aria-label="Какие версии показать">
                      <button className={'seg' + (mode === 'fit' ? ' on' : '')} data-track="pj_ver_fit" onClick={() => setVerMode('fit')}>
                        <span className="pjx-fitdot" aria-hidden="true" />
                        Для «{selectedBuild}»
                        <span className="pjx-n">{fit.length}</span>
                      </button>
                      <button className={'seg' + (mode === 'all' ? ' on' : '')} data-track="pj_ver_all" onClick={() => setVerMode('all')}>
                        Все
                        <span className="pjx-n">{rows.length}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="pjx-vbar-t">
                      {rows.length} {rows.length === 1 ? 'версия' : rows.length < 5 ? 'версии' : 'версий'}
                    </span>
                  )}
                  {build ? <span className="pjx-vbar-build">{buildText}</span> : null}
                </div>
                {shown.length ? (
                  <div className={'pjx-table' + (build ? ' has-cm' : '')} role="table" aria-label="Версии">
                    <div className="pjx-tr pjx-th" role="row">
                      {build ? <span role="columnheader" aria-label="Совместимость" /> : null}
                      <span role="columnheader">Версия</span>
                      <span role="columnheader">Игра</span>
                      <span role="columnheader">Загрузчик</span>
                      <span role="columnheader">Вышла</span>
                      <span role="columnheader" className="r">Размер</span>
                      <span role="columnheader" aria-label="Действие" />
                    </div>
                    {shown.slice(0, verLimit).map(({ v, c }) => {
                      const vl = versionLabel(packKey, v.id, pj.kind === 'modpack' ? 'Установить' : 'Добавить')
                      const vdone = vl === 'Установлено'
                      const ls = (v.loaders || []).filter((l) => l !== 'minecraft')
                      return (
                        <div className={'pjx-tr' + (c === 'ok' ? ' fit' : c === 'unknown' ? '' : ' miss')} role="row" key={v.id}>
                          {build ? <CompatMark c={c} /> : null}
                          <span className="pjx-vname" role="cell">
                            <b title={trOn ? undefined : v.name}>{trOn ? ruVersionName(ruNames, v) : v.name}</b>
                            <span>
                              {v.type && TYPE_RU[v.type] ? <i className={'pjx-type ' + v.type}>{TYPE_RU[v.type]}</i> : null}
                              {v.number && v.number !== v.name ? <span className="pjx-vnum">{v.number}</span> : null}
                            </span>
                          </span>
                          <span role="cell" className="pjx-vgame" title={(v.game_versions || []).join(', ')}>
                            {spanOf(v.game_versions || []) || '—'}
                          </span>
                          <span role="cell" className="pjx-vld">
                            {ls.length ? ls.slice(0, 3).map((l) => (l === ls[0] ? '' : ', ') + (loaderLabel(l) === l ? RU_LOADER(l) : loaderLabel(l))) : '—'}
                          </span>
                          <span role="cell" className="pjx-vdate" title={v.date ? new Date(v.date).toLocaleDateString('ru-RU') : undefined}>
                            {agoLabel(v.date, Date.now(), true) || '—'}
                          </span>
                          <span role="cell" className="pjx-vsize r">{v.size ? sizeLabel(v.size) : ''}</span>
                          <span role="cell" className="pjx-vact">
                            <button
                              className={'btn sm ' + (vdone ? 'ghost pjx-done' : 'secondary') + ' pj-ver'}
                              data-vid={v.id}
                              data-track="install_version"
                              onClick={() => installVer(v)}
                            >
                              {vdone ? <PxIcon name="check" size={10} /> : null}
                              {vl}
                            </button>
                            {running && task.versionId === v.id ? <PauseInstall task={task} className="btn sm ghost" /> : null}
                            {running && task.versionId === v.id ? (
                              <button className="btn sm ghost" aria-label="Отменить установку" data-track="install_cancel" onClick={() => stopInstall(packKey)}>
                                <PxIcon name="x" size={10} />
                              </button>
                            ) : null}
                          </span>
                        </div>
                      )
                    })}
                    {shown.length > verLimit ? (
                      <button className="btn sm secondary pjx-more" data-track="pj_ver_more" onClick={() => setVerLimit((n) => n + VER_PAGE)}>
                        Показать ещё {Math.min(VER_PAGE, shown.length - verLimit)}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="pjx-empty">
                    <PxIcon name="alert" size={28} />
                    <b>Под «{selectedBuild}» версий нет</b>
                    <span>{buildText ? 'Нужна ' + buildText + '. ' : ''}Можно поставить другую версию на свой страх.</span>
                    <button className="btn md secondary" onClick={() => setVerMode('all')}>
                      Показать все версии
                    </button>
                  </div>
                )}
              </>
            ) : pj.loading || (!pj.failed && pj.title === 'Загружаем…') ? (
              skelLines([100, 100, 100, 100], '40px')
            ) : (
              <div className="pjx-empty">
                <PxIcon name="box" size={28} />
                <b>Версий нет</b>
                <span>Автор пока не выложил файлы.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
