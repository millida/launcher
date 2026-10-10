import { api, mirrorAsset, MODRINTH_API } from './api'
import { DEFAULT_ICON } from './buildIcon'
import { loadProfileSettings, setProfileIcon } from '../ipc/commands'
import type { Profile } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { useProfiles } from '../state/profiles'

/*
 * У сборки из каталога (Arcania, сборки Millida, модпаки Modrinth) — её родной значок,
 * записанный в саму сборку (владелец 10.10.2026: «если у сборки есть значок — он и
 * должен быть, на уровне базы»). Ядро ставит его при установке, но у сборок, поставленных
 * раньше или премиум-путём, поля нет — дописываем один раз. Своя иконка игрока не трогается:
 * только пустая или старая полка по умолчанию.
 */

const tried = new Set<string>()

const isAuto = (icon?: string | null) => !icon || icon === DEFAULT_ICON || icon.startsWith('/bg/')

async function catalogIcon(slug: string): Promise<string | null> {
  const view = await api<{ icon?: string | null; cover?: string | null }>('/catalog/packs/' + encodeURIComponent(slug)).catch(() => null)
  if (view && view.icon) return view.icon
  const item = await api<{ icon?: string | null }>('/catalog/items/' + encodeURIComponent(slug)).catch(() => null)
  return (item && item.icon) || null
}

async function modrinthIcon(slug: string): Promise<string | null> {
  const r = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(slug)).catch(() => null)
  if (!r || !r.ok) return null
  const p = (await r.json().catch(() => null)) as { icon_url?: string | null } | null
  return p && p.icon_url ? mirrorAsset(p.icon_url) || p.icon_url : null
}

export async function backfillPackIcons(profiles: Profile[]): Promise<void> {
  if (!hasTauri()) return
  for (const p of profiles) {
    if (!isAuto(p.icon) || tried.has(p.name)) continue
    tried.add(p.name)
    const st = await loadProfileSettings(p.name).catch(() => null)
    const slug = st && (st.catalogPackSlug || st.modpackSlug)
    if (!slug) continue
    const icon = st!.catalogPackSlug ? await catalogIcon(slug) : await modrinthIcon(slug)
    if (!icon) continue
    // Пока ходили в сеть, игрок мог выбрать иконку сам — её не перетираем.
    const now = useProfiles.getState().profiles.find((x) => x.name === p.name)
    if (!now || !isAuto(now.icon)) continue
    const list = await setProfileIcon(p.name, icon).catch(() => null)
    if (Array.isArray(list)) useProfiles.setState({ profiles: list })
  }
}
