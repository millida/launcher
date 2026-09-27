import type { PackQuest } from '../../lib/rubies'

export type QuestState = { kind: 'owned' } | { kind: 'claimed' } | { kind: 'claim' } | { kind: 'play'; left: number }

export function questState(quest: PackQuest): QuestState {
  if (quest.claimed) return { kind: 'claimed' }
  if (quest.owned) return { kind: 'owned' }
  if (quest.done) return { kind: 'claim' }
  return { kind: 'play', left: Math.max(1, quest.needMinutes - Math.max(0, quest.minutes)) }
}

export function questPct(quest: PackQuest): number {
  if (quest.needMinutes <= 0) return 100
  return Math.min(100, Math.max(0, (quest.minutes / quest.needMinutes) * 100))
}

export function minuteWord(count: number): string {
  const tens = Math.abs(count) % 100
  const ones = tens % 10
  if (tens > 10 && tens < 20) return 'минут'
  if (ones === 1) return 'минута'
  if (ones >= 2 && ones <= 4) return 'минуты'
  return 'минут'
}

export function questsToShow(list: unknown): PackQuest[] {
  if (!list || typeof list !== 'object') return []
  const quests = (list as { quests?: unknown }).quests
  return Array.isArray(quests) ? quests.filter((q): q is PackQuest => !!q && typeof q === 'object' && !!(q as PackQuest).item) : []
}
