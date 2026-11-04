import type { EconomyProgress } from './rubies'
import { t } from '../i18n'

/**
 * Какое достижение открывает вещь. Берётся из уже загружаемого GET /rubies/progress:
 * награда-вещь самого достижения и вехи по очкам достижений. Вещь, которой там нет,
 * остаётся с общей пометкой «Достижение»: связь не выдумывается.
 */
export function achievementSources(p: Pick<EconomyProgress, 'achievements' | 'pointItems'> | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!p) return out
  for (const a of p.achievements ?? []) {
    if (a.reward?.kind !== 'ITEM' || !a.title) continue
    const code = a.reward.item.code
    if (!out.has(code)) out.set(code, t('Достижение «{title}»', { title: a.title }))
  }
  for (const m of p.pointItems ?? []) {
    if (!out.has(m.item.code)) out.set(m.item.code, t('{n} очков достижений', { n: m.points }))
  }
  return out
}

/** Код вещи-расцветки («ANGEL_WINGS~red») ищется и по базовой вещи. */
export function achievementNote(sources: Map<string, string>, id: string, baseId?: string): string | undefined {
  return sources.get(id) ?? (baseId ? sources.get(baseId) : undefined)
}
