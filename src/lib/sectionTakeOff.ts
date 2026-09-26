/** What «Снять» in one wardrobe section takes off, or null when nothing is on. */
export interface SectionTakeOff {
  slots: string[]
  accountCape: boolean
}

/**
 * The capes section holds two kinds of cape: the account's own texture and
 * cape cosmetics from the catalogue (slot CAPE). They hang in one place on the
 * back, so the button clears both - it used to know only the texture, and a
 * worn cape cosmetic stayed on.
 */
export function sectionTakeOff(
  section: string,
  sectionSlots: string[],
  worn: { slot: string }[],
  accountCape: boolean,
): SectionTakeOff | null {
  const capes = section === 'cape'
  const slots = capes ? ['CAPE'] : sectionSlots
  const cape = capes && accountCape
  return cape || worn.some((w) => slots.includes(w.slot)) ? { slots, accountCape: cape } : null
}
