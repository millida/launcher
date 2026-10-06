import { api, apiHeaders, LAUNCHER_API, MODRINTH_API, mirrorAsset } from '../lib/api'
import { hasTauri } from '../ipc/tauri'
import { tidyBody } from './projectView'

/*
 * Перевод описания мода и карта зависимостей для окна мода.
 *
 * Перевод: GET /catalog/milli/translate?source=modrinth&id=<slug>&lang=ru
 * (контракт с milli-server, 04.10.2026). Сервер сам берёт описание, режет на
 * блоки, переводит в фоне и кэширует навсегда на всех игроков: первый игрок
 * видит, как блоки проявляются, остальные получают перевод сразу.
 */

export type TrKind = 'heading' | 'para' | 'list' | 'table' | 'quote' | 'code' | 'image' | 'html' | 'hr'
export type TrTier = 'community' | 'ai' | 'draft' | 'seed' | 'same' | null

export interface TrBlock {
  src: string
  ru: string | null
  /** Стабильный хэш блока — для правок игроков (контракт v2; старый сервер может не прислать). */
  id?: string
  kind?: TrKind
  tier?: TrTier
  /** Высота заглушки в строках по ~72 символа. */
  lines?: number
}

/** Мгновенная русская сводка о моде: есть всегда, даже без единого переведённого абзаца. */
export interface TrSummary {
  title: string
  text: string
  loaders: string[]
  categories: string[]
  /** До 10 официальных русских названий предметов из ru_ru.json мода. */
  adds: string[]
  source?: 'curated' | 'tm' | 'template'
}

export interface TrEngine {
  ai: boolean
  draft: boolean
  queued: number
  retryInSec: number | null
}

/** Короткий текст с переводом: описание Modrinth, подпись картинки, имя версии. */
export interface TrText {
  src: string
  ru: string | null
  tier: TrTier
}

export interface TrGallery {
  url: string
  title: TrText | null
  description: TrText | null
}

export interface TrView {
  done: boolean
  projectId?: string
  hash?: string
  truncated?: boolean
  blocks: TrBlock[]
  summary?: TrSummary | null
  engine?: TrEngine | null
  /** v2.1: описание Modrinth (строка под названием). */
  description?: TrText | null
  /** v2.1: подписи галереи. */
  gallery?: TrGallery[]
  /** v2.1: доля переведённых кусков 0..1. */
  coverage?: number
}

/** Ошибка перевода словами: 503 milli_off — «временно недоступен». */
export class TrError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Тестовая Милли через прокси Vite — как request() в lib/milli.ts.
  if (import.meta.env.DEV && import.meta.env.VITE_MILLI_TEST === '1') return devFetch<T>('/milli-test' + path, init, { 'Content-Type': 'application/json' })
  if (hasTauri() || !import.meta.env.DEV) return api<T>(path, init)
  return devFetch<T>(LAUNCHER_API + path, init, apiHeaders())
}

async function devFetch<T>(url: string, init: RequestInit | undefined, headers: HeadersInit): Promise<T> {
  const r = await fetch(url, { ...init, headers })
  if (!r.ok) {
    let msg = ''
    try {
      const b = (await r.json()) as { message?: string }
      msg = b.message || ''
    } catch {}
    throw new TrError(msg || 'http ' + r.status, r.status)
  }
  return r.json() as Promise<T>
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export function normText(v: unknown): TrText | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.src !== 'string') return null
  return { src: o.src, ru: typeof o.ru === 'string' ? o.ru : null, tier: typeof o.tier === 'string' ? (o.tier as TrTier) : null }
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])

