import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractCoreKeys, extractKeys } from './i18n-extract.mjs'

const LOCALES_DIR = join(import.meta.dirname, '..', 'src', 'i18n', 'locales')

const MODEL = 'deepseek/deepseek-v4.1-flash'
const TEMPERATURE = 0.2
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const BATCH = 50
const CONCURRENCY = 8
const ATTEMPTS = 3

interface Target {
  code: string
  name: string
  register: string
  terms?: string[]
}

const TARGETS: Target[] = [
  { code: 'en', name: 'English (US)', register: 'friendly, casual "you"' },
  { code: 'zh', name: 'Simplified Chinese', register: 'neutral polite register, no honorific inflation' },
  { code: 'hi', name: 'Hindi (Devanagari)', register: 'informal "तुम" register used in games' },
  {
    code: 'es',
    name: 'Spanish (neutral international, natural in Spain and Latin America)',
    register: 'friendly informal "tú" as games address players; never "usted" or "vosotros"',
    terms: ['rank: rango', 'chest: cofre', 'modpack: modpack', 'offline account: cuenta offline', 'Survival: Supervivencia', 'Creative: Creativo', 'skin: skin', 'cape: capa', 'launcher: launcher', 'balance: saldo'],
  },
  { code: 'ar', name: 'Modern Standard Arabic', register: 'neutral register, gender-neutral where possible' },
  { code: 'fr', name: 'French', register: 'informal "tu", as games address players' },
  { code: 'bn', name: 'Bengali', register: 'informal "তুমি" register' },
  {
    code: 'pt-BR',
    name: 'Brazilian Portuguese',
    register: 'friendly neutral "você" as games address players; never "tu"',
    terms: ['rank: rank', 'chest: baú', 'modpack: modpack', 'offline account: conta offline', 'Survival: Sobrevivência', 'Creative: Criativo', 'skin: skin', 'cape: capa', 'launcher: launcher', 'balance: saldo'],
  },
  { code: 'id', name: 'Indonesian', register: 'casual "kamu"' },
  { code: 'ur', name: 'Urdu', register: 'informal "تم" register' },
  {
    code: 'de',
    name: 'German',
    register: 'ALWAYS the formal "Sie" (Ihr, Ihnen), never "du"; short infinitive or imperative on buttons',
    terms: ['rank: Rang', 'chest: Truhe', 'modpack: Modpack', 'offline account: Offline-Konto', 'Survival: Überleben', 'Creative: Kreativ', 'skin: Skin', 'cape: Umhang', 'launcher: Launcher', 'balance: Guthaben'],
  },
  { code: 'ja', name: 'Japanese', register: 'plain polite (です/ます) for sentences, short noun phrases for buttons' },
  { code: 'vi', name: 'Vietnamese', register: 'friendly "bạn"' },
  { code: 'te', name: 'Telugu', register: 'informal "నువ్వు" register' },
  {
    code: 'tr',
    name: 'Turkish',
    register: 'friendly informal "sen" as games address players, consistently; never mix in "siz"',
    terms: ['rank: rütbe', 'chest: sandık', 'modpack: mod paketi', 'offline account: çevrimdışı hesap', 'Survival: Hayatta Kalma', 'Creative: Yaratıcı', 'skin: skin', 'cape: pelerin', 'launcher: başlatıcı', 'balance: bakiye'],
  },
  { code: 'ko', name: 'Korean', register: 'polite 해요체 for sentences, noun phrases for buttons' },
  {
    code: 'pl',
    name: 'Polish',
    register: 'friendly informal "ty" (lowercase) as games address players; impersonal forms on buttons and labels',
    terms: ['rank: ranga', 'chest: skrzynia', 'modpack: modpack', 'offline account: konto offline', 'Survival: Przetrwanie', 'Creative: Kreatywny', 'skin: skin', 'cape: peleryna', 'launcher: launcher', 'balance: saldo'],
  },
  { code: 'uk', name: 'Ukrainian', register: 'friendly informal "ти" as games address players; impersonal forms on buttons and labels' },
  { code: 'sr', name: 'Serbian (Latin script)', register: 'friendly informal "ti"; Latin script only, never Cyrillic' },
  {
    code: 'sk',
    name: 'Slovak',
    register: 'friendly informal "ty" (lowercase) as games address players; impersonal forms on buttons and labels; never Czech words or spelling',
    terms: ['rank: hodnosť', 'chest: truhlica', 'modpack: modpack', 'offline account: offline účet', 'Survival: Prežitie', 'Creative: Tvorivý', 'skin: skin', 'cape: plášť', 'launcher: launcher', 'balance: zostatok'],
  },
]

