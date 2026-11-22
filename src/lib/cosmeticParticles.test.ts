import { describe, expect, it } from 'bun:test'
import { compileMolang } from './molang'
import { particlePack, startParticles, type ParticleShow } from './cosmeticParticles'
import { hasParticles, particleKey, pickParticles } from './cosmeticParticleData'
import BOOK from './cosmeticParticles.json'

;(globalThis as { document?: unknown }).document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_: string) {} }),
}

const MAX_PARTICLES = 4000

const total = (show: ParticleShow) =>
  (show as unknown as { emitters: { particles: unknown[] }[] }).emitters.reduce((n, e) => n + e.particles.length, 0)

const flood = {
  effects: {
    flood: {
      description: { identifier: 'flood', basic_render_parameters: { material: 'particles_alpha' } },
      components: {
        'minecraft:emitter_rate_steady': { spawn_rate: 100000, max_particles: 100000 },
        'minecraft:emitter_lifetime_looping': { active_time: 100 },
        'minecraft:particle_lifetime_expression': { max_lifetime: 100 },
        'minecraft:particle_appearance_billboard': { size: [0.1, 0.1] },
      },
    },
  },
  animations: { 'animation.flood': { loop: true, animation_length: 1, particle_effects: { '0.0': [{ effect: 'flood' }] } } },
  triggers: [{ type: 'IDLE', name: 'animation.flood' }],
}

/** Raw pack -> accepted, and why the case is pinned. */
const PACKS: [string, unknown, boolean][] = [
  ['null', null, false],
  ['a string', 'fireflies', false],
  ['effects without animations', { effects: {} }, false],
  ['animations without effects', { animations: {} }, false],
  ['effects is not an object', { effects: 1, animations: {} }, false],
  ['both present, triggers missing', { effects: {}, animations: {} }, true],
  ['a real pack from the book', BOOK.fireflies, true],
]

describe('particlePack reads only a well-formed pack', () => {
  for (const [name, raw, ok] of PACKS) {
    it(name, () => {
      const pack = particlePack(raw)
      expect(pack !== null, `${name}: a malformed pack must be refused before the engine sees it`).toBe(ok)
      if (pack) expect(Array.isArray(pack.triggers), 'triggers default to an empty list').toBe(true)
    })
  }
})

/** Model id -> pack found, and why the case is pinned. */
const KEYS: [string | undefined, boolean, string][] = [
  ['geometry.fireflies', true, 'catalog models carry the geometry. prefix the book does not'],
  ['fireflies', true, 'a bare name is looked up as is'],
  ['geometry.no_such_effect', false, 'an unknown effect gives nothing instead of throwing'],
  ['__proto__', false, 'an inherited key must not pass for a pack'],
  ['toString', false, 'neither must an Object.prototype method'],
  [undefined, false, 'an item without a model has no particles'],
]

describe('pickParticles finds the pack by model id', () => {
  for (const [model, found, why] of KEYS) {
    it(String(model), () => {
      expect(pickParticles(BOOK as unknown as Record<string, unknown>, model) !== null, why).toBe(found)
    })
  }
  it('strips only the leading prefix', () => {
    expect(particleKey('geometry.geometry.x')).toBe('geometry.x')
  })
})

describe('only the EFFECT slot carries particles, as on the site', () => {
  const SLOTS: [string | undefined, boolean][] = [
    ['EFFECT', true],
    ['AURA', false],
    ['HAT', false],
    [undefined, false],
  ]
  for (const [slot, want] of SLOTS) it(String(slot), () => expect(hasParticles(slot)).toBe(want))
})

describe('molang carries the variables and live random the particle engine needs', () => {
  it('reads a variable from the clock', () => {
    const fn = compileMolang('variable.speed * 2')
    expect(fn?.({ animTime: 0, lifeTime: 0, vars: { 'variable.speed': 3 } }), 'emitter variables drive particle motion').toBe(6)
  })
  it('rolls math.random when the clock has a roll', () => {
    const fn = compileMolang('math.random(0, 10)')
    expect(fn?.({ animTime: 0, lifeTime: 0, random: () => 0.25 }), 'particles scatter with a real roll').toBe(2.5)
  })
  it('keeps the still middle without a roll', () => {
    const fn = compileMolang('math.random(0, 10)')
    expect(fn?.({ animTime: 0, lifeTime: 0 }), 'keyframes must not shake the figure every frame').toBe(5)
  })
})

describe('the engine stays within its limits', () => {
  it('caps a runaway emitter at the particle limit', () => {
    const pack = particlePack(flood)
    const show = pack ? startParticles(pack, null, 'flood.png') : null
    expect(show, 'the synthetic flood pack must start').not.toBeNull()
    show!.advance(2)
    expect(total(show!), 'a pack asking for 100000 particles must not get past the cap').toBe(MAX_PARTICLES)
    show!.dispose()
  })

  for (const [name, raw] of Object.entries(BOOK as unknown as Record<string, unknown>)) {
    it(`${name} starts, shows particles and stays under the cap`, () => {
      const pack = particlePack(raw)
      const show = pack ? startParticles(pack, null, `${name}.png`, undefined, true) : null
      expect(show, `${name}: a shipped effect must be playable by the engine`).not.toBeNull()
      let peak = 0
      for (let second = 0; second < 8; second += 0.1) {
        show!.advance(0.1)
        peak = Math.max(peak, total(show!))
      }
      expect(peak, `${name}: a worn aura that never emits looks like a broken item`).toBeGreaterThan(0)
      expect(peak).toBeLessThanOrEqual(MAX_PARTICLES)
      show!.dispose()
    })
  }
})
