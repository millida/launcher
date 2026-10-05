import type { Plugin } from 'vite'

export interface OldWebKitStats {
  colorMix: number
  colorMixLowered: number
  untinted: number
  aspectRatio: number
  unresolved: string[]
}

export const NO_COLOR_MIX: string
export const NO_ASPECT_RATIO: string
export const ASPECT_CARRIER: string
export function collectRootTokens(sources: string[]): Map<string, string>
export function lowerForOldWebKit(css: string, inherited?: Map<string, string>): { css: string; stats: OldWebKitStats }
export function oldWebKitCss(): Plugin
