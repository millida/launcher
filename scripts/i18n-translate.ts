import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractKeys } from './i18n-extract.mjs'

const LOCALES_DIR = join(import.meta.dirname, '..', 'src', 'i18n', 'locales')

const MODEL = 'z-ai/glm-5.3-flash'
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const BATCH = 60
const CONCURRENCY = 6
const ATTEMPTS = 3

interface Target {
  code: string
  name: string
  register: string
}

const TARGETS: Target[] = [
  { code: 'en', name: 'English (US)', register: 'friendly, casual "you"' },
  { code: 'zh', name: 'Simplified Chinese', register: 'neutral polite register, no honorific inflation' },
  { code: 'hi', name: 'Hindi (Devanagari)', register: 'informal "तुम" register used in games' },
  { code: 'es', name: 'Spanish (Latin America)', register: 'informal "tú"' },
  { code: 'ar', name: 'Modern Standard Arabic', register: 'neutral register, gender-neutral where possible' },
  { code: 'fr', name: 'French', register: 'informal "tu", as games address players' },
  { code: 'bn', name: 'Bengali', register: 'informal "তুমি" register' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', register: 'informal "você"' },
  { code: 'id', name: 'Indonesian', register: 'casual "kamu"' },
  { code: 'ur', name: 'Urdu', register: 'informal "تم" register' },
  { code: 'de', name: 'German', register: 'informal "du", as games address players' },
  { code: 'ja', name: 'Japanese', register: 'plain polite (です/ます) for sentences, short noun phrases for buttons' },
  { code: 'vi', name: 'Vietnamese', register: 'friendly "bạn"' },
  { code: 'te', name: 'Telugu', register: 'informal "నువ్వు" register' },
  { code: 'tr', name: 'Turkish', register: 'informal "sen"' },
  { code: 'ko', name: 'Korean', register: 'polite 해요체 for sentences, noun phrases for buttons' },
]

const PLACEHOLDER = /\{\w+\}/g

const placeholders = (text: string): string => (text.match(PLACEHOLDER) ?? []).sort().join('|')

const SYSTEM = [
  'You translate user-interface strings of a desktop Minecraft launcher.',
  '',
  'Rules, in order of importance:',
  '1. Return ONLY a JSON array. Each element: {"i": <number>, "t": "<translation>"}. Same length and same "i" values as the input. No prose, no markdown fence.',
  '2. Preserve every placeholder EXACTLY as written: {n}, {nick}, {name} and similar. Never translate, reorder inside braces or drop them.',
  '4. These are interface strings. Keep them SHORT: a translated button must not be much longer than the source. A button is an imperative, a heading is a short phrase.',
  '5. Keep the meaning exact for anything about money, prices, limits, accounts or errors. Do not soften, embellish or add words.',
  '6. A bare technical token (an ALL_CAPS code, a file name, a URL, a version number) is returned unchanged.',
].join('\n')

interface Entry {
  key: string
  source: string
}

type Table = Record<string, string>

function readTable(code: string): Table {
  const path = join(LOCALES_DIR, code + '.json')
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Table) : {}
  } catch (e) {
    throw new Error(`${path} is not valid JSON, fix it before translating: ${String(e)}`)
  }
}

function writeTable(code: string, table: Table) {
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b, 'ru')))
  writeFileSync(join(LOCALES_DIR, code + '.json'), JSON.stringify(sorted, null, 2) + '\n', 'utf8')
}

async function callModel(target: Target, sourceName: string, batch: Entry[], attempt: number): Promise<string[] | null> {
  const payload = batch.map((e, i) => ({ i, s: e.source }))
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'X-Title': 'millida-launcher-i18n',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: attempt === 1 ? 0.2 : 0,
      messages: [
        { role: 'system', content: `${SYSTEM}\n\nSource language: ${sourceName}. Target language: ${target.name}. Register: ${target.register}.` },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  })
  if (!res.ok) {
    console.error(`  ${target.code}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
    return null
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = json.choices?.[0]?.message?.content ?? ''
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end < 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== batch.length) return null
  const out: string[] = new Array(batch.length)
  for (const row of parsed as { i?: unknown; t?: unknown }[]) {
    if (typeof row?.i !== 'number' || typeof row?.t !== 'string') return null
    if (row.i < 0 || row.i >= batch.length) return null
    out[row.i] = row.t
  }
  for (let i = 0; i < out.length; i++) {
    const text = out[i]
    const entry = batch[i]
    if (typeof text !== 'string' || !text.trim() || !entry) return null
    if (placeholders(entry.source) !== placeholders(text)) return null
  }
  return out
}

async function translateBatch(target: Target, sourceName: string, batch: Entry[]): Promise<Map<string, string>> {
  const done = new Map<string, string>()
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const out = await callModel(target, sourceName, batch, attempt)
    if (out) {
      batch.forEach((e, i) => done.set(e.key, out[i] as string))
      return done
    }
    await new Promise((r) => setTimeout(r, 400 * attempt))
  }
  console.error(`  ${target.code}: batch of ${batch.length} failed ${ATTEMPTS} attempts, left for the next run`)
  return done
}

async function run(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set in the environment.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const only = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
  const dry = args.includes('--dry')

  const keys = [...(extractKeys() as Map<string, string>).keys()]
  const targets = only ? TARGETS.filter((t) => t.code === only) : TARGETS
  if (!targets.length) {
    console.error(`Unknown --lang ${only}. Known: ${TARGETS.map((t) => t.code).join(', ')}`)
    process.exit(1)
  }

  for (const target of targets) {
    // Other languages translate from English: it is closer to what an
    // international player reads, and Russian idioms do not survive two hops.
    const english = target.code === 'en' ? {} : readTable('en')
    const existing = readTable(target.code)
    const missing: Entry[] = keys
      .filter((k) => !existing[k])
      .map((key) => ({ key, source: english[key] || key }))
      .slice(0, limit)
    if (!missing.length) {
      console.log(`${target.code}: nothing to translate (${Object.keys(existing).length} present)`)
      continue
    }
    const sourceName = (k: Entry) => (english[k.key] ? 'English' : 'Russian')
    const groups = new Map<string, Entry[]>()
    for (const e of missing) groups.set(sourceName(e), [...(groups.get(sourceName(e)) ?? []), e])

    const merged = new Map<string, string>()
    for (const [lang, entries] of groups) {
      const batches: Entry[][] = []
      for (let i = 0; i < entries.length; i += BATCH) batches.push(entries.slice(i, i + BATCH))
      console.log(`${target.code} from ${lang}: ${entries.length} strings, ${batches.length} batches`)
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const wave = batches.slice(i, i + CONCURRENCY)
        const results = await Promise.all(wave.map((b) => translateBatch(target, lang, b)))
        for (const r of results) for (const [k, v] of r) merged.set(k, v)
      }
    }
    if (!dry && merged.size) writeTable(target.code, { ...existing, ...Object.fromEntries(merged) })
    console.log(`${target.code}: translated ${merged.size}, already had ${Object.keys(existing).length}${dry ? ' (dry run, nothing written)' : ''}`)
  }
}

void run()
