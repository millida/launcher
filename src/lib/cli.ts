import { tauri, hasTauri } from '../ipc/tauri'
import { clearCache, takeCliAction, type CliAction } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { setScreen, showToast } from '../state/ui'
import { realLaunch } from './launch'
import { runRepair } from './repair'
import { t, tx } from '../i18n'

async function buildExists(name: string): Promise<boolean> {
  const has = () => useProfiles.getState().profiles.some((p) => p.name === name)
  if (has()) return true
  await useProfiles.getState().refresh().catch(() => {})
  return has()
}

/// The command line is typed by the player on their own machine, so a launch runs without the
/// confirmation a web link needs.
export async function runCliAction(a: CliAction): Promise<void> {
  if (a.action === 'clean') {
    try {
      const freed = await clearCache()
      showToast(t('Освобождено {n} МБ', { n: Math.round(freed / 1024 / 1024) }))
    } catch (e) {
      showToast(t('Не удалось очистить кэш: {error}', { error: tx(e) }), 'error')
    }
    return
  }
  const build = a.build || ''
  if (!(await buildExists(build))) {
    showToast(t('Сборки «{name}» нет в лаунчере', { name: build }), 'error')
    setScreen('builds')
    return
  }
  if (a.action === 'launch') realLaunch(build)
  else if (a.action === 'repair') await runRepair(build)
}

export function initCli() {
  if (!hasTauri()) return
  void takeCliAction()
    .then((a) => (a ? runCliAction(a) : undefined))
    .catch(() => {})
  const T = tauri()
  void T?.event.listen<CliAction>('cli-action', (e) => void runCliAction(e.payload)).catch(() => {})
}
