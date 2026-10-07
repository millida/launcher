import { create } from 'zustand'
import { cfFiles, cfProject } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { fmt } from '../lib/format'
import { MODRINTH_API, mirrorAsset } from '../lib/api'
import { blocksToMarkdown, catalog, cleanTitle, sitePage } from '../lib/millidaCatalog'
import { openModal } from './ui'
import { useMods } from './mods'
import { orderGallery } from '../modals/projectView'
import type { LicenseInfo } from '../modals/projectView'

export interface ProjectVersion {
  id: string
  name: string
  game_versions?: string[]
  loaders?: string[]
  // CurseForge addresses files by number, Modrinth by version id string.
  cfFileId?: number
  size?: number
  release?: number
  /** Номер версии автора («2.1.4»), когда имя файла длиннее. */
  number?: string
  /** release | beta | alpha */
  type?: string
  /** ISO-дата выхода файла. */
  date?: string | null
  downloads?: number
  /** Зависимости файла (Modrinth): id проекта и вид — required/optional/incompatible/embedded. */
  deps?: { id: string; type: string }[]
}

export interface ProjectGallery {
  url: string
  title?: string
  description?: string
  /** Полный размер для просмотра на весь экран (Modrinth raw_url). */
  raw?: string
  featured?: boolean
  ordering?: number
}

/** Ссылка проекта: исходники, вики, Discord, поддержать автора. */
export interface ProjectLink {
  kind: 'source' | 'wiki' | 'issues' | 'discord' | 'donate'
  label: string
  url: string
}

/**
 * Откуда открыли окно. Сейчас — карточка сборки Милли: окно показывает, что мод
 * в сборке, и даёт убрать его/вернуть, не возвращаясь в чат. Поле необязательное:
 * каждый openProject/openCfProject/openMillidaProject без него сбрасывает его в null.
 */
export interface ProjectCtx {
  from: 'milli'
  /** Мод сейчас в сборке (не выключен игроком). */
  inPack: boolean
  /** Нужен для запуска — убрать нельзя. */
  locked?: boolean
  /** Название сборки Милли — для подписи «В сборке «…»». */
  packTitle?: string
  /** Зачем Милли взяла этот мод (MilliItem.why). */
  why?: string
  /** Названия модов сборки, которым нужен этот мод (он их зависимость). */
  neededBy?: string[]
  /** Убрать/вернуть мод в сборке Милли. Нет — кнопки нет (сборка уже ставится). */
  onToggle?: () => void
  /**
   * Мод из верстака: «Убрать/Вернуть» идёт через стор сборки (`benchOp`), а
   * «в сборке ли» окно читает из головы ревизии — карточка может уже размонтироваться.
   */
  bench?: { projectId: string; tab: 'mods' | 'resourcepacks' | 'shaders' }
  /** Вернуться к сборке (открыть Милли обратно). */
  onBack?: () => void
}

export interface OpenProjectOpts {
  ctx?: ProjectCtx | null
}

interface ProjectState {
  slug: string
  kind: string
  tab: string
  title: string
  icon: string
  sub: string
  tags: string[]
  body: string
  gallery: ProjectGallery[]
  versions: ProjectVersion[]
  source: string
  /// Раздел каталога Millida, когда source === 'millida'.
  section: string
  /// Готовая сборка лаунчера: ставится install_catalog_pack, ключ задачи свой.
  launcherOnly: boolean
  cfid: number
  /// Modrinth project id: an installed mod is recorded under it, not under the slug.
  projectId: string
  website: string
  loading: boolean
  game: string | null
  /** Загрузка не удалась — окно показывает «Повторить». */
  failed: boolean
  /** Короткое описание автора (одна строка под названием). */
  summary: string
  author: string
  authorUrl: string
  downloads: number | null
  followers: number | null
  license: LicenseInfo | null
  /** ISO-даты. */
  updated: string | null
  published: string | null
  loaders: string[]
  gameVersions: string[]
  links: ProjectLink[]
  clientSide: string
  serverSide: string
  /** Фирменный цвет проекта (Modrinth `color`) — подложка шапки без картинок. */
  color: number | null
  ctx: ProjectCtx | null
  set: (patch: Partial<ProjectState>) => void
}

/// Поля, которые каждое открытие окна обязано сбросить: иначе у нового мода
/// оставались автор, лицензия и контекст Милли от предыдущего.
const FRESH = (): Partial<ProjectState> => ({
  projectId: '',
  failed: false,
  summary: '',
  author: '',
  authorUrl: '',
  downloads: null,
  followers: null,
  license: null,
  updated: null,
  published: null,
  loaders: [],
  gameVersions: [],
  links: [],
  clientSide: '',
  serverSide: '',
  color: null,
  ctx: null,
})

