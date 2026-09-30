import { create } from 'zustand'
import { cfFiles, cfProject } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { fmt } from '../lib/format'
import { MODRINTH_API, mirrorAsset } from '../lib/api'
import { blocksToMarkdown, catalog, cleanTitle, sitePage } from '../lib/millidaCatalog'
import { openModal } from './ui'
import { useMods } from './mods'

export interface ProjectVersion {
  id: string
  name: string
  game_versions?: string[]
  loaders?: string[]
  // CurseForge addresses files by number, Modrinth by version id string.
  cfFileId?: number
  size?: number
  release?: number
}

export interface ProjectGallery {
  url: string
  title?: string
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
  website: string
  loading: boolean
  game: string | null
  set: (patch: Partial<ProjectState>) => void
}

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
  website: '',
  loading: false,
  game: null,
  set: (patch) => set(patch as ProjectState),
}))

const RU_RELEASE: Record<number, string> = { 1: 'релиз', 2: 'бета', 3: 'альфа' }

export async function openCfProject(cfid: number, kind?: string, fallbackTitle?: string) {
  const k = kind || useMods.getState().modTab
  useProject.getState().set({
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
    useProject.getState().set({ loading: false, title: 'Не удалось загрузить', sub: '' + e })
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
          loaders: f.loaders.concat(RU_RELEASE[f.release] && f.release !== 1 ? [RU_RELEASE[f.release]] : []),
          size: f.size,
          release: f.release,
        })),
    })
  } catch {}
}

export async function openProject(slug: string, kind?: string, game?: string | null) {
  const s = useProject.getState()
  s.set({
    slug,
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
  try {
    const p = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(slug)).then((r) => r.json())
    useProject.getState().set({
      icon: mirrorAsset(p.icon_url) || '',
      title: p.title,
      sub:
        fmt(p.downloads) +
        ' скачиваний · ' +
        fmt(p.followers || 0) +
        ' подписчиков · ' +
        ((p.license && p.license.id) || '—'),
      tags: (p.categories || []).slice(0, 6),
      body: p.body || '',
      gallery: (p.gallery || []).map((g: ProjectGallery) => ({ ...g, url: mirrorAsset(g.url) || g.url })),
      website: 'https://modrinth.com/project/' + slug,
      loading: false,
    })
    const vers = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(slug) + '/version').then((r) =>
      r.json(),
    )
    useProject.getState().set({ versions: vers })
  } catch {
    useProject.getState().set({ title: 'Не удалось загрузить', loading: false })
  }
}

/// Карточка каталога Millida в том же окне материала. Готовой сборки каталога в
/// общей карточке может не быть (её текст ещё не вышел) — тогда берём витрину сборки.
export async function openMillidaProject(slug: string, section: string, kind?: string, fallbackTitle?: string) {
  useProject.getState().set({
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
      body: blocksToMarkdown(p.description) || p.summary || '',
      gallery: (p.gallery || []).map((url) => ({ url })),
      versions: (p.files || []).slice(0, 40).map((f) => ({
        id: f.id,
        name: f.version,
        game_versions: f.gameVersions,
        loaders: f.loaders,
        size: f.size,
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
        body: pk.summary || '',
        versions: pk.files
          .filter((f) => f.side === 'client')
          .map((f) => ({ id: f.id, name: f.version, game_versions: [pk.game], loaders: [pk.loader], size: f.size })),
        loading: false,
      })
      return
    } catch {}
  }
  useProject.getState().set({ loading: false, title: fallbackTitle || 'Не удалось загрузить', sub: '' })
}
