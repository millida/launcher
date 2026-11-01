import type { HardwareHint } from './deviceTier'

/**
 * Железо по данным ядра (device_specs), помнится между запусками: «лёгкий режим» и видеофон
 * решаются при первом кадре, а IPC отвечает позже. Первый запуск на новом ПК узнаёт железо
 * в простое и переключает режим сразу после; все следующие стартуют уже с ответом.
 */

const KEY = 'm-hw-hint'

let cached: HardwareHint | null | undefined

function valid(v: unknown): v is HardwareHint {
  const h = v as HardwareHint | null
  return !!h && Array.isArray(h.gpus) && typeof h.ramMb === 'number' && typeof h.threads === 'number' && typeof h.os === 'string' && typeof h.osVersion === 'string'
}

/** Сведения, записанные до появления числа ядер, получают 0 («неизвестно») до первого обновления из ядра. */
export function normalizeHardware(v: unknown): HardwareHint | null {
  if (!valid(v)) return null
  return { ...v, cores: typeof v.cores === 'number' && v.cores > 0 ? v.cores : 0 }
}

/** Что известно с прошлых запусков (синхронно), либо null. */
export function cachedHardware(): HardwareHint | null {
  if (cached !== undefined) return cached
  cached = null
  try {
    cached = normalizeHardware(JSON.parse(localStorage.getItem(KEY) || 'null'))
  } catch (e) {
    console.warn('[hardware] saved hardware hint is unreadable', e)
  }
  return cached
}

/** Спросить ядро (один раз за запуск, ответ ядро помнит само) и запомнить; null — не вышло (браузер, сбой IPC). */
export async function learnHardware(): Promise<HardwareHint | null> {
  try {
    const { deviceSpecs } = await import('../ipc/commands')
    const s = await deviceSpecs()
    const hint: HardwareHint = {
      gpus: (s.gpus ?? []).map((g) => String(g).slice(0, 120)).slice(0, 8),
      ramMb: s.ram_mb || 0,
      cores: s.cpu_cores || 0,
      threads: s.cpu_threads || 0,
      os: s.os || '',
      osVersion: s.os_version || '',
    }
    cached = hint
    try {
      localStorage.setItem(KEY, JSON.stringify(hint))
    } catch (e) {
      console.warn('[hardware] hardware hint was not saved', e)
    }
    return hint
  } catch (e) {
    console.warn('[hardware] the core did not answer device_specs', e)
    return null
  }
}
