import type { DepNode, DepPlan, PlanItem } from '../ipc/commands'

export const planItem = (n: DepNode): PlanItem => ({
  source: n.source,
  project_id: n.project_id,
  version_id: n.version_id,
})

/// An install that pulls in nothing and clashes with nothing must stay one
/// click. A mismatch is not this window's question: the existing "install
/// anyway?" confirmation already asks it, and asking twice reads as a bug.
export function planNeedsPrompt(p: DepPlan | null): boolean {
  if (!p || p.mismatch) return false
  return !!(p.required.length || p.optional.length || p.missing.length || p.conflicts.length)
}

/// Everything the plan says will be installed no matter what the user ticks.
export const autoItems = (p: DepPlan): PlanItem[] => p.required.map(planItem)

export function depSummary(p: DepPlan): string {
  const parts: string[] = []
  if (p.required.length) parts.push('зависимостей: ' + p.required.length)
  if (p.optional.length) parts.push('по желанию: ' + p.optional.length)
  if (p.missing.length) parts.push('не найдено: ' + p.missing.length)
  if (p.conflicts.length) parts.push('конфликтов: ' + p.conflicts.length)
  return parts.join(' · ')
}

export function fmtBytes(n: number): string {
  if (!n) return ''
  const mb = n / 1048576
  return mb >= 1 ? mb.toFixed(1) + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'
}
