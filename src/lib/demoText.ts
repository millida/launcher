import economy from './demoEconomyText.json'
import { getLocale, tx, type Locale } from '../i18n'
import { LAUNCHER_API } from './api'

type CatalogItem = { id?: string; name?: string; variants?: { name?: string; title?: string }[] }

const CYRILLIC = /[А-Яа-яЁё]/
const dictionaries = new Map<Locale, Promise<Map<string, string>>>()

async function catalog(lang: string): Promise<CatalogItem[]> {
  try {
    const r = await fetch(LAUNCHER_API + '/cosmetics/catalog' + (lang ? '?lang=' + encodeURIComponent(lang) : ''))
    if (!r.ok) return []
    const body = (await r.json()) as { items?: CatalogItem[] }
    return Array.isArray(body.items) ? body.items : []
  } catch {
    return []
  }
}

async function build(locale: Locale): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [ru, byLang] of Object.entries(economy as Record<string, Record<string, string>>)) {
    const text = byLang[locale] || byLang.en
    if (text) out.set(ru, text)
  }
  const [source, local] = await Promise.all([catalog(''), catalog(locale)])
  const byId = new Map(local.map((item) => [item.id, item]))
  for (const item of source) {
    const own = byId.get(item.id)
    if (!own) continue
    if (item.name && own.name && item.name !== own.name) out.set(item.name, own.name)
    item.variants?.forEach((v, i) => {
      const title = own.variants?.[i]?.title
      if (v.title && title && v.title !== title) out.set(v.title, title)
    })
  }
  return out
}

function walk(value: unknown, dict: Map<string, string>): unknown {
  if (typeof value === 'string') {
    if (!CYRILLIC.test(value)) return value
    return dict.get(value) ?? tx(value)
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, dict))
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, dict)
    return out
  }
  return value
}

export async function localizeDemoAnswer<T>(answer: T): Promise<T> {
  const locale = getLocale()
  if (locale === 'ru') return answer
  let dict = dictionaries.get(locale)
  if (!dict) {
    dict = build(locale)
    dictionaries.set(locale, dict)
  }
  return walk(answer, await dict) as T
}
