import { describe, expect, test } from 'bun:test'
import type { SkinModState } from '../ipc/commands'
import { isOwnModFile, keepAfterOwnModConfirm, skinModOff } from './millidaModGuard'

describe('which file is our mod', () => {
  const cases: Array<{ name: string; want: boolean; why: string }> = [
    { name: 'millida-mod-fabric-1.20.1-0.2.18.jar', want: true, why: 'the name the core gives the jar it installs' },
    { name: 'millida-mod-forge-1.20.1-0.2.18.jar.disabled', want: true, why: 'a switched-off copy is still ours' },
    { name: 'sodium-fabric-0.6.jar', want: false, why: 'the player removes ordinary mods without our question' },
    { name: 'CustomSkinLoader.jar', want: false, why: 'the question talks about Millida cosmetics, not the fallback skin mod' },
    { name: 'my-millida-mod-fabric.jar', want: false, why: 'only the prefix the core writes counts' },
    { name: 'millida-mod-fabric-1.20.1-0.2.18.zip', want: false, why: 'the core only treats jars as our mod' },
  ]
  for (const c of cases)
    test(c.name, () => {
      expect(isOwnModFile(c.name), c.why).toBe(c.want)
    })
})

describe('removing our mod asks first', () => {
  const own = 'millida-mod-fabric-1.20.1-0.2.18.jar'
  const other = 'sodium-fabric-0.6.jar'
  const cases: Array<{ names: string[]; answer: boolean; asked: boolean; want: string[]; why: string }> = [
    { names: [other], answer: false, asked: false, want: [other], why: 'other mods are removed exactly as before, no extra question' },
    { names: [own], answer: true, asked: true, want: [own], why: 'a confirmed removal goes ahead' },
    { names: [own], answer: false, asked: true, want: [], why: 'a declined removal keeps the cosmetics in the build' },
    { names: [other, own], answer: false, asked: true, want: [other], why: 'declining in a bulk delete keeps only our jar, the rest still goes' },
    { names: [other, own], answer: true, asked: true, want: [other, own], why: 'confirming in a bulk delete removes everything selected' },
  ]
  for (const c of cases)
    test(c.why, async () => {
      let asked = false
      const got = await keepAfterOwnModConfirm(c.names, async () => {
        asked = true
        return c.answer
      })
      expect(asked, 'whether the player was asked').toBe(c.asked)
      expect(got, c.why).toEqual(c.want)
    })
})

describe('why the skin mod is off in this build', () => {
  const base: SkinModState = { on: true, present: false, conflict: null, offReason: null, quarantine: null }
  const cases: Array<{ state: SkinModState | null; want: ReturnType<typeof skinModOff>; why: string }> = [
    { state: null, want: null, why: 'nothing loaded yet: no reason to show' },
    { state: base, want: null, why: 'the mod is on and nothing holds it back' },
    { state: { ...base, on: false, offReason: 'removed' }, want: { kind: 'removed' }, why: 'the player deleted our jar from the mods list' },
    { state: { ...base, on: false, offReason: 'off' }, want: { kind: 'off' }, why: 'the player flipped the switch' },
    { state: { ...base, on: false, offReason: 'crash' }, want: null, why: 'an old CustomSkinLoader crash keeps the existing hint' },
    { state: { ...base, quarantine: '0.2.18' }, want: { kind: 'quarantine', version: '0.2.18' }, why: 'a crash quarantine holds the mod back even with the switch on' },
    { state: { ...base, on: false, offReason: 'removed', quarantine: '0.2.18' }, want: { kind: 'quarantine', version: '0.2.18' }, why: 'the crash is the reason the player needs to see first' },
    { state: { ...base, conflict: 'HDSkins-1.20.jar', quarantine: '0.2.18' }, want: null, why: 'a foreign skin mod already explains itself in the row' },
  ]
  for (const c of cases)
    test(c.why, () => {
      expect(skinModOff(c.state), c.why).toEqual(c.want)
    })
})
