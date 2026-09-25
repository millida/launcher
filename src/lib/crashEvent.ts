import type { Profile } from '../ipc/commands'
import type { CrashInfo } from '../ipc/events'
import { maskValues } from './errorReport'

const LONG_MAX = 300
const CODE_MAX = 120
const SUSPECTS = 12

/// Загрузчик сборки так же, как его пишет game_launch.
export function loaderOf(p: Pick<Profile, 'loader' | 'fabric'> | null | undefined): string {
  if (!p) return ''
  return p.loader || (p.fabric ? 'fabric' : 'vanilla')
}

/// Данные события game_crash: code — старая причина (дашборды), kind/cause —
/// класс и строка исключения из ядра, suspects — подозреваемые моды, mc и
/// загрузчик — из сборки (раньше их приходилось угадывать по запускам).
/// Имя сборки и ник вырезаются из свободного текста.
export function gameCrashData(
  info: CrashInfo | null | undefined,
  profile: Pick<Profile, 'version' | 'loader' | 'fabric'> | null | undefined,
  settings: { catalogPackSlug?: string | null; modpackSlug?: string | null } | null | undefined,
  masks: Array<[string | null | undefined, string]> = [],
): Record<string, string> {
  const hide = (t: string) => maskValues(t, masks)
  const data: Record<string, string> = { code: hide(String(info?.reason ?? 'crash')).slice(0, CODE_MAX) }
  const kind = (info?.kind || '').trim()
  if (kind) data.kind = kind.slice(0, 40)
  const cause = hide((info?.cause || '').trim())
  if (cause) data.cause = cause.slice(0, LONG_MAX)
  const suspects = (info?.culprits || [])
    .map((c) => hide(String(c).trim()))
    .filter(Boolean)
    .slice(0, SUSPECTS)
    .join(', ')
  if (suspects) data.suspects = suspects.slice(0, LONG_MAX)
  if (profile?.version) data.mc = profile.version
  const loader = loaderOf(profile)
  if (loader) data.loader = loader
  const pack = (settings?.catalogPackSlug || '').trim()
  if (pack) data.pack = pack
  if (settings?.modpackSlug) data.modpack = settings.modpackSlug
  return data
}
