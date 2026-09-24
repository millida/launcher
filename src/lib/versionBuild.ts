import { hasTauri } from '../ipc/tauri'
import {
  createProfile,
  fpsBoostState,
  millidaModInstall,
  millidaModState,
  setFpsBoost,
  setProfileLoader,
  toggleContent,
} from '../ipc/commands'
import type { Profile } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { MODRINTH_API, api, mirrorAsset } from './api'

/**
 * Сборка «Minecraft X» для полки версий «Во что играем» (приказ владельца
 * 23.09.2026): версия без сборки всё равно идёт на Fabric — на ванилле нет ни
 * нашей косметики, ни модов-ускорителей. Одна сборка на версию.
 *
 * FPS-моды ставит ядро режимом «Буст FPS» (engine/game/fpsboost.rs): Sodium,
 * Lithium, FerriteCore, EntityCulling, ImmediatelyFast, ModernFix — только то,
 * у чего на Modrinth есть файл под эту версию, остальное ядро пропускает.
 * Выключение здесь НЕ снимает моды (ядро при выключении режима их удаляет),
 * а переименовывает в .disabled: включить обратно — без скачивания.
 */

/** Имя сборки под версию. То же, что в lib/lobbyPlay.ts. */
export const versionBuildName = (version: string) => 'Minecraft ' + version

const FPS_KEY = 'm-ver-fps:'

/** FPS-мод по версии: включён, пока человек его не выключил. */
export function versionFps(version: string): boolean {
  try {
    return localStorage.getItem(FPS_KEY + version) !== '0'
  } catch {
    return true
  }
}

export function setVersionFps(version: string, on: boolean): void {
  try {
    localStorage.setItem(FPS_KEY + version, on ? '1' : '0')
  } catch {}
}

/**
 * Загрузчик версии: Fabric есть с 1.14, до неё — Forge (на 1.12.2 и 1.8.9
 * Fabric-сборка просто не запустится: загрузчика под них нет).
 */
export function versionLoader(version: string): 'fabric' | 'forge' {
  const [major = 0, minor = 0] = version.split('.').map((x) => Number(x) || 0)
  return major === 1 && minor < 14 ? 'forge' : 'fabric'
}

export const loaderTitle = (version: string) => (versionLoader(version) === 'forge' ? 'Forge' : 'Fabric')

/** Моды режима «Буст FPS» по загрузчику — тот же список, что в ядре (fpsboost.rs). */
const FPS_MODS: Record<'fabric' | 'forge', string[]> = {
  fabric: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix'],
  forge: ['embeddium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix'],
}

/** FPS-мод, у которого есть файл под версию: что покажет страница версии. */
export interface FpsMod {
  slug: string
  title: string
  icon: string | null
  summary: string
  /** Номер файла под эту версию. */
  file: string
}

const modsCache = new Map<string, Promise<FpsMod[] | null>>()
/**
 * FPS-моды с файлом под версию на Modrinth (под её загрузчик) — ровно то,
 * что поставит ядро. null — Modrinth не ответил: тогда ничего не обещаем,
 * но и не прячем режим — ядро само пропустит то, чего под версию нет.
 */
export function fpsMods(version: string): Promise<FpsMod[] | null> {
  const hit = modsCache.get(version)
  if (hit) return hit
  const loader = versionLoader(version)
  const get = <T,>(path: string) =>
    fetch(MODRINTH_API + path).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)))
  const one = async (slug: string): Promise<FpsMod | null> => {
    const files = await get<{ version_number: string }[]>(
      '/v2/project/' +
        slug +
        '/version?loaders=' +
        encodeURIComponent(JSON.stringify([loader])) +
        '&game_versions=' +
        encodeURIComponent(JSON.stringify([version])),
    )
    if (!Array.isArray(files) || !files.length) return null
    const p = await get<{ title: string; icon_url?: string | null; description?: string }>('/v2/project/' + slug).catch(
      () => ({ title: slug, icon_url: null, description: '' }),
    )
    return { slug, title: p.title, icon: mirrorAsset(p.icon_url) || null, summary: p.description || '', file: files[0]!.version_number }
  }
  const asked = Promise.all(FPS_MODS[loader].map((m) => one(m).then((x) => ({ x }), () => null))).then((all) =>
    all.every((r) => r === null) ? null : all.flatMap((r) => (r && r.x ? [r.x] : [])),
  )
  modsCache.set(version, asked)
  return asked
}

/**
 * Есть ли под версию хоть один FPS-мод. Нет — тумблер FPS у версии не
 * показывается и режим не включается: у свежих версий (26.x) моды выходят
 * с опозданием. Ошибка сети — считаем, что есть.
 */
export function fpsAvailable(version: string): Promise<boolean> {
  return fpsMods(version).then((l) => l === null || l.length > 0)
}

const loaderOf = (p: Profile) => p.loader || (p.fabric ? 'fabric' : 'vanilla')

/**
 * Найти или завести «Minecraft X» на загрузчике версии. Одна сборка на
 * версию: сначала ищется уже заведённая (в том числе «Minecraft X (2)» —
 * новые копии не плодим), ванильная переводится на загрузчик.
 */
