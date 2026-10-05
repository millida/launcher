import { describe, expect, test } from 'bun:test'
import type { MillidaPack } from '../ipc/commands'
import { packFromCatalog } from './premium'

const base: MillidaPack = {
  slug: 'prisonrpg',
  title: 'PrisonRPG',
  summary: '',
  cover: null,
  downloads: 0,
  game: 'native',
  loader: 'custom',
  accessRequired: false,
  hasServer: false,
}

describe('packFromCatalog online', () => {
  const cases: [string, Partial<MillidaPack>, number | null, string][] = [
    ['counter', { online: 123 }, 123, 'the pack page shows «играют сейчас» only from this field'],
    ['zero', { online: 0 }, 0, 'zero is a real reading; the page decides not to draw it'],
    ['absent', {}, null, 'packs without a partner counter must not invent one'],
    ['null', { online: null }, null, 'the server sends null once the partner has been down for too long'],
  ]
  for (const [name, patch, want, why] of cases) {
    test(name, () => {
      const got = packFromCatalog({ ...base, ...patch }).online
      expect(got, `online ${JSON.stringify(patch)} -> ${got}, expected ${want}: ${why}`).toBe(want)
    })
  }
})
