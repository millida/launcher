// Install from the Millida catalog and Modrinth: works out what to install and calls core commands. The core downloads files and checks the hash.
// From here only metadata requests go out, to api.millida.net (/launcher/mr, /launcher/cf).
import { hasTauri } from '../ipc/tauri'
import {
  PACK_ACCESS_PREFIX,
  catalogInstall,
  catalogInstallPlan,
  cfInstall,
  cfInstallModpack,
  fetchTexture,
  installCatalogPack,
  installContent,
  installModpack,
  installModpackVersion,
  installSharedPack,
  installVersion,
} from '../ipc/commands'
import type { CatalogInstallReq, ContentInstall, Profile } from '../ipc/commands'
import { MODRINTH_API, hasMillidaAccount, openExt } from './api'
import {
  KIND_OF_SECTION,
  catalog,
  cfFileIdOf,
  cfProjectOf,
  compatibleBuilds,
  knownVersions,
  loaderMatters,
  modrinthSlugOf,
  pickFile,
  planToDepPlan,
  isCatalogSkinId,
  nickSkinTextureUrl,
  sitePage,
  skinTextureUrl,
} from './millidaCatalog'
import type { CatalogFile, CatalogItem } from './millidaCatalog'
import { askPlanForVersion, installExtras } from './install'
import { keyCatalogPack, keyCfModpack, keyContent, keyMillida, keyMillidaModpack, keyMrModpack } from './installKeys'
import { LOADER_NAME, loaderId } from './format'
import { trackTimed } from './telemetry'
import { addToWardrobe, applyCatalogCape, applyWardrobeItem, loadCapeCatalog } from './gameProfile'
import { runInstall } from '../state/installs'
import { useProfiles } from '../state/profiles'
import { useMods } from '../state/mods'
import { pickBuild } from '../state/buildPicker'
import { askDepPlan } from '../state/depPlan'
import { usePackKey } from '../state/packKey'
import { uiConfirm } from '../state/confirm'
import { detectSlimFromUrl } from './skinArms'
import { setScreen, showToast } from '../state/ui'
import { t, tx } from '../i18n'

/// «Установить» из каталога Millida — одна точка и для кнопки на сайте
/// (millida://install/…), и для библиотеки внутри лаунчера. Решение «откуда
/// брать байты» живёт здесь, экраны его не знают:
///  - файл лежит на нашем зеркале — качает ядро по ссылке, которую само берёт у API;
///  - зеркала нет, но первоисточник Modrinth — тот же файл через Modrinth-путь
///    лаунчера (зависимости, проверка сумм, обновления уже есть там);
///  - ни того ни другого — открываем карточку на сайте, молча не падаем.
/// Моды с Modrinth идут вторым путём даже при зеркале: только он ставит
/// обязательные зависимости, без которых мод не запустится.

const ruKind = (): Record<string, string> => ({
  mod: t('мод'),
  resourcepack: t('ресурспак'),
  datapack: t('дата-пак'),
  shader: t('шейдер'),
  world: t('карту'),
  modpack: t('сборку'),
})

export interface CatalogInstallOpts {
  /// Из ссылки сайта: версии игры и загрузчики, под которые человек выбирал.
  versions?: string[]
  loaders?: string[]
  /// Конкретный файл, выбранный во вкладке «Версии».
  fileId?: string
  /// Сборка задана заранее (зависимость ставится туда же, куда сам мод).
  profile?: string
  /// Пришло ссылкой со страницы: любая страница может её открыть, поэтому
  /// установка без выбора сборки всё равно спрашивает подтверждение.
  fromLink?: boolean
  /// Уже поставленные в этом заходе slug — защита от кольца зависимостей.
  seen?: Set<string>
  /// Скин: подпись в гардеробе и модель рук из ссылки сайта.
  name?: string
  slim?: boolean
}

const profiles = () => useProfiles.getState().profiles
const buildOf = (name: string) => profiles().find((p) => p.name === name)

function notFound(section: string, slug: string) {
  showToast(t('В каталоге Millida нет «{slug}»', { slug }), 'error', undefined, {
    label: t('На сайт'),
    run: () => openExt(sitePage(section, slug)),
  })
}

