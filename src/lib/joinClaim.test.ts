import { describe, expect, test } from 'bun:test'

const store = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

const { CLAIM_EVERY_MS, claimHost, claimsJoin } = await import('./joinClaim')

const acc = (kind: string, nick = 'Steve') => ({ id: 'a1', nick, kind })

describe('which account vouches for its nick to the reserve login check', () => {
  const cases: Array<{ name: string; account: ReturnType<typeof acc> | null; millida: boolean; profile: string; expect: boolean; why: string }> = [
    { name: 'Millida account', account: acc('millida'), millida: true, profile: 'Steve', expect: true, why: 'an existing Millida game account plays under the profile name the claim vouches for' },
    { name: 'Telegram Millida account', account: acc('tg'), millida: true, profile: '', expect: true, why: 'tg is a Millida login too, the server names the nick itself' },
    { name: 'offline nick of the profile', account: acc('offline'), millida: true, profile: 'Steve', expect: true, why: 'the offline account linked to the login must reach servers in reserve mode' },
    { name: 'offline nick of someone else', account: acc('offline', 'Alex'), millida: true, profile: 'Steve', expect: false, why: 'the claim would vouch for Steve while the game joins as Alex' },
    { name: 'offline nick in another case', account: acc('offline', 'steve'), millida: true, profile: 'Steve', expect: false, why: 'the game joins as steve, a different player to the server' },
    { name: 'offline nick, profile unknown', account: acc('offline'), millida: true, profile: '', expect: false, why: 'no proof the nick belongs to this login' },
    { name: 'signed out', account: acc('millida'), millida: false, profile: 'Steve', expect: false, why: 'without a session the API call can only fail' },
    { name: 'licence', account: acc('microsoft'), millida: true, profile: 'Steve', expect: false, why: 'a licence is checked by Mojang, not by our reserve' },
    { name: 'no account', account: null, millida: true, profile: 'Steve', expect: false, why: 'nothing is launched under a nick' },
  ]
  for (const c of cases)
    test(c.name, () => {
      expect(claimsJoin(c.account, c.millida, c.profile), c.why).toBe(c.expect)
    })
})

describe('the server a claim names', () => {
  const cases: Array<{ raw: string | null; expect: string; why: string }> = [
    { raw: 'Smp.Millida.Host', expect: 'smp.millida.host', why: 'the gate routes by the lower-case host, a claim in another case would never match' },
    { raw: 'play.example.ru:25570', expect: 'play.example.ru:25570', why: 'the port stays for the API to strip, the game reports it as host:port' },
    { raw: '  mc.example.net  ', expect: 'mc.example.net', why: 'an address pasted with spaces is still that server' },
    { raw: '', expect: '', why: 'a launch without a server has nothing to claim yet; the game reports the server it joins' },
    { raw: null, expect: '', why: 'a single-player launch names no server' },
    { raw: 'bad host', expect: '', why: 'an address with a space is no server, the request would only spend the rate limit' },
    { raw: '...', expect: '', why: 'punctuation alone is no address' },
  ]
  for (const c of cases)
    test(JSON.stringify(c.raw), () => {
      expect(claimHost(c.raw), c.why).toBe(c.expect)
    })
})

test('a claim is renewed before the one-minute limit of the control plane runs out', () => {
  expect(CLAIM_EVERY_MS, 'a claim older than 60 s is dropped and the next join from this address is turned away').toBeLessThan(60_000)
})
