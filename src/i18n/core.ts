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

/// The Russian source string is the key, so Russian needs no table; its only table holds
/// fixes from the site (see remote.ts). A missing translation falls back to English before
/// Russian: a half-translated screen in English is readable for far more players than one in Russian.
export function lookup(locale: Locale, key: string, own: Table | null | undefined, english: Table | null | undefined): string {
  if (locale === 'ru') return own?.[key] || key
  const hit = own?.[key]
  if (hit) return hit
  const en = english?.[key]
  return en || key
}

const CORE_SLOT = /\{\d+\}/
const CYRILLIC = /[А-Яа-яЁё]/
const MAX_DEPTH = 3

interface CoreTemplate {
  key: string
  re: RegExp
  slots: string[]
}

const templateCache = new WeakMap<object, CoreTemplate[]>()

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function coreTemplates(table: Table): CoreTemplate[] {
  const known = templateCache.get(table)
  if (known) return known
  const list: CoreTemplate[] = []
  for (const key of Object.keys(table)) {
    if (!CORE_SLOT.test(key) || !CYRILLIC.test(key.replace(/\{\d+\}/g, ''))) continue
    const slots: string[] = []
    const source = key
      .split(/(\{\d+\})/)
      .map((part) => {
        if (!/^\{\d+\}$/.test(part)) return escapeRe(part)
        slots.push(part.slice(1, -1))
        return '([\\s\\S]*?)'
      })
      .join('')
    list.push({ key, re: new RegExp('^' + source + '$'), slots })
  }
  list.sort((a, b) => b.key.replace(/\{\d+\}/g, '').length - a.key.replace(/\{\d+\}/g, '').length)
  templateCache.set(table, list)
  return list
}

export function localizeCore(
  locale: Locale,
  raw: string,
  own: Table | null | undefined,
  english: Table | null | undefined,
  depth = 0,
): string {
  const text = raw.replace(/^Error:\s*/, '')
  if (locale === 'ru') return own?.[text] || text
  if (!CYRILLIC.test(text) || depth > MAX_DEPTH) return text
  const exact = own?.[text] || english?.[text]
  if (exact) return exact
  const source = english ?? own
  if (!source) return text
  for (const tpl of coreTemplates(source)) {
    const m = tpl.re.exec(text)
    if (!m) continue
    const vars: Record<string, string> = {}
    tpl.slots.forEach((slot, i) => {
      vars[slot] = localizeCore(locale, m[i + 1] ?? '', own, english, depth + 1)
    })
    return interpolate(lookup(locale, tpl.key, own, english), vars)
  }
  return localizeParts(locale, text, own, english, depth) ?? text
}

/// The core joins several reasons into one line ("a; b") and puts a stage, a file or
/// an address in front of a reason ("Распаковка: …", "https://…: reason"). Such a line
/// is no key, but each of its parts is. A split is taken only when every part comes out
/// translated, so a sentence that merely contains a comma never turns into a mix.
const SEPARATORS = ['; ', ', ', ': ']

function localizeParts(locale: Locale, text: string, own: Table | null | undefined, english: Table | null | undefined, depth: number): string | null {
  for (const sep of SEPARATORS) {
    const at = text.indexOf(sep)
    if (at < 0) continue
    const parts = sep === ': ' ? [text.slice(0, at), text.slice(at + sep.length)] : text.split(sep)
    const out = parts.map((part) => localizeCore(locale, part, own, english, depth + 1))
    if (out.every((part) => !CYRILLIC.test(part))) return out.join(sep)
  }
  return null
}

export function translate(locale: Locale, key: string, vars: Vars | undefined, own: Table | null | undefined, english: Table | null | undefined): string {
  return interpolate(lookup(locale, key, own, english), vars)
}