function toSite(section: string, slug: string, why: string) {
  showToast(why, 'error', undefined, { label: t('Открыть'), run: () => openExt(sitePage(section, slug)) })
}

async function chooseBuild(
  title: string,
  kind: string,
  files: CatalogFile[],
  opts: CatalogInstallOpts,
): Promise<string | null> {
  // Ссылка сайта может разбудить лаунчер раньше, чем он прочитал список сборок.
  if (!profiles().length) await useProfiles.getState().refresh().catch(() => {})
  if (opts.profile && buildOf(opts.profile)) return opts.profile
  const fit = compatibleBuilds(profiles(), files, kind, opts.versions, opts.loaders)
  const scoped = useMods.getState().targetBuild
  if (!opts.fromLink && scoped && fit.includes(scoped)) return scoped
  const newest = files[0]
  const preset = {
    version: (opts.versions && opts.versions[0]) || (newest && (newest.primaryGameVersion || newest.gameVersions[0])) || undefined,
    loader: loaderMatters(kind) ? (opts.loaders && opts.loaders[0]) || (newest && newest.loaders[0]) || undefined : undefined,
  }
  if (fit.length === 1) {
    if (!opts.fromLink) return fit[0]
    const pr = buildOf(fit[0])
    const ok = await uiConfirm(
      pr
        ? t('Поставить «{name}» в сборку «{pack}» ({version} · {loader})?', { name: title, pack: fit[0] ?? '', version: pr.version, loader: LOADER_NAME(pr) })
        : t('Поставить «{name}» в сборку «{pack}»?', { name: title, pack: fit[0] ?? '' }),
      { title: 'Millida', confirmLabel: t('Поставить'), danger: false },
    )
    return ok ? fit[0] : null
  }
  // Подходящих нет — показываем все сборки: поставить можно и так, но спросим.
  return pickBuild(ruKind()[kind] || t('контент'), fit.length ? { only: fit, preset } : { preset })
}

async function mrVersionBySha1(sha1: string | null): Promise<string | null> {
  if (!sha1) return null
  try {
    const r = await fetch(MODRINTH_API + '/v2/version_file/' + encodeURIComponent(sha1) + '?algorithm=sha1')
    if (!r.ok) return null
    const v = await r.json()
    return typeof v.id === 'string' ? v.id : null
  } catch {
    return null
  }
}

function done(prof: string, kind: string, file: string, warning?: string) {
  void useMods.getState().refreshInstalled()
  showToast(
    kind === 'world'
      ? t('Карта «{map}» → «{pack}»: заходи в одиночную игру', { map: file, pack: prof })
      : t('{kind} → «{pack}»: {file}', { kind: ruKind()[kind] || t('Контент'), pack: prof, file }) + (warning ? ' · ' + warning : ''),
    'ok',
    'install',
  )
}

/// Тот же файл через Modrinth-путь лаунчера: точная версия по sha1 карточки,
/// а если её не нашлось — лучшая под сборку.
async function viaModrinth(prof: string, kind: string, mr: string, file: CatalogFile, title: string): Promise<boolean> {
  const pr = buildOf(prof)
  const vid = await mrVersionBySha1(file.sha1)
  const extras = vid ? await askPlanForVersion(prof, kind, 'modrinth', mr, vid) : []
  if (!extras) return false
  const startedAt = performance.now()
  return runInstall({
    key: keyContent('mr', prof, kind, mr),
    title,
    running: t('Скачивание…'),
    versionId: vid || undefined,
    run: () => (vid ? installVersion(mr, vid, prof, kind) : installContent(mr, (pr && pr.version) || '', prof, kind, true)),
    onDone: (r) => {
      trackTimed('content_install', startedAt, { name: title, kind, mc: (pr && pr.version) || '', source: 'millida-mr' })
      installExtras(prof, kind, extras)
      done(prof, kind, r.file, r.warning)
    },
    onError: (e) => showToast('' + e, 'error'),
  })
}

