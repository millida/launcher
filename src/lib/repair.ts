import { hasTauri } from '../ipc/tauri'
import { repairProfile } from '../ipc/commands'
import type { RepairReport } from '../ipc/commands'
import { listenLaunchProgress } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import { showToast, useUi } from '../state/ui'

const STAGE_IDX: Record<string, number> = { files: 0, java: 1, assets: 2, content: 3, mod: 0, launch: 3 }

let running = false

export const repairRunning = () => running

function summary(r: RepairReport): string {
  if (r.broken.length) {
    const head = r.broken.slice(0, 3).join(', ')
    const rest = r.broken.length > 3 ? ' и ещё ' + (r.broken.length - 3) : ''
    return 'Файлы игры на месте, но не удалось восстановить: ' + head + rest + ' — удали их и поставь заново'
  }
  if (r.restored) return 'Готово: перекачано файлов — ' + r.restored + ', проверено модов — ' + r.checked
  if (r.checked) return 'Всё на месте: проверено модов — ' + r.checked + ', файлы игры сверены по хешам'
  return 'Всё на месте: файлы игры сверены по хешам'
}

/// Progress travels on the same `launch-progress` channel as a launch, so the
/// repair reuses the prelaunch panel instead of leaving the button silent for
/// the minutes a full rehash takes.
export async function runRepair(profile: string): Promise<RepairReport | null> {
  if (!hasTauri()) {
    showToast('Доступно в приложении', 'error')
    return null
  }
  if (running) {
    showToast('Починка уже идёт')
    return null
  }
  running = true
  const setPrelaunch = useUi.getState().setPrelaunch
  setPrelaunch({
    open: true,
    sub: profile === 'default' ? 'Быстрый запуск' : profile,
    stage: 0,
    pct: 2,
    msg: 'Готовимся…',
    mode: 'repair',
  })
  let unlisten: UnlistenFn | null = null
  let finished = false
  const stop = () => {
    finished = true
    if (unlisten) unlisten()
    unlisten = null
  }
  listenLaunchProgress((p) => {
    setPrelaunch({ stage: STAGE_IDX[p.stage] ?? 0, pct: p.pct, msg: p.msg })
  }).then((u) => {
    if (!u) return
    if (finished) u()
    else unlisten = u
  })
  try {
    const report = await repairProfile(profile)
    showToast(summary(report), report.broken.length ? 'error' : 'ok')
    return report
  } catch (e) {
    const msg = String(e && (e as Error).message ? (e as Error).message : e).replace(/^Error:\s*/, '')
    showToast(/отмен/i.test(msg) ? 'Починка отменена' : 'Не удалось починить: ' + msg, 'error')
    return null
  } finally {
    stop()
    running = false
    setPrelaunch({ open: false })
  }
}
