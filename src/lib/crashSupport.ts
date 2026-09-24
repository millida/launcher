import { listLogs, shareLog } from '../ipc/commands'
import type { CrashInfo } from '../ipc/events'
import { buildDiagnostics } from './diag'

const LAUNCH_LOG = 'logs/launcher-latest.log'
const GAME_LOG = 'logs/latest.log'

export async function shareCrashLog(profile: string): Promise<string> {
  const files = await listLogs(profile)
  const file =
    files.find((f) => f === LAUNCH_LOG) ??
    files.find((f) => f === GAME_LOG) ??
    files.find((f) => f.startsWith('logs/')) ??
    files[0]
  if (!file) throw new Error('Лога от этого запуска нет')
  return shareLog(profile, file)
}

// A failed part is written into the report instead of being dropped: support
// must see that the log is missing, not silently receive a shorter message.
export async function buildCrashReport(info: CrashInfo): Promise<string> {
  const [log, diag] = await Promise.all([
    shareCrashLog(info.profile).then(
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
