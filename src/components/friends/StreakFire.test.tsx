import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('../../styles/pixel/retention.css', () => ({}))
const { StreakFire } = await import('./StreakFire')

describe('огонёк серии', () => {
  it('огонь и число; без серии — ничего', () => {
    const html = renderToStaticMarkup(<StreakFire n={23} />)
    expect(html).toContain('class="fire"')
    expect(html).toContain('>23<')
    expect(html).toContain('Серия 23')
    expect(renderToStaticMarkup(<StreakFire n={0} />)).toBe('')
    expect(renderToStaticMarkup(<StreakFire n={undefined} />)).toBe('')
  })
})
