import { describe, expect, test } from 'bun:test'
import { modeLook } from './modeArt'
import { modeTitle } from './data'
import { modeIcon } from './modeIcon'

/**
 * Every mode the rating returned on 30.09.2026 (`/v2/rating/modes`). A code
 * without its own look falls back to a spare colour and the diamond, and a
 * code without a title prints the raw code — on millida.net/katalog too, since
 * the site takes both from scripts/render-mode-art.mjs.
 */
const RATING_CODES = [
  'SURVIVAL', 'ANARCHY', 'RP', 'SKYBLOCK', 'LIFESTEAL', 'BOXPVP', 'COBBLEMON', 'MINIGAMES', 'CREATIVE', 'TECHNICAL',
  'PVP', 'ONEBLOCK', 'GRIEF', 'BEDWARS', 'SKYWARS', 'HUNGER_GAMES', 'KITPVP', 'FACTIONS', 'PRISON', 'TOWNY',
  'MMORPG', 'BUILD_BATTLE', 'PARKOUR', 'HIDE_SEEK', 'MURDER', 'SPLEEF', 'TNTRUN', 'UHC', 'HARDCORE', 'EARTH',
  'MANHUNT', 'BINGO', 'LUCKY', 'VANILLA',
]

/** Names that read the same as the code in title case. */
const NATURAL = new Set(['SPLEEF', 'TOWNY'])

describe('mode tiles cover every rating mode', () => {
  for (const code of RATING_CODES)
    test(code, () => {
      expect(modeLook(code).glyph, 'own icon, not the diamond fallback').not.toBe('diamond')
      expect(modeIcon(code), 'Blups-style icon from scripts/mode-icons.mjs').not.toBeNull()
      if (!NATURAL.has(code))
        expect(modeTitle(code), 'a human title, not the raw code').not.toBe(code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' '))
    })
})

describe('mode rigs', () => {
  test('every mode but OneBlock has its own rig, none repeats', () => {
    const rigs = RATING_CODES.filter((c) => c !== 'ONEBLOCK').map((c) => modeIcon(c)?.rig?.url ?? null)
    expect(rigs.every(Boolean)).toBe(true)
    expect(new Set(rigs).size).toBe(rigs.length)
  })
})