/// The same project through the launcher's CurseForge path, for cards imported from CurseForge
/// whose files are not mirrored. The catalog file already passed the version check above.
function viaCurseforge(prof: string, kind: string, cfid: number, file: CatalogFile, title: string): boolean {
  const pr = buildOf(prof)
  const startedAt = performance.now()
  return runInstall<ContentInstall>({
    key: keyContent('cf', prof, kind, cfid),
    title,
    running: t('Скачивание…'),
    run: () => cfInstall(cfid, (pr && pr.version) || '', prof, kind, cfFileIdOf(file.origin) ?? undefined, true),
    onDone: (r) => {
      trackTimed('content_install', startedAt, { name: title, kind, mc: (pr && pr.version) || '', source: 'millida-cf' })
      done(prof, kind, r.file, r.warning)
    },
    onError: (e) => showToast('' + e, 'error'),
  })
}

/// Файл с нашего зеркала. Обязательные зависимости карточки ставятся следом в
/// ту же сборку — у материалов не с Modrinth их больше никто не поставит.
function viaMirror(prof: string, kind: string, item: CatalogItem, file: CatalogFile, opts: CatalogInstallOpts): boolean {
  const startedAt = performance.now()
  const req: CatalogInstallReq = {
    slug: item.slug,
    title: item.title,
    icon: item.icon || '',
    via: 'file',
    article: item.articleSlug || '',
    fileId: file.id,
    profile: prof,
    kind,
    versionLabel: file.version,
    sha1: file.sha1 || '',
    size: file.size,
  }
  return runInstall({
    key: keyMillida(prof, kind, item.slug),
    title: item.title,
    running: t('Скачивание…'),
    versionId: file.id,
    run: () => catalogInstall(req),
    onDone: (r) => {
      trackTimed('content_install', startedAt, { name: item.title, kind, source: 'millida' })
      done(prof, kind, r.file)
      const seen = opts.seen || new Set<string>()
      seen.add(item.slug)
      const deps = ((item.dependencies && item.dependencies.requires) || []).filter(
        (d) => d.kind === 'REQUIRED' && d.slug && d.section === 'mods' && !seen.has(d.slug),
      )
      for (const d of deps) {
        seen.add(d.slug!)
        void installFromCatalog('mods', d.slug!, { profile: prof, seen })
      }
    },
    onError: (e) => showToast('' + e, 'error'),
  })
}

const PLAN_KINDS = ['mod', 'resourcepack', 'shader', 'datapack']

/// Установка по плану API вместе с зависимостями (как install_project_with_dependencies
/// у Modrinth App). `null` — плана нет (эндпоинт ещё не выкачен, 404, сеть) или в
/// нём нет самого материала под эту сборку: тогда идёт прежний путь одного файла.
async function viaPlan(prof: string, kind: string, item: CatalogItem): Promise<boolean | null> {
  const pr = buildOf(prof)
  if (!pr) return null
  const plan = await catalog.resolve(item.slug, pr.version, loaderId(pr)).catch(() => null)
  if (!plan) return null
  const dep = planToDepPlan(plan, item.slug, item.title)
  if (!dep) return null
  let optional: string[] = []
  // Одним нажатием, если решать нечего: ни зависимостей, ни пропажи.
  if (dep.required.length || dep.optional.length || dep.missing.length) {
    const d = await askDepPlan(dep)
    if (!d.go) return false
    optional = d.extras.map((x) => x.project_id)
  }
  const startedAt = performance.now()
  return runInstall({
    key: keyMillida(prof, kind, item.slug),
    title: item.title,
    running: t('Скачивание…'),
    run: () =>
      catalogInstallPlan({ slug: item.slug, title: item.title, icon: item.icon || '', profile: prof, kind, optional }),
    onDone: (r) => {
      trackTimed('content_install', startedAt, { name: item.title, kind, mc: pr.version, source: 'millida-plan' })
      const extra = r.installed.length ? (r.installed.length === 1 ? t('и ещё {n} зависимость', { n: 1 }) : t('и ещё {n} зависимости', { n: r.installed.length })) : ''
      done(prof, kind, r.file, extra)
      if (r.missing.length)
        showToast(t('Нет в каталоге Millida, поставь вручную: {list}', { list: r.missing.join(', ') }), 'error', undefined, {
          label: t('Открыть'),
          run: () => openExt(sitePage(item.section || 'mods', item.slug)),
        })
    },
    onError: (e) => showToast('' + e, 'error'),
  })
}

