import { describe, expect, test } from 'bun:test'
import { outageOf, type StatusPage } from './serviceStatus'

const page = (p: Partial<StatusPage>): StatusPage => ({ state: 'operational', categories: [], incidents: [], ...p })

describe('outageOf', () => {
  const cases: Array<[string, StatusPage | null, ReturnType<typeof outageOf>]> = [
    ['no page (request failed or page switched off) shows no badge', null, null],
    ['everything green shows no badge', page({}), null],
    ['unknown is not an outage: a missing probe must not scare players', page({ state: 'unknown' }), null],
    [
      'an open incident names the outage in its own words',
      page({ state: 'degraded', incidents: [{ title: 'Login is slow', resolvedAt: null }, { title: 'Old', resolvedAt: '2026-10-01' }] }),
      { state: 'degraded', what: 'Login is slow' },
    ],
    [
      'without an incident the broken components are listed',
      page({ state: 'operational', categories: [{ name: 'Launcher', state: 'down', components: [{ name: 'Auth', state: 'down' }, { name: 'CDN', state: 'operational' }] }] }),
      { state: 'down', what: 'Auth' },
    ],
    [
      'the worst state wins over the overall one',
      page({ state: 'maintenance', categories: [{ name: 'Hosting', state: 'down' }] }),
      { state: 'down', what: 'Hosting' },
    ],
  ]
  for (const [why, input, want] of cases) test(why, () => expect(outageOf(input)).toEqual(want))
})
