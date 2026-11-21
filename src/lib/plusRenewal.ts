export type PlusReminderStage = 'soon' | 'today'

export interface PlusReminder {
  stage: PlusReminderStage
  daysLeft: number
  endsAt: number
}

export const PLUS_REMIND_DAYS = 3

const DAY_MS = 86_400_000

const localDay = (at: number): number => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/// Servers before the one-off month send no `autoRenew`. Then a buyer who pays from the balance
/// holds a month that never renews, and a cancelled gateway subscription stops renewing too.
export function plusRenews(status: { canceled: boolean; autoRenew?: boolean }, checkout: 'gateway' | 'balance'): boolean {
  if (typeof status.autoRenew === 'boolean') return status.autoRenew
  return !status.canceled && checkout === 'gateway'
}

/// Counted in calendar days of the player's own clock: "today" is the day the access ends for them.
export function plusReminderDue(input: { active: boolean; paidUntil: string | null; renews: boolean; now: number }): PlusReminder | null {
  if (!input.active || input.renews || !input.paidUntil) return null
  const endsAt = Date.parse(input.paidUntil)
  if (!Number.isFinite(endsAt) || endsAt <= input.now) return null
  const daysLeft = Math.round((localDay(endsAt) - localDay(input.now)) / DAY_MS)
  if (daysLeft > PLUS_REMIND_DAYS) return null
  return { stage: daysLeft <= 0 ? 'today' : 'soon', daysLeft: Math.max(0, daysLeft), endsAt }
}

/// One reminder per stage of one paid period: a renewal moves `paidUntil` and starts afresh.
export const plusReminderKey = (paidUntil: string, stage: PlusReminderStage): string => paidUntil + '|' + stage
