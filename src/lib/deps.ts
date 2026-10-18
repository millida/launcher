import type { AuditIssue, DepAudit, DepNode, DepPlan, PlanItem } from '../ipc/commands'
import { t } from '../i18n'

export const planItem = (n: DepNode): PlanItem => ({
  source: n.source,
  project_id: n.project_id,
  version_id: n.version_id,
})

/// Everything the audit knows how to close, one entry per project: two mods
/// asking for the same library must not queue it twice.
export function fixItems(audit: DepAudit | null): PlanItem[] {
  const items = (audit ? audit.issues : []).map((i) => i.fix).filter((f): f is DepNode => !!f).map(planItem)
  return items.filter((it, i) => items.findIndex((x) => x.project_id === it.project_id) === i)
}

/// What one click on a missing dependency installs: the resolved fix, or a
/// fresh lookup of the project when the audit could not reach the catalogue.
export function issueInstall(it: AuditIssue): PlanItem | null {
  if (it.kind !== 'missing') return null
  if (it.fix) return planItem(it.fix)
  return it.dep ? { source: 'modrinth', project_id: it.dep, version_id: '' } : null
}

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
  if (p.required.length) parts.push(t('зависимостей: {n}', { n: p.required.length }))
  if (p.optional.length) parts.push(t('по желанию: {n}', { n: p.optional.length }))
  if (p.missing.length) parts.push(t('не найдено: {n}', { n: p.missing.length }))
  if (p.conflicts.length) parts.push(t('конфликтов: {n}', { n: p.conflicts.length }))
  return parts.join(' · ')
}

export function fmtBytes(n: number): string {
  if (!n) return ''
  const mb = n / 1048576
  return mb >= 1 ? t('{n} МБ', { n: mb.toFixed(1) }) : t('{n} КБ', { n: Math.max(1, Math.round(n / 1024)) })
}