export const useProject = create<ProjectState>((set) => ({
  slug: '',
  kind: 'mod',
  tab: 'desc',
  title: '—',
  icon: '',
  sub: '—',
  tags: [],
  body: '',
  gallery: [],
  versions: [],
  source: 'modrinth',
  section: '',
  launcherOnly: false,
  cfid: 0,
  projectId: '',
  website: '',
  loading: false,
  game: null,
  failed: false,
  summary: '',
  author: '',
  authorUrl: '',
  downloads: null,
  followers: null,
  license: null,
  updated: null,
  published: null,
  loaders: [],
  gameVersions: [],
  links: [],
  clientSide: '',
  serverSide: '',
  color: null,
  ctx: null,
  set: (patch) => set(patch as ProjectState),
}))

const RELEASE_TYPE: Record<number, string> = { 1: 'release', 2: 'beta', 3: 'alpha' }

interface MrVersion {
  id: string
  name?: string
  version_number?: string
  game_versions?: string[]
  loaders?: string[]
  version_type?: string
  date_published?: string
  downloads?: number
  files?: { size?: number; primary?: boolean }[]
  dependencies?: { project_id?: string | null; dependency_type?: string }[]
}

interface MrGallery {
  url: string
  raw_url?: string
  title?: string | null
  description?: string | null
  featured?: boolean
  ordering?: number
}

function mrLinks(p: {
  source_url?: string | null
  wiki_url?: string | null
  issues_url?: string | null
  discord_url?: string | null
  donation_urls?: { platform?: string; url?: string }[] | null
}): ProjectLink[] {
  const out: ProjectLink[] = []
  if (p.source_url) out.push({ kind: 'source', label: 'Исходный код', url: p.source_url })
  if (p.wiki_url) out.push({ kind: 'wiki', label: 'Вики', url: p.wiki_url })
  if (p.discord_url) out.push({ kind: 'discord', label: 'Discord', url: p.discord_url })
  if (p.issues_url) out.push({ kind: 'issues', label: 'Сообщить об ошибке', url: p.issues_url })
  const d = (p.donation_urls || []).find((x) => x && x.url)
  if (d && d.url) out.push({ kind: 'donate', label: 'Поддержать автора' + (d.platform ? ' · ' + d.platform : ''), url: d.url })
  return out
}

/// Автор: в карточке проекта Modrinth его нет (только id команды), а ручку
/// members наш прокси не пускает — берём из поиска по id проекта, как подсказка Милли.
async function mrAuthor(projectId: string): Promise<{ author: string; authorUrl: string } | null> {
  const facets = encodeURIComponent(JSON.stringify([['project_id:' + projectId]]))
  const r = await fetch(MODRINTH_API + '/v2/search?limit=1&facets=' + facets).then((x) => x.json())
  const h = r && Array.isArray(r.hits) ? r.hits[0] : null
  if (!h) return null
  const org = typeof h.organization === 'string' ? h.organization : ''
  const author = org || h.author || ''
  if (!author) return null
  return {
    author,
    authorUrl: org
      ? 'https://modrinth.com/organization/' + encodeURIComponent(org)
      : 'https://modrinth.com/user/' + encodeURIComponent(author),
  }
}

export async function openCfProject(cfid: number, kind?: string, fallbackTitle?: string) {
  const k = kind || useMods.getState().modTab
  useProject.getState().set({
    ...FRESH(),
    slug: '',
    cfid,
    source: 'curseforge',
    kind: k,
    tab: 'desc',
    title: fallbackTitle || 'Загружаем…',
    icon: '',
    sub: 'Загружаем…',
    body: '',
    gallery: [],
    versions: [],
    tags: [],
    website: '',
    loading: true,
    game: null,
  })
  openModal('pjModal')
  if (!hasTauri()) {
    useProject.getState().set({ loading: false, sub: 'Каталог CurseForge доступен в приложении' })
    return
  }
  try {
    const p = await cfProject(cfid)
    useProject.getState().set({
      icon: mirrorAsset(p.logo) || '',
      title: p.name,
      summary: p.summary || '',
      author: p.authors || '',
      downloads: p.downloads,
      updated: p.updated || null,
      gameVersions: p.game_versions || [],
      sub:
        fmt(p.downloads) +
        ' скачиваний' +
        (p.authors ? ' · ' + p.authors : '') +
        (p.updated ? ' · обновлён ' + p.updated.slice(0, 10).split('-').reverse().join('.') : ''),
      tags: p.categories.slice(0, 6),
      body: p.description || p.summary,
      gallery: p.gallery.map((g) => ({ ...g, url: mirrorAsset(g.url) || g.url })),
      website: p.website,
      loading: false,
    })
  } catch (e) {
    useProject.getState().set({ loading: false, failed: true, title: 'Не удалось загрузить', sub: '' + e })
    return
  }
  try {
    const files = await cfFiles(cfid)
    useProject.getState().set({
      versions: files
        .filter((f) => !f.server_pack)
        .slice(0, 30)
        .map((f) => ({
          id: 'cf' + f.id,
          cfFileId: f.id,
          name: f.name || f.file_name,
          game_versions: f.game_versions,
          loaders: f.loaders,
          size: f.size,
          release: f.release,
          type: RELEASE_TYPE[f.release] || 'release',
          date: f.date || null,
        })),
    })
  } catch {}
}

