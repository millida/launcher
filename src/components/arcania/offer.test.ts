import { expect, test } from 'bun:test'
import { arcaniaOffer, heroAction, type ArcaniaOffer, type ArcaniaOfferState, type HeroAction } from './offer'

const base: ArcaniaOfferState = { installed: false, signedIn: true, access: false, detail: 'ready', sells: true }

const cases: Array<[Partial<ArcaniaOfferState>, ArcaniaOffer, HeroAction, string]> = [
  [{ installed: true }, 'play', 'play', 'an installed pack plays from the head and from the hero tile'],
  [{ installed: true, signedIn: false }, 'play', 'play', 'a guest who already has the pack on disk is not sent to sign in'],
  [{ installed: true, detail: 'failed' }, 'play', 'play', 'a failed price request must not hide Play for an installed pack'],
  [{ access: true }, 'install', 'install', 'access without the pack on disk installs'],
  [{ access: true, detail: 'loading' }, 'install', 'install', 'access already known from the lobby card does not wait for the detail'],
  [{ signedIn: false }, 'signin', 'reveal', 'buying and keys need a Millida account: a guest gets the sign-in prompt, not an empty head'],
  [{ signedIn: false, detail: 'failed' }, 'signin', 'reveal', 'a guest is not shown a network error for prices they cannot use yet'],
  [{ detail: 'loading' }, 'loading', 'reveal', 'while the plans load the head holds a placeholder, not empty space'],
  [{ detail: 'failed' }, 'error', 'reveal', 'a failed load says so and offers Retry: this was the empty head players kept asking about'],
  [{}, 'buy', 'reveal', 'no access: plans and the key block; the hero tile scrolls to them and never clicks a payment'],
  [{ sells: false, detail: 'failed' }, 'key', 'reveal', 'a market without paid packs still redeems a key bought on the partner site'],
]

test.each(cases)('%p -> %p', (patch, offer, hero, why) => {
  const got = arcaniaOffer({ ...base, ...patch })
  expect(got, why).toBe(offer)
  expect(heroAction(got), why).toBe(hero)
})
