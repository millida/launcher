import type { CrashInfo } from '../ipc/events'
import type { ModFile, Profile } from '../ipc/commands'
import type { CrashAiAnswer, CrashAskBody } from './milli'

const TAIL_MAX = 6000
const MODS_MAX = 400

/**
 * The log leaves the computer without the Windows account name, home folder,
 * session token and e-mails; the server scrubs again, this is the first line.
 */
export function scrubCrashText(text: string): string {
  return String(text ?? '')
    .replace(/(--accessToken\s+)\S+/gi, '$1***')
    .replace(/\b[a-z]:[\\/]+users[\\/]+[^\\/\r\n]+/gi, '~')
    .replace(/\/(?:home|Users)\/[^/\r\n]+/g, '~')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '***@***')
    .slice(-TAIL_MAX)
}

/** Only enabled mods: a disabled jar did not take part in the crash and must not be offered back. */
export function crashAskBody(info: CrashInfo, mods: readonly ModFile[], profile?: Profile | null): CrashAskBody {
  return {
    reason: info.reason.slice(0, 300),
    ...(info.cause ? { cause: scrubCrashText(info.cause).slice(0, 300) } : {}),
    ...(info.kind ? { kind: info.kind.slice(0, 40) } : {}),
    ...(info.tail ? { tail: scrubCrashText(info.tail) } : {}),
    ...(profile?.version ? { mcVersion: profile.version.slice(0, 16) } : {}),
    ...(profile ? { loader: (profile.loader || (profile.fabric ? 'fabric' : 'vanilla')).slice(0, 16) } : {}),
    mods: mods
      .filter((m) => m.enabled && m.name.length <= 200)
      .slice(0, MODS_MAX)
      .map((m) => (m.title ? { file: m.name, title: m.title.slice(0, 100) } : { file: m.name })),
  }
}

/** A disable offer survives only for a file that is still an enabled mod of this profile. */
export function crashDisableOffers(answer: CrashAiAnswer, mods: readonly ModFile[]): { file: string; title: string }[] {
  const enabled = new Map(mods.filter((m) => m.enabled).map((m) => [m.name, m]))
  return answer.disable
    .filter((d) => enabled.has(d.file))
    .map((d) => ({ file: d.file, title: d.title || enabled.get(d.file)?.title || d.file }))
}