const PLACEHOLDER = /\{\w+\}/g
const CYRILLIC = /[А-Яа-яЁё]/

const placeholders = (text: string): string => (text.match(PLACEHOLDER) ?? []).sort().join('|')

const SYSTEM = [
  'You translate user-interface strings of a desktop Minecraft launcher.',
  '',
  'Rules, in order of importance:',
  '1. Return ONLY a JSON array. Each element: {"i": <number>, "t": "<translation>"}. Same length and same "i" values as the input. No prose, no markdown fence.',
  '2. Preserve every placeholder EXACTLY as written: {n}, {nick}, {name} and similar. Never translate, reorder inside braces or drop them.',
  '3. Do NOT translate product and brand names: Millida, Minecraft, Microsoft, Java, Modrinth, CurseForge, Forge, Fabric, NeoForge, Quilt, OptiFine, Discord, Telegram, PLUS, Diamond. Server mode names (SkyBlock, BedWars, OneBlock, Anarchy, Lifesteal, SMP, PvP, Duels) stay in English.',
  '4. These are interface strings. Keep them SHORT: a translated button must not be much longer than the source. A button is an imperative or infinitive, a heading is a short phrase.',
  '5. Keep the meaning exact for anything about money, prices, limits, accounts or errors. Do not soften, embellish or add words.',
  '6. A bare technical token (an ALL_CAPS code, a file name, a URL, a version number) is returned unchanged.',
  '7. Use the official localized Minecraft names of blocks, items, mobs and game modes.',
].join('\n')

interface Entry {
  key: string
  source: string
}

type Table = Record<string, string>

const usage = { cost: 0, calls: 0 }
const warnings: string[] = []

function costLimit(): number {
  const raw = Number(process.env.I18N_COST_LIMIT ?? '')
  return Number.isFinite(raw) && raw > 0 ? raw : Infinity
}

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

function systemFor(target: Target, sourceName: string): string {
  const lines = [SYSTEM, '', `Source language: ${sourceName}. Target language: ${target.name}. Register: ${target.register}.`]
  if (target.terms?.length) lines.push('Glossary (English term: required translation, used consistently):', ...target.terms.map((t) => `- ${t}`))
  return lines.join('\n')
}

const CYRILLIC_TARGETS = new Set(['uk'])

function problem(source: string, text: string, cyrillicAllowed: boolean): string | null {
  if (!text.trim()) return 'empty'
  if (placeholders(source) !== placeholders(text)) return 'placeholders'
  if (!cyrillicAllowed && CYRILLIC.test(text) && !CYRILLIC.test(source)) return 'cyrillic'
  return null
}

const tooLong = (source: string, text: string): boolean => source.length <= 30 && text.length > Math.max(source.length * 2, source.length + 18)

