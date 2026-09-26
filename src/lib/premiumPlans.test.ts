import { describe, expect, test } from 'bun:test'
import { hasPlanChoice, liveSubscription, type PremiumPackDetail, type PremiumSubscription } from './premium'

const base: PremiumPackDetail = { id: 'aeronautics', slug: 'aeronautics', title: 'All Of Aeronautics' }
const pack = { id: 'pack', title: 'Только эта сборка', priceKopecks: 25900, period: 'month' as const }
const bundle = { id: 'bundle:arcania-labs', title: 'Все сборки Arcania Labs', priceKopecks: 34900, period: 'month' as const }
const sub = (over: Partial<PremiumSubscription>): PremiumSubscription => ({ active: true, paidUntil: '2026-10-26T00:00:00Z', ...over })

describe('hasPlanChoice: two subscribe buttons only where the server offers two plans', () => {
  const cases: [PremiumPackDetail | null, boolean, string][] = [
    [{ ...base, plans: [pack, bundle] }, true, 'a partner pack: this pack or all packs'],
    [{ ...base, plans: [bundle] }, false, 'one plan keeps the old single button'],
    [{ ...base }, false, 'an old server without plans'],
    [null, false, 'the detail did not load'],
  ]
  for (const [detail, want, why] of cases) test(why, () => expect(hasPlanChoice(detail)).toBe(want))
})

describe('liveSubscription: the cancel line names the subscription that actually gives access', () => {
  const cases: [PremiumPackDetail | null, string | null, string][] = [
    [{ ...base, bundle: sub({ planId: 'bundle' }), subscription: sub({ planId: 'pack' }) }, 'bundle', 'the bundle wins: it is what keeps paying for this pack'],
    [{ ...base, bundle: sub({ planId: 'bundle', active: false }), subscription: sub({ planId: 'pack' }) }, 'pack', 'an expired bundle leaves the pack subscription'],
    [{ ...base, subscription: sub({ planId: 'pack', active: false }) }, null, 'nothing active, nothing to cancel'],
    [null, null, 'no detail'],
  ]
  for (const [detail, want, why] of cases) test(why, () => expect(liveSubscription(detail)?.planId ?? null).toBe(want))
})
