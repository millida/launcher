import { applyCrashFix } from '../ipc/commands'
import type { CrashAction, CrashInfo } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { useCrash } from '../state/crash'
import { useGame } from '../state/game'
import { showToast, useUi } from '../state/ui'
import { autoHealPlan, crashedOnStart, takeAutoHeal } from './autoHealPlan'
import { realLaunch } from './launch'
import { markFixApplied } from './repair'

const EXIT_WAIT_MS = 8000

/** Ждём, пока упавшая копия уйдёт из списка запущенных: иначе запуск спросит про «вторую копию». */
function gone(profile: string): Promise<boolean> {
  return new Promise((resolve) => {
    const until = Date.now() + EXIT_WAIT_MS
    const tick = () => {
      if (!useGame.getState().list.includes(profile)) return resolve(true)
      if (Date.now() > until) return resolve(false)
      window.setTimeout(tick, 250)
    }
    tick()
  })
}

async function heal(info: CrashInfo, plan: CrashAction): Promise<void> {
  const setPrelaunch = useUi.getState().setPrelaunch
  setPrelaunch({ open: true, sub: info.profile, stage: 0, pct: 4, msg: 'Чиним сборку…', mode: 'repair' })
  try {
    await applyCrashFix(info.profile, plan.kind, plan.arg ?? '')
  } catch {
    // План не выполнился (нет сети, мода нет под версию): дальше решает человек.
    setPrelaunch({ open: false })
    useCrash.getState().show(info)
    return
  }
  markFixApplied(info.profile, 'auto:' + plan.kind)
  const free = await gone(info.profile)
  setPrelaunch({ open: false })
  if (!free) {
    showToast('Сборку починили. Запусти игру', 'ok')
    return
  }
  showToast('Сборку починили — запускаем снова', 'ok')
  realLaunch(info.profile)
}

/**
 * Вылет на старте с точным планом чиним сами и запускаем игру ещё раз.
 * Возвращает true, если взяли вылет на себя и окно вылета показывать не нужно.
 */
export function tryAutoHeal(info: CrashInfo | null | undefined, startedAt: number): boolean {
  if (!info || !hasTauri()) return false
  const plan = autoHealPlan(info)
  if (!plan || !crashedOnStart(startedAt) || !takeAutoHeal(info.profile)) return false
  void heal(info, plan)
  return true
}
