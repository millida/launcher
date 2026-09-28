import { describe, expect, test } from 'bun:test'
import { OWN_SERVER_ADDR, joinAddr, modeAction, targetsOwnServer } from './ownServer'
import { searchTerm } from '../components/playhub/data'
import type { LobbyMode } from '../state/lobbyMode'

describe('modeAction', () => {
  const cases: Array<[string, 'launch' | 'open', string]> = [
    ['ONEBLOCK', 'launch', 'the exclusive tile starts our server; opening the category showed 79 foreign servers instead'],
    ['BEDWARS', 'open', 'an ordinary mode tile still lists the servers of its mode'],
    ['SKYBLOCK', 'open', 'a mode next to OneBlock must not start the event'],
    ['oneblock', 'open', 'mode codes are upper case; anything else is not our tile'],
  ]
  for (const [cat, want, why] of cases)
    test(cat, () => {
      expect(modeAction(cat), why).toBe(want)
    })
})

const server = (slug: string, ip: string): LobbyMode => ({ kind: 'server', slug, name: slug, ip, logo: null, banner: null, versions: [], licensed: false })

describe('targetsOwnServer', () => {
  const cases: Array<[LobbyMode | null, boolean, string]> = [
    [server('oneblock-7', ''), true, 'the rating hides the address of a launcher-only card, so the slug alone must route to our client'],
    [server('proxy-1.metalabsmc.net:25567', 'proxy-1.metalabsmc.net:25567'), true, 'a typed address of our server must not start a vanilla build'],
    [server('x', 'PROXY-1.metalabsmc.net.:25567'), true, 'case and a trailing dot do not make it another server'],
    [server('x', 'proxy-1.metalabsmc.net'), false, 'the same host on the default port is another MetaLabs server'],
    [server('oneblocky', 'play.oneblocky.com'), false, 'a foreign OneBlock server joins as usual'],
    [{ kind: 'premium', id: 'oneblock-metalabs', slug: 'oneblock-metalabs', title: 'OneBlock', cover: null, meta: '' }, true, 'the lobby pick of the pack is the same event'],
    [{ kind: 'premium', id: 'arcania', slug: 'arcania', title: 'Arcania', cover: null, meta: '' }, false, 'other packs keep their own path'],
    [null, false, 'nothing picked is not our server'],
  ]
  for (const [mode, want, why] of cases)
    test(why, () => {
      expect(targetsOwnServer(mode), why).toBe(want)
    })
})

describe('joinAddr', () => {
  test('our card without an address joins by our address', () => {
    expect(joinAddr({ slug: 'oneblock-7', ip: '' }), 'an empty address started a join to nowhere').toBe(OWN_SERVER_ADDR)
  })
  test('any other card keeps its address', () => {
    expect(joinAddr({ slug: 'mlegacy', ip: 'mc.mlegacy.net' })).toBe('mc.mlegacy.net')
  })
})

describe('searchTerm', () => {
  const cases: Array<[string, string, string]> = [
    ['proxy-1.metalabsmc.net:25567', 'proxy-1.metalabsmc.net', 'the rating keeps the port apart: with it the search found nothing'],
    ['  mc.example.ru  ', 'mc.example.ru', 'spaces around a pasted address are dropped'],
    ['OneBlock', 'OneBlock', 'a name is searched as typed'],
    ['12:30', '12:30', 'something that is not a host keeps its colon'],
  ]
  for (const [input, want, why] of cases)
    test(input, () => {
      expect(searchTerm(input), why).toBe(want)
    })
})