/** Ответ сервера → вид для окна: чужие и недостающие поля не роняют отрисовку. */
export function normView(v: unknown): TrView {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const blocks: TrBlock[] = (Array.isArray(o.blocks) ? o.blocks : [])
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && typeof (b as { src?: unknown }).src === 'string')
    .map((b) => ({
      src: b.src as string,
      ru: typeof b.ru === 'string' ? b.ru : null,
      id: typeof b.id === 'string' ? b.id : undefined,
      kind: typeof b.kind === 'string' ? (b.kind as TrKind) : undefined,
      tier: typeof b.tier === 'string' ? (b.tier as TrTier) : null,
      lines: typeof b.lines === 'number' && b.lines > 0 ? b.lines : undefined,
    }))
  const gallery: TrGallery[] = (Array.isArray(o.gallery) ? o.gallery : [])
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g) => ({ url: typeof g.url === 'string' ? g.url : '', title: normText(g.title), description: normText(g.description) }))
  const sm = o.summary && typeof o.summary === 'object' ? (o.summary as Record<string, unknown>) : null
  const en = o.engine && typeof o.engine === 'object' ? (o.engine as Record<string, unknown>) : null
  return {
    done: !!o.done,
    projectId: typeof o.projectId === 'string' ? o.projectId : undefined,
    hash: typeof o.hash === 'string' ? o.hash : undefined,
    truncated: !!o.truncated,
    blocks,
    summary: sm
      ? {
          title: typeof sm.title === 'string' ? sm.title : '',
          text: typeof sm.text === 'string' ? sm.text : '',
          loaders: strs(sm.loaders),
          categories: strs(sm.categories),
          adds: strs(sm.adds).slice(0, 10),
          source: typeof sm.source === 'string' ? (sm.source as TrSummary['source']) : undefined,
        }
      : null,
    description: normText(o.description),
    gallery,
    coverage: typeof o.coverage === 'number' ? o.coverage : undefined,
    engine: en
      ? {
          ai: !!en.ai,
          draft: !!en.draft,
          queued: typeof en.queued === 'number' ? en.queued : 0,
          retryInSec: typeof en.retryInSec === 'number' && en.retryInSec > 0 ? en.retryInSec : null,
        }
      : null,
  }
}

/** Все абзацы переведены (или переводить нечего). */
export const trComplete = (v: TrView): boolean =>
  v.done &&
  v.blocks.every((b) => b.ru !== null) &&
  (!v.description || v.description.ru !== null || !hasWords(v.description.src)) &&
  (v.gallery || []).every((g) => (!g.title || g.title.ru !== null || !hasWords(g.title.src)) && (!g.description || g.description.ru !== null || !hasWords(g.description.src)))