async function installContentItem(section: string, slug: string, kind: string, opts: CatalogInstallOpts): Promise<boolean> {
  let item: CatalogItem
  try {
    item = await catalog.item(slug)
  } catch {
    notFound(section, slug)
    return false
  }
  const files = opts.fileId ? item.files.filter((f) => f.id === opts.fileId) : item.files
  if (!files.length) {
    toSite(section, slug, t('У «{name}» пока нет файлов для лаунчера', { name: item.title }))
    return false
  }
  const prof = await chooseBuild(item.title, kind, files, opts)
  if (!prof) return false
  // Выбранная руками версия ставится как выбрана; иначе — план с зависимостями.
  if (!opts.fileId && PLAN_KINDS.includes(kind)) {
    const planned = await viaPlan(prof, kind, item)
    if (planned !== null) return planned
  }
  const pr = buildOf(prof)
  const gv = (pr && pr.version) || ''
  let file = pickFile(files, gv, loaderId(pr), kind)
  if (!file) {
    // Файл под другую версию запускается и роняет игру — решает человек.
    const ok = await uiConfirm(
      t('«{name}» нет под {target} — есть только под {versions}. Такой файл обычно не даёт игре запуститься. Поставить всё равно?', {
        name: item.title,
        target: pr ? pr.version + ' · ' + LOADER_NAME(pr) : t('эту сборку'),
        versions: knownVersions(files) || t('другие версии'),
      }),
      { title: t('Версия не совпадает'), confirmLabel: t('Поставить'), danger: true },
    )
    if (!ok) return false
    file = pickFile(files, '', loaderId(pr), kind) || files[0]
  }
  const mr = kind === 'world' ? null : modrinthSlugOf(item.sourceUrl)
  if (kind === 'mod' && mr) return viaModrinth(prof, kind, mr, file, item.title)
  if (file.mirrored && item.articleSlug) return viaMirror(prof, kind, item, file, opts)
  if (mr) return viaModrinth(prof, kind, mr, file, item.title)
  const cfid = kind === 'world' ? null : await cfProjectOf(item)
  if (cfid) return viaCurseforge(prof, kind, cfid, file, item.title)
  toSite(section, slug, t('Файла «{name}» нет на зеркале Millida — он у автора', { name: item.title }))
  return false
}

function packDone(p: Profile | null, title: string, startedAt: number, source: string) {
  if (!p) return
  trackTimed('modpack_install', startedAt, { name: title, kind: 'modpack', mc: p.version, loader: loaderId(p), source })
  useProfiles.getState().setSelected(p.name)
  void useProfiles.getState().refresh()
  showToast(t('Сборка «{name}» готова — жми «Играть»', { name: p.name }), 'ok', 'achievement')
}

async function confirmPack(title: string, what: string, opts: CatalogInstallOpts): Promise<boolean> {
  if (!opts.fromLink) return true
  return uiConfirm(what ? t('Установить сборку «{name}» ({what})? Она появится отдельной сборкой.', { name: title, what }) : t('Установить сборку «{name}»? Она появится отдельной сборкой.', { name: title }), {
    title: 'Millida',
    confirmLabel: t('Установить'),
    danger: false,
  })
}

/// Сборка, которую собрала Милли и выложили в каталог (`aiGenerated`): файла
/// на зеркале нет, есть код сборки лаунчера. Ставит её тот же путь ядра, что и
/// «Сборка по коду» / millida://pack/<код> — `install_shared_pack`.
export async function installPackCode(code: string, title: string, opts: CatalogInstallOpts = {}, slug = code): Promise<boolean> {
  if (!hasTauri()) {
    showToast(t('Установка доступна в приложении'))
    return false
  }
  if (!(await confirmPack(title, '', opts))) return false
  const startedAt = performance.now()
  return runInstall({
    key: keyMillidaModpack(slug),
    title,
    running: t('Скачивание…'),
    run: () => installSharedPack(code),
    onDone: (p) => packDone(p, title, startedAt, 'millida-code'),
    onError: (e) => showToast('' + e, 'error'),
  })
}

/// Код сборки Милли, если он есть у карточки: только у `aiGenerated`.
export const aiPackCode = (item: { aiGenerated?: boolean; packCode?: string | null } | null | undefined): string | null =>
  item && item.aiGenerated && item.packCode ? item.packCode : null

