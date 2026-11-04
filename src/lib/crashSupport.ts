// Builds the support request text after a crash: a link to the log (the log is uploaded to the public mclo.gs by the core command shareLog)
// and the system diagnostics from diag.ts. Runs on the player's button.
import { listLogs, shareLog } from '../ipc/commands'
import type { CrashInfo } from '../ipc/events'
import { buildDiagnostics } from './diag'

const LAUNCH_LOG = 'logs/launcher-latest.log'
const GAME_LOG = 'logs/latest.log'

// Text of the core's refusal to send an empty log (sharelog.rs, EMPTY_LOG): the next log is tried then.
const EMPTY_LOG = 'Лог пустой'
const isEmptyLog = (e: unknown) => String(e instanceof Error ? e.message : e).includes(EMPTY_LOG)

export async function shareCrashLog(profile: string, crashLog?: string): Promise<string> {
  const files = await listLogs(profile).catch(() => [] as string[])
  // Launch log, then the game's own, then any other log: an empty one (a game that died before
  // writing anything) must not end the search while a crash report lies next to it.
  const order = [
    crashLog,
    files.find((f) => f === LAUNCH_LOG),
    files.find((f) => f === GAME_LOG),
    ...files.filter((f) => f.startsWith('logs/')),
    ...files,
  ]
  const tried = new Set<string>()
  let sawEmpty = false
  for (const file of order) {
    if (!file || tried.has(file)) continue
    tried.add(file)
    try {
      return await shareLog(profile, file)
    } catch (e) {
      if (!isEmptyLog(e)) throw e
      sawEmpty = true
    }
  }
  throw new Error(sawEmpty ? 'Логи этого запуска пустые — игра закрылась, ничего не записав' : 'Лога от этого запуска нет')
}

// A failed part is written into the report instead of being dropped: support
// must see that the log is missing, not silently receive a shorter message.
export async function buildCrashReport(info: CrashInfo): Promise<string> {
  const [log, diag] = await Promise.all([
    shareCrashLog(info.profile, info.logFile).then(
      (url) => url,
      (e) => 'не выгрузился (' + e + ')',
    ),
    buildDiagnostics().then(
      (text) => text,
      (e) => 'Данные о системе собрать не вышло (' + e + ')',
    ),
  ])
  return ['Игра вылетела.', 'Сборка: ' + info.profile, 'Причина: ' + info.reason, 'Лог: ' + log, '', diag].join('\n')
}