/** В тексте есть слова (а не только номер версии, код или ссылка) — его есть что переводить. */
export function hasWords(s: string): boolean {
  const plain = s.replace(/https?:\S+|`[^`]*`/g, ' ')
  return /[A-Za-z]{3,}/.test(plain) && !/[а-яё]/i.test(plain)
}

/**
 * Русский вариант короткого текста для режима RU: строка — показываем её;
 * null — переводится (на месте заглушка); исходник без слов — он сам.
 */
export function ruOrPending(t: TrText | null | undefined, src: string): string | null {
  if (!src) return ''
  if (t && t.ru !== null) return t.ru
  if (!hasWords(src)) return src
  return null
}

/** Подпись картинки галереи по её исходному тексту. */
export function galleryText(v: TrView | null, src: string, field: 'title' | 'description'): TrText | null {
  if (!v || !v.gallery || !src) return null
  for (const g of v.gallery) {
    const t = g[field]
    if (t && t.src.trim() === src.trim()) return t
  }
  return null
}

/// Переводы за сессию по моду (вместе с hash описания): повторное открытие
/// показывает их сразу, а недопереведённые ещё и дозапрашивает.
const doneCache = new Map<string, TrView>()

export const translateKey = (id: string) => 'modrinth:' + id

export function cachedTranslation(id: string): TrView | null {
  return doneCache.get(translateKey(id)) || null
}

function remember(id: string, v: TrView): void {
  const k = translateKey(id)
  const old = doneCache.get(k)
  // Тот же текст (hash) и прошлый срез полнее — не откатываемся назад.
  if (old && old.hash && old.hash === v.hash && ready(old) > ready(v)) return
  doneCache.set(k, v)
}

const ready = (v: TrView) =>
  v.blocks.reduce((n, b) => n + (b.ru !== null ? 1 : 0), 0) +
  (v.description && v.description.ru !== null ? 1 : 0) +
  (v.gallery || []).reduce((n, g) => n + (g.title && g.title.ru !== null ? 1 : 0) + (g.description && g.description.ru !== null ? 1 : 0), 0)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/// Сколько ждём фоновой работы сервера целиком, пока окно открыто.
const FOREGROUND_MS = 90000
const MAX_RETRIES = 12

/**
 * Перевод с опросом: `onUpdate` получает каждый новый срез, пока сервер не
 * скажет done (промис решается на нём). Остались непереведённые абзацы и
 * сервер назвал engine.retryInSec — тихо переспрашиваем, пока `alive()`
 * (окно всё ещё на этом моде); новые срезы приходят в тот же `onUpdate`.
 */
export async function translateProject(
  id: string,
  onUpdate: (v: TrView) => void,
  alive: () => boolean,
): Promise<TrView> {
  const hit = cachedTranslation(id)
  if (hit) {
    onUpdate(hit)
    if (trComplete(hit)) return hit
  }
  const path = '/catalog/milli/translate?source=modrinth&id=' + encodeURIComponent(id) + '&lang=ru'
  const started = Date.now()
  let view: TrView
  for (;;) {
    view = normView(await request<unknown>(path))
    if (!alive()) return view
    if (view.done) break
    if (Date.now() - started > FOREGROUND_MS) {
      if (!view.blocks.length) throw new TrError('Перевод занял слишком долго', 504)
      // Что успело — показываем, остальное доспрашиваем реже.
      view = { ...view, done: true, engine: { ai: false, draft: false, queued: 0, ...view.engine, retryInSec: 30 } }
      break
    }
    onUpdate(view)
    await sleep(1200)
    if (!alive()) return view
  }
  remember(id, view)
  onUpdate(view)
  if (!trComplete(view)) void repoll(id, path, view, onUpdate, alive)
  return view
}

async function repoll(id: string, path: string, first: TrView, onUpdate: (v: TrView) => void, alive: () => boolean): Promise<void> {
  let view = first
  for (let i = 0; i < MAX_RETRIES; i++) {
    const sec = view.engine && view.engine.retryInSec
    if (!sec || trComplete(view)) return
    await sleep(Math.min(300, Math.max(5, sec)) * 1000)
    if (!alive()) return
    try {
      const next = normView(await request<unknown>(path))
      if (!alive()) return
      // done:false посреди дозапроса — сервер снова переводит; ждём коротко.
      view = next.done ? next : { ...next, done: true, engine: { ai: false, draft: false, queued: 0, ...next.engine, retryInSec: 3 } }
      if (ready(view) >= ready(first) || view.hash !== first.hash) {
        remember(id, view)
        onUpdate(view)
      }
    } catch {
      // Сеть моргнула — следующая попытка позже, окно уже показывает что есть.
    }
  }
}

/* ── Список изменений версий (v2.1): лениво, когда открыта вкладка «Версии» ── */

export interface TrVersion {
  id: string
  name: TrText | null
  blocks: TrBlock[]
}

export interface TrChangelog {
  done: boolean
  projectId?: string
  versions: TrVersion[]
  engine?: TrEngine | null
}

const logCache = new Map<string, TrChangelog>()

function normChangelog(v: unknown): TrChangelog {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const en = o.engine && typeof o.engine === 'object' ? (o.engine as Record<string, unknown>) : null
  return {
    done: !!o.done,
    projectId: typeof o.projectId === 'string' ? o.projectId : undefined,
    versions: (Array.isArray(o.versions) ? o.versions : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
      .map((x) => ({ id: x.id as string, name: normText(x.name), blocks: normView({ blocks: x.blocks }).blocks })),
    engine: en ? { ai: !!en.ai, draft: !!en.draft, queued: Number(en.queued) || 0, retryInSec: typeof en.retryInSec === 'number' && en.retryInSec > 0 ? en.retryInSec : null } : null,
  }
}

const logComplete = (c: TrChangelog) =>
  c.done && c.versions.every((v) => (!v.name || v.name.ru !== null || !hasWords(v.name.src)) && v.blocks.every((b) => b.ru !== null))

/**
 * Имена версий и списки изменений по-русски. Опрос как у описания: пока не
 * done — часто, потом по engine.retryInSec, пока `alive()`.
 */
export async function translateChangelog(id: string, onUpdate: (c: TrChangelog) => void, alive: () => boolean): Promise<void> {
  const k = translateKey(id)
  const hit = logCache.get(k)
  if (hit) {
    onUpdate(hit)
    if (logComplete(hit)) return
  }
  const path = '/catalog/milli/translate/changelog?source=modrinth&id=' + encodeURIComponent(id) + '&limit=20'
  const started = Date.now()
  let tries = 0
  for (;;) {
    const c = normChangelog(await request<unknown>(path))
    if (!alive()) return
    logCache.set(k, c)
    onUpdate(c)
    if (logComplete(c)) return
    let wait = 1200
    if (c.done || Date.now() - started > FOREGROUND_MS) {
      const sec = c.engine && c.engine.retryInSec
      if (!sec || ++tries > MAX_RETRIES) return
      wait = Math.min(300, Math.max(5, sec)) * 1000
    }
    await sleep(wait)
    if (!alive()) return
  }
}

/** Что окно пишет, когда перевод не вышел. */
export function trErrorText(e: unknown): string {
  if (e instanceof TrError) {
    if (e.status === 503) return 'Перевод временно недоступен'
    if (e.status === 404) return 'Для этого мода перевода нет'
    if (e.status === 429) return 'Лимит переводов на сегодня исчерпан'
    if (e.status === 401) return 'Войди в аккаунт Millida, чтобы переводить'
    return e.message
  }
  return 'Перевод не загрузился'
}

const LANG_KEY = 'm-pj-lang'

/** Русский по умолчанию; «Оригинал» — только явный выбор игрока, и он запоминается. */
export function savedLang(): 'ru' | 'en' {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ru'
  } catch {
    return 'ru'
  }
}

export function saveLang(v: 'ru' | 'en'): void {
  try {
    localStorage.setItem(LANG_KEY, v)
  } catch {}
}

/* ── Правки перевода от игроков ── */

export interface TrSuggestion {
  id: string
  ru: string
  votes: number
}

const VOTER_KEY = 'm-tr-voter'
let voterMem = ''

/** Анонимный id установки для голосов: без аккаунта и личных данных. */
export function voterId(): string {
  if (voterMem) return voterMem
  let v = ''
  try {
    v = localStorage.getItem(VOTER_KEY) || ''
  } catch {}
  if (!/^[\w-]{8,64}$/.test(v)) {
    try {
      v = crypto.randomUUID()
    } catch {
      v = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
    }
    try {
      localStorage.setItem(VOTER_KEY, v)
    } catch {}
  }
  voterMem = v
  return v
}

export function suggestEdit(projectId: string, blockId: string, ru: string): Promise<{ id: string; votes: number; accepted: boolean }> {
  return request('/catalog/milli/translate/suggest', post({ projectId, blockId, ru, voter: voterId() }))
}

export function voteSuggestion(suggestionId: string, up: boolean): Promise<{ votes: number; accepted: boolean }> {
  return request('/catalog/milli/translate/vote', post({ suggestionId, voter: voterId(), up }))
}

export async function blockSuggestions(projectId: string, blockId: string): Promise<TrSuggestion[]> {
  const r = await request<{ items?: unknown }>(
    '/catalog/milli/translate/suggestions?projectId=' + encodeURIComponent(projectId) + '&blockId=' + encodeURIComponent(blockId),
  )
  return (Array.isArray(r && r.items) ? (r.items as Record<string, unknown>[]) : [])
    .filter((x) => x && typeof x.id === 'string' && typeof x.ru === 'string')
    .map((x) => ({ id: x.id as string, ru: x.ru as string, votes: typeof x.votes === 'number' ? x.votes : 0 }))
}

/** Ошибка правки словами. */
export function suggestErrorText(e: unknown): string {
  if (e instanceof TrError) {
    if (e.status === 429) return 'Слишком часто — попробуй позже'
    if (e.status === 400 || e.status === 422) return e.message && !/^http /.test(e.message) ? e.message : 'Правка не прошла проверку'
    if (e.status === 503) return 'Правки временно не принимаются'
  }
  return 'Не отправилось — проверь интернет'
}

/* ── Геометрия описания: блоки, как их режет сервер, для заглушек ── */

export interface SkelBlock {
  kind: TrKind
  lines: number
}

const IMG_ONLY = /^(?:\s|<\/?(?:p|div|center|a|br)\b[^>]*>|<img\b[^>]*>|!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))+$/i

/** Тип блока по его markdown — как на сервере. */
export function blockKind(b: string): TrKind {
  const t = b.trim()
  if (/^(```|~~~)/.test(t)) return 'code'
  if (/^#{1,6}\s/.test(t) || /^<h[1-6]\b/i.test(t)) return 'heading'
  if (/^([-*_])(\s*\1){2,}$/.test(t) || /^<hr\b/i.test(t)) return 'hr'
  if (/<img\b|!\[/i.test(t) && IMG_ONLY.test(t)) return 'image'
  if (/^\s*([-*+]|\d+[.)])\s/.test(t)) return 'list'
  if (/^\|/.test(t)) return 'table'
  if (/^>/.test(t)) return 'quote'
  if (/^</.test(t)) return 'html'
  return 'para'
}