export async function openProject(slug: string, kind?: string, game?: string | null, opts?: OpenProjectOpts) {
  const s = useProject.getState()
  s.set({
    ...FRESH(),
    ctx: (opts && opts.ctx) || null,
    slug,
    section: '',
    launcherOnly: false,
    icon: '',
    sub: '',
    source: 'modrinth',
    cfid: 0,
    kind: kind || useMods.getState().modTab,
    tab: 'desc',
    title: 'Загружаем…',
    body: '',
    gallery: [],
    versions: [],
    tags: [],
    website: '',
    loading: true,
    game: game || null,
  })
  openModal('pjModal')
  // Окно могли успеть открыть на другом моде: ответ старого запроса не пишем поверх.
  const still = () => useProject.getState().slug === slug && useProject.getState().source === 'modrinth'
  try {
    const p = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(slug)).then((r) => r.json())
    if (!still()) return
    if (!p || !p.id) throw new Error('no project')
    useProject.getState().set({
      projectId: p.id,
      icon: mirrorAsset(p.icon_url) || '',
      title: p.title,
      sub:
        fmt(p.downloads) +
        ' скачиваний · ' +
        fmt(p.followers || 0) +
        ' подписчиков · ' +
        ((p.license && p.license.id) || '—'),
      summary: p.description || '',
      downloads: typeof p.downloads === 'number' ? p.downloads : null,
      followers: typeof p.followers === 'number' ? p.followers : null,
      license: p.license && p.license.id ? { id: p.license.id, name: p.license.name || '', url: p.license.url || null } : null,
      updated: p.updated || null,
      published: p.published || null,
      loaders: p.loaders || [],
      gameVersions: p.game_versions || [],
      links: mrLinks(p),
      clientSide: p.client_side || '',
      serverSide: p.server_side || '',
      color: typeof p.color === 'number' ? p.color : null,
      tags: [...(p.categories || []), ...(p.additional_categories || [])]
        .filter((c: string, i: number, a: string[]) => a.indexOf(c) === i)
        .slice(0, 8),
      body: p.body || '',
      gallery: orderGallery((p.gallery || []) as MrGallery[]).map((g) => ({
        url: mirrorAsset(g.url) || g.url,
        raw: g.raw_url ? mirrorAsset(g.raw_url) || g.raw_url : undefined,
        title: g.title || '',
        description: g.description || '',
        featured: !!g.featured,
      })),
      website: 'https://modrinth.com/project/' + slug,
      loading: false,
    })
    void mrAuthor(p.id)
      .then((a) => {
        if (a && still()) useProject.getState().set(a)
      })
      .catch(() => {})
    const vers: MrVersion[] = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(slug) + '/version').then((r) =>
      r.json(),
    )
    if (!still()) return
    useProject.getState().set({
      versions: (Array.isArray(vers) ? vers : []).map((v) => {
        const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0]
        return {
          id: v.id,
          name: v.name || v.version_number || v.id,
          number: v.version_number,
          game_versions: v.game_versions,
          loaders: v.loaders,
          type: v.version_type || 'release',
          date: v.date_published || null,
          downloads: v.downloads,
          size: file && file.size,
          deps: (v.dependencies || [])
            .filter((d) => d.project_id)
            .map((d) => ({ id: d.project_id as string, type: d.dependency_type || 'required' })),
        }
      }),
    })
  } catch {
    if (still()) useProject.getState().set({ title: 'Не удалось загрузить', loading: false, failed: true })
  }
}