async function installModpackItem(slug: string, opts: CatalogInstallOpts): Promise<boolean> {
  const item = await catalog.item(slug).catch(() => null)
  const code = aiPackCode(item)
  if (item && code) return installPackCode(code, item.title, opts, slug)
  // Готовая сборка лаунчера (launcherOnly: FreshCraft, Lost Souls…): файла
  // наружу нет, только подписанная ссылка на аккаунт. Ставит её тот же путь
  // ядра, что и вкладка «Сборки» — install_catalog_pack.
  if (!item || item.launcherOnly) {
    const pack = await catalog.pack(slug).catch(() => null)
    if (!pack) {
      notFound('modpacks', slug)
      return false
    }
    if (!pack.files.some((f) => f.side === 'client')) {
      toSite('modpacks', slug, t('У сборки «{name}» нет файла для игры', { name: pack.title }))
      return false
    }
    if (!hasMillidaAccount()) {
      showToast(t('Войди в аккаунт Millida — сборки каталога ставятся на аккаунт'), 'error')
      return false
    }
    if (!(await confirmPack(pack.title, [pack.game, pack.loader].filter(Boolean).join(' · '), opts))) return false
    return installOwnPack(slug, pack.title)
  }
  const files = opts.fileId ? item.files.filter((f) => f.id === opts.fileId) : item.files
  const file =
    pickFile(files, (opts.versions && opts.versions[0]) || '', (opts.loaders && opts.loaders[0]) || '', 'modpack') || files[0]
  const mr = modrinthSlugOf(item.sourceUrl)
  const what = file ? [file.primaryGameVersion, file.loaders[0]].filter(Boolean).join(' · ') : ''
  const startedAt = performance.now()
  if (file && file.mirrored && item.articleSlug && /\.(mrpack|zip)$/i.test(file.fileName)) {
    if (!(await confirmPack(item.title, what, opts))) return false
    return runInstall({
      key: keyMillidaModpack(slug),
      title: item.title,
      running: t('Скачивание…'),
      versionId: file.id,
      run: () =>
        catalogInstall({
          slug,
          title: item.title,
          icon: item.icon || '',
          via: 'file',
          article: item.articleSlug!,
          fileId: file.id,
          kind: 'modpack',
          versionLabel: file.version,
          sha1: file.sha1 || '',
          size: file.size,
          game: file.primaryGameVersion || '',
          loader: file.loaders[0] || '',
        }),
      onDone: (r) => packDone(r.profile, item.title, startedAt, 'millida'),
      onError: (e) => showToast('' + e, 'error'),
    })
  }
  if (mr) {
    if (!(await confirmPack(item.title, what, opts))) return false
    const vid = file ? await mrVersionBySha1(file.sha1) : null
    return runInstall({
      key: keyMrModpack(mr),
      title: item.title,
      running: t('Скачивание…'),
      versionId: vid || undefined,
      run: () => (vid ? installModpackVersion(mr, vid) : installModpack(mr)),
      onDone: (p) => packDone(p, item.title, startedAt, 'millida-mr'),
      onError: (e) => showToast('' + e, 'error'),
    })
  }
  const cfid = await cfProjectOf(item)
  if (cfid) {
    if (!(await confirmPack(item.title, what, opts))) return false
    const cfFile = file ? cfFileIdOf(file.origin) : null
    return runInstall({
      key: keyCfModpack(cfid),
      title: item.title,
      running: t('Скачивание…'),
      run: () => cfInstallModpack(cfid, cfFile ?? undefined),
      onDone: (p) => packDone(p, item.title, startedAt, 'millida-cf'),
      onError: (e) => showToast('' + e, 'error'),
    })
  }
  toSite('modpacks', slug, t('Файла сборки «{name}» нет на зеркале Millida', { name: item.title }))
  return false
}

