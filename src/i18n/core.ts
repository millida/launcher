import type { Locale } from './locales'

export type Table = Readonly<Record<string, string>>
export type Vars = Readonly<Record<string, string | number>>

export const PLACEHOLDER = /\{(\w+)\}/g

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(PLACEHOLDER, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function placeholdersOf(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => m[0]).sort()
}

/// The Russian source string is the key, so Russian needs no table. A missing
/// translation falls back to English before Russian: a half-translated screen in
/// English is readable for far more players than one in Russian.
export function lookup(locale: Locale, key: string, own: Table | null | undefined, english: Table | null | undefined): string {
  if (locale === 'ru') return key
  const hit = own?.[key]
  if (hit) return hit
  const en = english?.[key]
  return en || key
}

export function translate(locale: Locale, key: string, vars: Vars | undefined, own: Table | null | undefined, english: Table | null | undefined): string {
  return interpolate(lookup(locale, key, own, english), vars)
}
