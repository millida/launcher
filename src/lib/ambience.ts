export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'
export type Season = 'halloween' | 'winter' | 'newyear'

/// Local hours on the player's clock: 5–8 dawn, 8–18 day, 18–21 dusk, otherwise night.
export function dayPhase(d: Date): DayPhase {
  const h = d.getHours()
  if (h >= 5 && h < 8) return 'dawn'
  if (h >= 8 && h < 18) return 'day'
  if (h >= 18 && h < 21) return 'dusk'
  return 'night'
}

/// Fireworks around New Year win over the winter snow they fall inside.
export function seasonOf(d: Date): Season | null {
  const m = d.getMonth() + 1
  const day = d.getDate()
  if ((m === 12 && day >= 31) || (m === 1 && day <= 2)) return 'newyear'
  if ((m === 10 && day >= 20) || (m === 11 && day <= 2)) return 'halloween'
  if ((m === 12 && day >= 10) || (m === 1 && day <= 20)) return 'winter'
  return null
}

/// Pixel particle look per season: colours come from the theme where possible.
export interface ParticleStyle {
  colors: string[]
  size: [number, number]
  fall: [number, number]
  drift: number
  count: number
}

export function particleStyle(s: Season): ParticleStyle {
  switch (s) {
    case 'winter':
      return { colors: ['#ffffff', '#dfefff'], size: [2, 4], fall: [18, 46], drift: 14, count: 70 }
    case 'halloween':
      return { colors: ['#ff8a1f', '#e86a0c', '#3a2a1a'], size: [3, 6], fall: [10, 26], drift: 22, count: 26 }
    case 'newyear':
      return { colors: ['#ffd84a', '#ff5ca8', '#5cd6ff', '#7dff6a'], size: [2, 3], fall: [0, 0], drift: 0, count: 0 }
  }
}