/// Скин каталога сайта — в гардероб аккаунта и сразу надеть. Гардероб живёт на
/// аккаунте Millida, без входа надеть его некуда.
async function applySkin(slug: string, opts: CatalogInstallOpts): Promise<boolean> {
  setScreen('skins')
  if (!hasMillidaAccount()) {
    showToast(t('Войди в аккаунт Millida, чтобы надеть скин'), 'error')
    return false
  }
  const name = opts.name || slug
  if (opts.fromLink) {
    const ok = await uiConfirm(t('Надеть скин «{name}»?', { name }), { title: 'Millida', confirmLabel: t('Надеть'), danger: false })
    if (!ok) return false
  }
  try {
    const png = (await fetchSkinPng(slug)).replace(/^data:image\/png;base64,/, '')
    // A card without the slim mark is not a Steve skin: the arms are read from the texture.
    const slim = opts.slim ?? (await detectSlimFromUrl('data:image/png;base64,' + png).catch(() => false))
    const item = await addToWardrobe({ kind: 'skin', name, pngBase64: png, source: 'catalog', ...(slim ? { slim: true } : {}) })
    await applyWardrobeItem(item.id)
    showToast(t('Скин надет — виден в игре после перезахода'), 'ok', 'install')
    return true
  } catch (e) {
    showToast(t('Не удалось надеть скин: {error}', { error: tx(e) }), 'error')
    return false
  }
}

/// Карточка каталога, которой уже нет (скрыта или удалена), — тот же адрес как ник:
/// шестнадцать hex-символов бывают и ником.
async function fetchSkinPng(slug: string): Promise<string> {
  try {
    return await fetchTexture(skinTextureUrl(slug))
  } catch (e) {
    if (!isCatalogSkinId(slug) || !/\b404\b/.test(String(e))) throw e
    return fetchTexture(nickSkinTextureUrl(slug))
  }
}

/// Плащи сайта — это плащи Mojang и OptiFine: их выдаёт не лаунчер. Надеть
/// можно только плащ из каталога Millida, если он открыт на аккаунте.
async function applyCape(slug: string): Promise<boolean> {
  setScreen('skins')
  if (!hasMillidaAccount()) {
    showToast(t('Войди в аккаунт Millida, чтобы надеть плащ'), 'error')
    return false
  }
  const list = await loadCapeCatalog().catch(() => [])
  const cape = list.find((c) => c.id === slug)
  if (!cape) {
    showToast(t('Этот плащ выдаёт Mojang, а не лаунчер — плащи Millida во вкладке «Скины»'))
    return false
  }
  if (cape.unlocked === false) {
    showToast(cape.requirement ? t('Плащ «{name}» ещё закрыт: {why}', { name: cape.name, why: cape.requirement }) : t('Плащ «{name}» ещё закрыт', { name: cape.name }))
    return false
  }
  try {
    await applyCatalogCape(cape.id)
    showToast(t('Плащ «{name}» надет', { name: cape.name }), 'ok', 'install')
    return true
  } catch (e) {
    showToast(t('Не удалось надеть плащ: {error}', { error: tx(e) }), 'error')
    return false
  }
}

export async function installFromCatalog(section: string, slug: string, opts: CatalogInstallOpts = {}): Promise<boolean> {
  if (!hasTauri()) {
    showToast(t('Установка доступна в приложении'))
    return false
  }
  if (section === 'skins') return applySkin(slug, opts)
  if (section === 'capes') return applyCape(slug)
  if (section === 'modpacks') return installModpackItem(slug, opts)
  const kind = KIND_OF_SECTION[section]
  if (!kind) {
    toSite(section, slug, t('Этот раздел лаунчер не ставит'))
    return false
  }
  return installContentItem(section, slug, kind, opts)
}

/// Готовая сборка лаунчера — одна точка для строки каталога, окна материала и
/// ссылки с сайта. Платная упирается в доступ: тогда открывается окно ключа, и
/// после активации установка продолжается сама, а не просит нажать ещё раз.
export function installOwnPack(slug: string, title: string): boolean {
  const startedAt = performance.now()
  return runInstall({
    key: keyCatalogPack(slug),
    title: title || slug,
    running: t('Скачивание…'),
    run: () => installCatalogPack(slug),
    onError: (e) => {
      const text = String(e)
      if (text.startsWith(PACK_ACCESS_PREFIX)) {
        usePackKey.getState().show(slug, title, text.slice(PACK_ACCESS_PREFIX.length), () => installOwnPack(slug, title))
        return
      }
      showToast(text, 'error')
    },
    onDone: (p) => packDone(p, title, startedAt, 'millida'),
  })
}