/// Карточка каталога Millida в том же окне материала. Готовой сборки каталога в
/// общей карточке может не быть (её текст ещё не вышел) — тогда берём витрину сборки.
export async function openMillidaProject(slug: string, section: string, kind?: string, fallbackTitle?: string) {
  useProject.getState().set({
    ...FRESH(),
    slug,
    section,
    launcherOnly: false,
    source: 'millida',
    cfid: 0,
    kind: kind || useMods.getState().modTab,
    tab: 'desc',
    title: fallbackTitle || '',
    icon: '',
    sub: '',
    body: '',
    gallery: [],
    versions: [],
    tags: [],
    website: sitePage(section, slug),
    loading: true,
  })
  openModal('pjModal')
  try {
    const p = await catalog.item(slug)
    useProject.getState().set({
      icon: p.icon || p.cover || '',
      title: cleanTitle(p.title),
      launcherOnly: !!p.launcherOnly,
      sub:
        fmt(Math.max(p.downloads || 0, p.sourceDownloads || 0)) +
        ' скачиваний' +
        (p.author ? ' · ' + p.author : '') +
        (p.license ? ' · ' + p.license : ''),
      tags: (p.tags || []).slice(0, 6),
      summary: p.summary || '',
      author: p.author || '',
      downloads: Math.max(p.downloads || 0, p.sourceDownloads || 0),
      license: p.license ? { id: p.license } : null,
      updated: p.updatedAt || null,
      loaders: [...new Set((p.files || []).flatMap((f) => f.loaders || []))],
      gameVersions: [...new Set((p.files || []).flatMap((f) => f.gameVersions || []))],
      links: p.sourceUrl ? [{ kind: 'source', label: 'Страница автора', url: p.sourceUrl }] : [],
      body: blocksToMarkdown(p.description) || p.summary || '',
      gallery: (p.gallery || []).map((url) => ({ url })),
      versions: (p.files || []).slice(0, 40).map((f) => ({
        id: f.id,
        name: f.version,
        game_versions: f.gameVersions,
        loaders: f.loaders,
        size: f.size,
        date: f.releasedAt,
        downloads: f.downloads,
      })),
      loading: false,
    })
    return
  } catch {}
  if (section === 'modpacks') {
    try {
      const pk = await catalog.pack(slug)
      useProject.getState().set({
        icon: pk.cover || '',
        title: pk.title,
        launcherOnly: true,
        sub: [pk.game, pk.loader].filter(Boolean).join(' · '),
        summary: pk.summary || '',
        loaders: pk.loader ? [pk.loader] : [],
        gameVersions: pk.game ? [pk.game] : [],
        body: pk.summary || '',
        versions: pk.files
          .filter((f) => f.side === 'client')
          .map((f) => ({ id: f.id, name: f.version, game_versions: [pk.game], loaders: [pk.loader], size: f.size })),
        loading: false,
      })
      return
    } catch {}
  }
  useProject.getState().set({ loading: false, failed: true, title: fallbackTitle || 'Не удалось загрузить', sub: '' })
}

// ─── Мод из сборки Милли ─────────────────────────────────────────────────────

/** Модрин-тип проекта по вкладке верстака. */
const KIND_OF_TAB = { mods: 'mod', resourcepacks: 'resourcepack', shaders: 'shader' } as const

/**
 * Открыть мод из верстака или квитанции: запомнить прокрутку чата и списков,
 * свернуть Милли и открыть окно мода. Любое закрытие окна вернёт в тот же чат
 * (эффект закрытия в Project.tsx зовёт `onBack`), прокрутка восстановится.
 */
export async function openMilliItem(
  m: { projectId: string; slug: string; why?: string; base?: boolean },
  tab: 'mods' | 'resourcepacks' | 'shaders' = 'mods',
  extra: { neededBy?: string[]; locked?: boolean } = {},
) {
  const [{ benchHas, benchSaveScroll, useBench }, milli] = await Promise.all([import('./milliBench'), import('./milli')])
  benchSaveScroll()
  const head = useBench.getState().head
  const has = benchHas(m.projectId)
  milli.closeMilli()
  void openProject(m.slug, KIND_OF_TAB[tab], null, {
    ctx: {
      from: 'milli',
      inPack: has ? has.on : true,
      locked: extra.locked,
      packTitle: head?.title,
      why: m.why,
      neededBy: extra.neededBy,
      bench: { projectId: m.projectId, tab: has?.tab ?? tab },
      onBack: () => milli.openMilli({ src: 'project' }),
    },
  })
}
