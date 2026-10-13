import type { CrashAction, CrashInfo } from '../ipc/events'

/**
 * Автопочинка после вылета на старте. Загрузчик сам пишет, чего сборке не
 * хватает («нужен cloth-config ≥ 11», «нужен загрузчик новее»), ядро собирает
 * из этого план, а человеку оставалось нажать «Починить сборку». Жали редко:
 * 13.10.2026 недостающая зависимость уронила игру у 277 установок за полдня,
 * починку применили 18. Точный план без потерь выполняем сами и запускаем игру
 * ещё раз — один раз, без повторов по кругу.
 */

/** Вердикты, где причину назвал сам загрузчик, а не догадка по стеку. */
const HEAL_KINDS: readonly string[] = ['missing_deps', 'old_loader', 'wrong_mc', 'wrong_loader', 'missing_renderer']

/** Шаги, которые только добавляют или подбирают версию. Отключение мода человек решает сам. */
const SAFE_STEPS: readonly string[] = ['install-dep', 'install-deps', 'add-mod', 'set-mod-version', 'update-loader']

/** Вылет позже этого — уже не отказ загрузчика на старте. */
export const AUTO_HEAL_WINDOW_MS = 4 * 60_000
/** Вторая попытка для той же сборки — не раньше: иначе починка, которая не помогла, зациклит запуск. */
export const AUTO_HEAL_COOLDOWN_MS = 15 * 60_000

const KEY = 'm-auto-heal'

/** План, который можно выполнить без человека, или null. */
export function autoHealPlan(info: Pick<CrashInfo, 'profile' | 'kind' | 'actions'> | null | undefined): CrashAction | null {
  if (!info?.profile || !HEAL_KINDS.includes(info.kind ?? '')) return null
  const plan = (info.actions ?? []).find((a) => a.kind === 'fix-plan')
  if (!plan?.arg) return null
  let steps: unknown
  try {
    steps = JSON.parse(plan.arg)
  } catch {
    return null
  }
  if (!Array.isArray(steps) || !steps.length) return null
  for (const s of steps) {
    if (!Array.isArray(s) || !SAFE_STEPS.includes(String(s[0]))) return null
  }
  return plan
}

/** Игра упала на старте: от запуска прошло меньше окна. Без времени запуска — не старт. */
export function crashedOnStart(startedAt: number, now = Date.now()): boolean {
  return startedAt > 0 && now - startedAt < AUTO_HEAL_WINDOW_MS
}

/** Берёт попытку автопочинки для сборки; false — недавно уже чинили сами. */
export function takeAutoHeal(profile: string, now = Date.now()): boolean {
  if (!profile) return false
  try {
    const all = (JSON.parse(localStorage.getItem(KEY) || '{}') || {}) as Record<string, number>
    if (now - Number(all[profile] || 0) < AUTO_HEAL_COOLDOWN_MS) return false
    for (const k of Object.keys(all)) if (now - Number(all[k]) > AUTO_HEAL_COOLDOWN_MS) delete all[k]
    all[profile] = now
    localStorage.setItem(KEY, JSON.stringify(all))
    return true
  } catch {
    // Без хранилища не знаем, чинили ли уже: лучше окно вылета, чем круг запусков.
    return false
  }
}
