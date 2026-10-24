import { describe, expect, it } from 'bun:test'
import { hostingPackCards, packInstallRequest, type PackCard } from './hostingPackCards'

const card = (slug: string, over: Partial<PackCard> = {}) => ({ slug, title: slug, side: 'BOTH', ...over }) as PackCard

describe('hostingPackCards', () => {
  it('клиентская сборка не предлагается серверу', () => {
    expect(hostingPackCards([card('fabulously', { side: 'CLIENT' }), card('create')], new Set()).map((c) => c.slug)).toEqual(['create'])
  })
  it('партнёрская сборка остаётся, даже клиентская по метке, если хостинг её знает', () => {
    const items = [card('arcania', { side: 'CLIENT', hostingPack: 'arcania' }), card('ghost', { hostingPack: 'ghost' })]
    expect(hostingPackCards(items, new Set(['arcania'])).map((c) => c.slug)).toEqual(['arcania'])
  })
  it('партнёрскую ставят партнёрским путём, обычную — из каталога', () => {
    expect(packInstallRequest(card('lost-souls-2', { hostingPack: 'lost-souls' }))).toEqual({ path: '/installs/partner', body: { packKey: 'lost-souls' } })
    expect(packInstallRequest(card('create'))).toEqual({ path: '/install-catalog', body: { section: 'modpacks', slug: 'create', replaceWorld: true } })
  })
})