async function fabricBuild(version: string): Promise<string | null> {
  const name = versionBuildName(version)
  const loader = versionLoader(version)
  let profiles = useProfiles.getState().profiles
  if (!profiles.length) {
    await useProfiles.getState().refresh()
    profiles = useProfiles.getState().profiles
  }
  const same = profiles.filter((p) => p.version === version && p.name.startsWith(name))
  const fab = same.find((p) => p.name === name && loaderOf(p) === loader) || same.find((p) => loaderOf(p) === loader)
  if (fab) return fab.name
  const exact = same.find((p) => p.name === name && loaderOf(p) === 'vanilla') || same.find((p) => loaderOf(p) === 'vanilla')
  if (exact) {
    // Ванильную «Minecraft X» завёл сам лаунчер (старое лобби) — это наша
    // сборка, и перевод на загрузчик не трогает ничьих модов: их там нет.
    await setProfileLoader(exact.name, version, loader, null)
    await useProfiles.getState().refresh()
    return exact.name
  }
  // Версию загрузчика не задаём: create_profile сам берёт последний стабильный.
  const p = await createProfile(name, version, loader === 'fabric', loader, null, null)
  await useProfiles.getState().refresh()
  return p.name
}

/** FPS-моды: включить (поставить недостающие) или выключить без удаления. */
async function applyFps(profile: string, on: boolean): Promise<void> {
  const st = await fpsBoostState(profile)
  if (on && !st.enabled) {
    await setFpsBoost(profile, true)
    return
  }
  // Режим уже включён: его моды могли быть выключены этим же переключателем.
  for (const file of st.mods) await toggleContent(profile, 'mod', file, on).catch(() => {})
}

/** Мод косметики Millida: запуск ставит его и сам, здесь — заранее, чтобы первый вход был со скином. */
async function ensureCosmetics(profile: string): Promise<void> {
  const st = await millidaModState(profile)
  if (st.enabled && st.available && !st.installed) await millidaModInstall(profile)
}

/**
 * Сборка «Minecraft <version>» на Fabric (до 1.14 — Forge), готовая к запуску. Возвращает имя
 * сборки или null (браузер без ядра, ошибка создания). Моды FPS и косметики —
 * по возможности: их ошибка не мешает играть.
 */
export async function ensureVersionBuild(version: string, opts: { fps: boolean }): Promise<string | null> {
  if (!hasTauri()) return null
  let name: string | null
  try {
    name = await fabricBuild(version)
  } catch (e) {
    console.error('[version-build] create', version, e)
    return null
  }
  if (!name) return null
  const fps = opts.fps && (await fpsAvailable(version))
  await applyFps(name, fps).catch((e) => console.error('[version-build] fps', e))
  await ensureCosmetics(name).catch((e) => console.error('[version-build] cosmetics', e))
  return name
}

/**
 * Сборки по умолчанию для «Моих сборок» (правка владельца 23.09.2026, 20:05):
 * у кого нет ни одной сборки, сразу видит три готовые — версии, в которые
 * больше всего играют в лаунчере. Список отдаёт бэкенд
 * (GET /launcher/popular-versions); нет ответа — зашитый топ-3 по телеметрии
 * за 30 дней по устройствам (23.09.2026).
 */
export interface PopularVersion {
  mc: string
  loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'
}

export const POPULAR_FALLBACK: PopularVersion[] = [
  { mc: '1.20.1', loader: 'forge' },
  { mc: '26.2', loader: 'fabric' },
  { mc: '1.21.11', loader: 'fabric' },
]

const LOADER_OK = new Set(['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'])
let popularCache: Promise<PopularVersion[]> | null = null
export function loadPopularVersions(): Promise<PopularVersion[]> {
  if (!popularCache)
    popularCache = api<{ versions?: { mc?: unknown; loader?: unknown }[] }>('/launcher/popular-versions')
      .then((r) => {
        const list = (Array.isArray(r && r.versions) ? r.versions! : [])
          .filter((v) => typeof v.mc === 'string' && /^\d+(\.\d+)+$/.test(v.mc) && LOADER_OK.has(String(v.loader)))
          .map((v) => ({ mc: v.mc as string, loader: v.loader as PopularVersion['loader'] }))
          .slice(0, 3)
        return list.length ? list : POPULAR_FALLBACK
      })
      .catch(() => POPULAR_FALLBACK)
  return popularCache
}

/** Имя сборки-заготовки: «Minecraft 1.20.1», у не-Fabric — с загрузчиком. */
export const presetName = (v: PopularVersion) =>
  versionBuildName(v.mc) + (v.loader === 'fabric' ? '' : ' ' + ({ vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' } as const)[v.loader])

/**
 * Заготовка становится настоящей сборкой только при первом «Играть»: до
 * этого на диске её нет. Уже заведённая с тем же именем, версией и
 * загрузчиком — берётся она. Буст FPS и косметика — по возможности.
 */
export async function ensurePresetBuild(v: PopularVersion, icon: string | null): Promise<string | null> {
  if (!hasTauri()) return null
  const name = presetName(v)
  let profiles = useProfiles.getState().profiles
  if (!profiles.length) {
    await useProfiles.getState().refresh()
    profiles = useProfiles.getState().profiles
  }
  const have = profiles.find((p) => p.name === name && p.version === v.mc && loaderOf(p) === v.loader)
  let built = have ? have.name : null
  if (!built) {
    try {
      const p = await createProfile(name, v.mc, v.loader === 'fabric', v.loader, icon, null)
      built = p.name
      await useProfiles.getState().refresh()
    } catch (e) {
      console.error('[preset-build] create', v, e)
      return null
    }
  }
  if (v.loader === 'fabric' || v.loader === 'forge') {
    const fps = await fpsAvailable(v.mc)
    if (fps) await applyFps(built, true).catch((e) => console.error('[preset-build] fps', e))
  }
  await ensureCosmetics(built).catch((e) => console.error('[preset-build] cosmetics', e))
  return built
}
