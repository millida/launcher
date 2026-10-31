import { gfxPresetState } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { t } from '../i18n'
import { GRAPHICS_PRESETS_PUBLIC } from './graphicsRelease'

/** Запись ядра о сессии старше этого — не про только что закрытую игру. */
const FRESH_S = 180
const shown = new Set<string>()

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * «Игра закрыта» со средним FPS сессии. Его считает ядро по отчётам мода и
 * пишет в настройки сборки, когда процесс игры закрыт, — чуть позже события
 * выхода, поэтому спрашиваем дважды. Без мода Millida отчётов нет — обычный тост.
 */
export async function exitToastWithFps(profile: string, wait: (ms: number) => Promise<void> = sleep): Promise<void> {
  if (GRAPHICS_PRESETS_PUBLIC && hasTauri()) {
    for (const delay of [800, 2500]) {
      await wait(delay)
      const st = await gfxPresetState(profile).catch(() => null)
      const last = st?.lastFps
      if (!last || Date.now() / 1000 - last.at > FRESH_S) continue
      const key = profile + ':' + last.at
      if (shown.has(key)) break
      shown.add(key)
      const before = st?.beforeFps
      showToast(
        before && before.avg < last.avg
          ? t('Игра закрыта · {fps} FPS, было {was}', { fps: last.avg, was: before.avg })
          : t('Игра закрыта · {fps} FPS в среднем', { fps: last.avg }),
      )
      return
    }
  }
  showToast(t('Игра закрыта'))
}