/** Строк текста по ~72 символа: ссылки и теги считаются по видимому тексту. */
export function blockLines(b: string, kind: TrKind = blockKind(b)): number {
  const rows = b.split('\n')
  if (kind === 'code') return Math.max(1, rows.length - 2)
  if (kind === 'image' || kind === 'hr') return 1
  let n = 0
  for (const r of rows) {
    const vis = r
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[#>*_`|]/g, '')
      .trim()
    if (vis) n += Math.ceil(vis.length / 72)
  }
  return Math.max(1, n)
}

/** Описание → блоки: разделитель — пустая строка, блок кода целиком. */
export function splitBlocks(body: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence = ''
  const flush = () => {
    const t = cur.join('\n').trim()
    if (t) out.push(t)
    cur = []
  }
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const f = line.trim().match(/^(```|~~~)/)
    if (fence) {
      cur.push(line)
      if (f && f[1] === fence) {
        fence = ''
        flush()
      }
      continue
    }
    if (f) {
      flush()
      fence = f[1]
      cur.push(line)
      continue
    }
    if (!line.trim()) flush()
    else cur.push(line)
  }
  flush()
  return out
}

/** Заглушки до ответа сервера: блоки сырого описания (как режет сервер), значки README выброшены. */
export function skelBlocks(body: string): SkelBlock[] {
  return splitBlocks(body)
    .map((b) => tidyBody(b))
    .filter(Boolean)
    .map((b) => {
    const kind = blockKind(b)
    return { kind, lines: blockLines(b, kind) }
  })
}

/* ── Зависимости: id проектов Modrinth → название и иконка ── */

export interface DepProject {
  id: string
  slug: string
  title: string
  icon: string
  type: string
}

const depCache = new Map<string, DepProject>()

/** Названия и иконки проектов одним запросом (/v2/projects?ids=…), с кэшем на сессию. */
export async function depProjects(ids: string[]): Promise<Map<string, DepProject>> {
  const want = [...new Set(ids)].filter((id) => id && !depCache.has(id))
  if (want.length) {
    try {
      const url = MODRINTH_API + '/v2/projects?ids=' + encodeURIComponent(JSON.stringify(want.slice(0, 60)))
      const list = (await fetch(url).then((r) => r.json())) as {
        id: string
        slug: string
        title: string
        icon_url?: string | null
        project_type?: string
      }[]
      for (const p of Array.isArray(list) ? list : []) {
        depCache.set(p.id, {
          id: p.id,
          slug: p.slug,
          title: p.title,
          icon: mirrorAsset(p.icon_url) || '',
          type: p.project_type || 'mod',
        })
      }
    } catch {}
  }
  const out = new Map<string, DepProject>()
  for (const id of ids) {
    const p = depCache.get(id)
    if (p) out.set(id, p)
  }
  return out
}
