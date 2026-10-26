export type DetailLoad = 'loading' | 'ready' | 'failed'

export type ArcaniaOffer = 'play' | 'install' | 'signin' | 'loading' | 'error' | 'buy' | 'key'

export interface ArcaniaOfferState {
  installed: boolean
  signedIn: boolean
  access: boolean
  detail: DetailLoad
  /** The market sells paid packs; elsewhere the API has no plans, but a key bought on the partner site still redeems. */
  sells: boolean
}

/** What stands under the Arcania heading. Every state names something to show: the head is never empty. */
export function arcaniaOffer(s: ArcaniaOfferState): ArcaniaOffer {
  if (s.installed) return 'play'
  if (!s.signedIn) return 'signin'
  if (s.access) return 'install'
  if (!s.sells) return 'key'
  if (s.detail === 'loading') return 'loading'
  if (s.detail === 'failed') return 'error'
  return 'buy'
}

export type HeroAction = 'play' | 'install' | 'reveal'

/** The hero tile plays or installs only when that is the whole answer; otherwise it leads to the offer, never into a payment. */
export const heroAction = (offer: ArcaniaOffer): HeroAction => (offer === 'play' ? 'play' : offer === 'install' ? 'install' : 'reveal')