async function callModel(target: Target, sourceName: string, batch: Entry[], attempt: number): Promise<string[]> {
  if (usage.cost > costLimit()) {
    console.error(`cost limit reached: $${usage.cost.toFixed(4)}, stopping`)
    process.exit(3)
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'X-Title': 'millida-launcher-i18n',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: TEMPERATURE,
      usage: { include: true },
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: systemFor(target, sourceName) },
        { role: 'user', content: JSON.stringify(batch.map((e, i) => ({ i, s: e.source }))) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } }
  usage.calls += 1
  usage.cost += json.usage?.cost ?? 0
  const raw = json.choices?.[0]?.message?.content ?? ''
  const parsed = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as { i?: unknown; t?: unknown }[]
  if (!Array.isArray(parsed) || parsed.length !== batch.length) throw new Error('length mismatch')
  const rows = new Map(parsed.map((p) => [p?.i, p?.t]))
  return batch.map((entry, i) => {
    const text = rows.get(i)
    if (typeof text !== 'string') throw new Error('missing row')
    const bad = problem(entry.source, text, CYRILLIC_TARGETS.has(target.code))
    if (bad) throw new Error(`${bad}: ${entry.source.slice(0, 60)}`)
    if (tooLong(entry.source, text)) {
      if (attempt < ATTEMPTS) throw new Error(`too long: ${entry.source}`)
      warnings.push(`${target.code} long: "${entry.source}" -> "${text}"`)
    }
    return text.trim()
  })
}

async function translateBatch(target: Target, sourceName: string, batch: Entry[]): Promise<Map<string, string>> {
  let reason = ''
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const out = await callModel(target, sourceName, batch, attempt)
      return new Map(batch.map((e, i) => [e.key, out[i] as string]))
    } catch (e) {
      reason = (e as Error).message
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  if (batch.length > 1) {
    const half = Math.ceil(batch.length / 2)
    const [a, b] = await Promise.all([translateBatch(target, sourceName, batch.slice(0, half)), translateBatch(target, sourceName, batch.slice(half))])
    return new Map([...a, ...b])
  }
  warnings.push(`${target.code}: left for the next run (${reason.slice(0, 120)})`)
  return new Map()
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await worker(items[next++] as T)
    }),
  )
}

async function run(): Promise<void> {
  const args = process.argv.slice(2)
  const only = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
  const dry = args.includes('--dry')
  if (!dry && !process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set in the environment.')
    process.exit(1)
  }

  const keys = [...new Set([...(extractKeys() as Map<string, string>).keys(), ...(extractCoreKeys() as Map<string, string>).keys()])]
  const codes = only ? only.split(',') : TARGETS.map((t) => t.code)
  const targets = TARGETS.filter((t) => codes.includes(t.code))
  if (targets.length !== codes.length) {
    console.error(`Unknown --lang ${only}. Known: ${TARGETS.map((t) => t.code).join(', ')}`)
    process.exit(1)
  }

  for (const target of targets) {
    // Other languages translate from English: it is proofread, and Russian idioms do not survive two hops.
    // A key without English waits for the English pass instead of being translated from Russian.
    const english = target.code === 'en' ? {} : readTable('en')
    const existing = readTable(target.code)
    // English also holds texts the scan cannot see, such as stage lists rendered through t(name).
    const missing: Entry[] = [...new Set([...keys, ...Object.keys(english)])]
      .filter((k) => target.code === 'en' || english[k])
      .filter((k) => !existing[k] || problem(english[k] || k, existing[k] as string, CYRILLIC_TARGETS.has(target.code)) !== null)
      .map((key) => ({ key, source: english[key] || key }))
      .slice(0, limit)
    const sourceName = target.code === 'en' ? 'Russian' : 'English'
    const batches: Entry[][] = []
    for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH))
    console.log(`${target.code} from ${sourceName}: ${missing.length} strings, ${batches.length} batches, ${Object.keys(existing).length} present`)
    if (dry || !missing.length) continue
    const merged = new Map<string, string>()
    await pool(batches, CONCURRENCY, async (batch) => {
      for (const [k, v] of await translateBatch(target, sourceName, batch)) merged.set(k, v)
    })
    writeTable(target.code, { ...existing, ...Object.fromEntries(merged) })
    console.log(`${target.code}: translated ${merged.size}/${missing.length}; calls ${usage.calls}, cost $${usage.cost.toFixed(4)}`)
  }
  for (const w of warnings) console.log(`warning ${w}`)
}

void run()
