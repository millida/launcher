import { create } from 'zustand'

const DAYTIME_KEY = 'm-lobby-daytime'
const SEASON_KEY = 'm-lobby-season'

function read(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function write(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {}
}

interface AmbienceState {
  /** The lobby light follows the player's clock. Off by default: it changes the approved look. */
  daytime: boolean
  /** Snow, pumpkins and fireworks on their dates. */
  seasonal: boolean
  setDaytime: (on: boolean) => void
  setSeasonal: (on: boolean) => void
}

export const useAmbience = create<AmbienceState>((set) => ({
  daytime: read(DAYTIME_KEY, false),
  seasonal: read(SEASON_KEY, true),
  setDaytime: (on) => {
    write(DAYTIME_KEY, on)
    set({ daytime: on })
  },
  setSeasonal: (on) => {
    write(SEASON_KEY, on)
    set({ seasonal: on })
  },
}))
