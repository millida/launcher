import { hasTauri } from '../ipc/tauri'
import { checkUpdates, repairProfile } from '../ipc/commands'
import type { RepairReport } from '../ipc/commands'
import { listenLaunchProgress } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import { showToast, useUi } from '../state/ui'

const STAGE_IDX: Record<string, number> = { files: 0, java: 1, assets: 2, content: 3, mod: 0, launch: 3 }

let running = false

export const repairRunning = () => running

// Починка сверяет файлы по хешам, но устаревший мод — целый файл: сборка
// падает, а отчёт говорит «всё на месте». Число обновлений досчитываем тем же
// проверяльщиком, что и экран сборок, и дописываем в тот же итог.
function summary(r: RepairReport, outdated: number): string {
  const tail = outdated ? '. Устарело модов — ' + outdated + ', обнови их на экране сборки' : ''
  if (r.broken.length) {
    const head = r.broken.slice(0, 3).join(', ')
    const rest = r.broken.length > 3 ? ' и ещё ' + (r.broken.length - 3) : ''
    return 'Файлы игры на месте, но не удалось восстановить: ' + head + rest + ' — удали их и поставь заново' + tail
  }
  if (r.restored) return 'Готово: перекачано файлов — ' + r.restored + ', проверено модов — ' + r.checked + tail
  if (r.checked) return 'Всё на месте: проверено модов — ' + r.checked + ', файлы игры сверены по хешам' + tail
  return 'Всё на месте: файлы игры сверены по хешам' + tail
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
    // Сеть каталога могла не ответить — это не отменяет успешной починки.
    const outdated = await checkUpdates(profile, 'mod')
      .then((ups) => (ups ? ups.length : 0))
      .catch(() => 0)
    showToast(summary(report, outdated), report.broken.length ? 'error' : 'ok')
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
