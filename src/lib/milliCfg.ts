/*
 * Правка текстовых настроек сборки без потери оформления: меняется только
 * значение одного ключа, комментарии, порядок и отступы остаются как были.
 * Форматы: options.txt / Xaero (key:value), .properties, TOML (Forge/NightConfig),
 * JSON / JSON5 / JSONC, старый Forge .cfg, простой YAML. Всё чистое — без IPC.
 */
import type { CfgFormat, CfgValueType } from './milliActions'

export interface CfgEntry {
  path: string
  /** Значение как в файле, без кавычек у строк. */
  value: string
  type: CfgValueType
  /** Комментарий над ключом или в строке (≤120), если есть — подсказка модели. */
  hint?: string
}

export interface CfgSpec {
  type?: CfgValueType
  min?: number
  max?: number
  values?: string[]
}

export type CfgEditResult = { ok: true; text: string; from: string | null; to: string } | { ok: false; error: string }

const NUM = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/

export function guessType(raw: string): CfgValueType {
  const v = raw.trim()
  if (v === 'true' || v === 'false') return 'bool'
  if (/^-?\d+$/.test(v)) return 'int'
  if (NUM.test(v)) return 'float'
  return 'string'
}

/**
 * Проверка нового значения: тип как у ключа (или как в спецификации), числа —
 * в пределах, перечисление — из списка. Возвращает нормализованную строку.
 */
export function checkValue(to: string, current: string | null, spec: CfgSpec = {}): { ok: true; v: string } | { ok: false; error: string } {
  let v = String(to).trim()
  const type: CfgValueType = spec.type ?? (current != null ? guessType(current) : guessType(v))
  if (type === 'bool') {
    const low = v.toLowerCase()
    if (/^(true|on|вкл|да|1)$/.test(low)) v = 'true'
    else if (/^(false|off|выкл|нет|0)$/.test(low)) v = 'false'
    else return { ok: false, error: 'нужно да/нет' }
    return { ok: true, v }
  }
  if (type === 'int' || type === 'float') {
    if (!NUM.test(v)) return { ok: false, error: 'нужно число' }
    let n = Number(v)
    if (type === 'int') n = Math.round(n)
    if (spec.min != null) n = Math.max(spec.min, n)
    if (spec.max != null) n = Math.min(spec.max, n)
    // Без пределов: не дальше ×20 от текущего — защита от «999999 мобов».
    if (spec.min == null && spec.max == null && current != null && NUM.test(current.trim())) {
      const c = Math.abs(Number(current))
      const cap = Math.max(20, c * 20)
      if (Math.abs(n) > cap) return { ok: false, error: 'слишком много' }
    }
    if (type === 'int') return { ok: true, v: String(n) }
    // float: сохранить вид «1.0», если в файле дробь.
    const s = Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 1e6) / 1e6)
    return { ok: true, v: s }
  }
  if (type === 'enum') {
    const vals = spec.values ?? []
    const hit = vals.find((x) => x.toLowerCase() === v.toLowerCase())
    if (!hit) return { ok: false, error: 'нет такого варианта' }
    return { ok: true, v: hit }
  }
  if (v.length > 200 || /[\r\n\0]/.test(v)) return { ok: false, error: 'плохое значение' }
  return { ok: true, v }
}

// ─── key:value (options.txt, Xaero) и .properties ──────────────────────────

function kvSep(format: CfgFormat): RegExp {
  return format === 'properties' ? /^(\s*)([^#!\s=:][^=:]*?)(\s*[=:]\s*)(.*)$/ : /^(\s*)([^#:\s][^:]*?)(:)(.*)$/
}

function kvParse(text: string, format: CfgFormat): CfgEntry[] {
  const rx = kvSep(format)
  const out: CfgEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[#!]/.test(line)) continue
    const m = rx.exec(line)
    if (!m) continue
    const raw = m[4].trim()
    const unq = raw.replace(/^"(.*)"$/, '$1')
    out.push({ path: m[2].trim(), value: unq, type: guessType(unq) })
  }
  return out
}

/**
 * Xaero (1.20.1+): поле внутри строки модуля
 * `module;id=xaerominimap:minimap;active=true;x=-11;fromRight=true;…`.
 * Путь: `module;id=xaerominimap:minimap;fromRight`.
 */
function fieldSet(text: string, path: string, to: string, spec: CfgSpec): CfgEditResult {
  const parts = path.split(';')
  const field = parts.pop()!
  const prefix = parts.join(';') + ';'
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => l.startsWith(prefix))
  if (i < 0) return { ok: false, error: 'нет такого ключа' }
  const rx = new RegExp('(;' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=)([^;]*)')
  const m = rx.exec(lines[i])
  if (!m) return { ok: false, error: 'нет такого ключа' }
  const c = checkValue(to, m[2], spec)
  if (!c.ok) return c
  lines[i] = lines[i].replace(rx, '$1' + c.v)
  return { ok: true, text: lines.join(nl), from: m[2], to: c.v }
}

function kvSet(text: string, format: CfgFormat, key: string, to: string, spec: CfgSpec, create: boolean): CfgEditResult {
  if (format === 'txt-kv' && key.includes(';')) return fieldSet(text, key, to, spec)
  const rx = kvSep(format)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[#!]/.test(lines[i])) continue
    const m = rx.exec(lines[i])
    if (!m || m[2].trim() !== key) continue
    const raw = m[4].trim()
    const quoted = /^".*"$/.test(raw)
    const cur = raw.replace(/^"(.*)"$/, '$1')
    const c = checkValue(to, cur, spec)
    if (!c.ok) return c
    lines[i] = m[1] + m[2] + m[3] + (quoted ? '"' + c.v + '"' : c.v)
    return { ok: true, text: lines.join(nl), from: cur, to: c.v }
  }
  if (!create) return { ok: false, error: 'нет такого ключа' }
  const c = checkValue(to, null, spec)
  if (!c.ok) return c
  const body = text.length && !text.endsWith('\n') ? text + nl : text
  return { ok: true, text: body + key + (format === 'properties' ? '=' : ':') + c.v + nl, from: null, to: c.v }
}

// ─── TOML (как пишут Forge/NeoForge/NightConfig) ───────────────────────────

const unquoteKey = (k: string) => k.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')

/** «a."b.c".d» → ['a', 'b.c', 'd'] */
function splitDotted(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = ''
  for (const ch of s) {
    if (q) {
      if (ch === q) q = ''
      else cur += ch
    } else if (ch === '"' || ch === "'") q = ch
    else if (ch === '.') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out.filter((x) => x.length)
}

/** Путь ключа в нашей записи: сегменты через точку, сегмент с точкой — в [скобках]. */
export const joinPath = (parts: string[]) => parts.map((p) => (p.includes('.') ? '[' + p + ']' : p)).join('.')
export function splitPath(path: string): string[] {
  const out: string[] = []
  const rx = /\[([^\]]+)\]|([^.[\]]+)/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(path))) out.push(m[1] ?? m[2])
  return out
}

interface TomlLine {
  i: number
  path: string[]
  /** Сырой текст значения без хвостового комментария. */
  raw: string
  pre: string
  post: string
  hint?: string
}

function tomlScan(text: string): { lines: string[]; keys: TomlLine[]; tables: Map<string, number> } {
  const lines = text.split(/\r?\n/)
  const keys: TomlLine[] = []
  const tables = new Map<string, number>()
  let table: string[] = []
  let arrayTable = false
  let comment = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t) {
      comment = ''
      continue
    }
    if (t.startsWith('#')) {
      comment = (comment + ' ' + t.replace(/^#+\s*/, '')).trim().slice(-160)
      continue
    }
    const hdr = /^\[(\[)?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(t)
    if (hdr) {
      arrayTable = !!hdr[1]
      table = splitDotted(hdr[2])
      if (!arrayTable) tables.set(joinPath(table), i)
      comment = ''
      continue
    }
    if (arrayTable) continue
    const m = /^(\s*)((?:"[^"]*"|'[^']*'|[A-Za-z0-9_\-.]+)(?:\s*\.\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_\-]+))*)(\s*=\s*)(.*)$/.exec(line)
    if (!m) continue
    const { value, tail } = splitTomlValue(m[4])
    if (value === null) continue // многострочное — не трогаем
    keys.push({ i, path: [...table, ...splitDotted(m[2])], raw: value, pre: m[1] + m[2] + m[3], post: tail, ...(comment ? { hint: comment.slice(0, 120) } : {}) })
    comment = ''
  }
  return { lines, keys, tables }
}

/** Значение и хвост (`  # comment`). null — многострочная строка или массив. */
function splitTomlValue(rest: string): { value: string | null; tail: string } {
  const s = rest
  if (/^\s*("""|''')/.test(s)) return { value: null, tail: '' }
  let q = ''
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '\\' && q === '"') i++
      else if (ch === q) q = ''
      continue
    }
    if (ch === '"' || ch === "'") q = ch
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
    else if (ch === '#' && depth === 0) {
      const v = s.slice(0, i).trimEnd()
      return { value: v, tail: s.slice(v.length) }
    }
  }
  if (depth > 0 || q) return { value: null, tail: '' }
  const v = s.trimEnd()
  return { value: v, tail: s.slice(v.length) }
}

function tomlUnq(raw: string): string {
  const v = raw.trim()
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  if (/^'.*'$/.test(v)) return v.slice(1, -1)
  return v
}

function tomlType(raw: string): CfgValueType {
  const v = raw.trim()
  if (/^["']/.test(v)) return 'string'
  if (v.startsWith('[') || v.startsWith('{')) return 'string'
  return guessType(v)
}

function tomlSet(text: string, path: string, to: string, spec: CfgSpec, create: boolean): CfgEditResult {
  const want = splitPath(path)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const { lines, keys, tables } = tomlScan(text)
  const hit = keys.find((k) => k.path.length === want.length && k.path.every((p, i) => p === want[i]))
  if (hit) {
    const isStr = /^["']/.test(hit.raw.trim())
    if (/^[[{]/.test(hit.raw.trim())) return { ok: false, error: 'это список — Милли его не правит' }
    const cur = tomlUnq(hit.raw)
    const c = checkValue(to, cur, { ...spec, type: spec.type ?? (isStr ? (spec.values ? 'enum' : 'string') : undefined) })
    if (!c.ok) return c
    const lit = isStr || (spec.type === 'string' || spec.type === 'enum') ? JSON.stringify(c.v) : c.v
    lines[hit.i] = hit.pre + lit + hit.post
    return { ok: true, text: lines.join(nl), from: cur, to: c.v }
  }
  if (!create) return { ok: false, error: 'нет такого ключа' }
  const table = joinPath(want.slice(0, -1))
  const at = want.length > 1 ? tables.get(table) : -1
  if (at === undefined) return { ok: false, error: 'нет такого раздела' }
  const c = checkValue(to, null, spec)
  if (!c.ok) return c
  const lit = spec.type === 'string' || spec.type === 'enum' ? JSON.stringify(c.v) : c.v
  const key = want[want.length - 1]
  const keyLit = /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)
  // Вставить в конец раздела (до следующего заголовка).
  let ins = at + 1
  while (ins < lines.length && !/^\s*\[/.test(lines[ins])) ins++
  while (ins > at + 1 && !lines[ins - 1].trim()) ins--
  const indent = keys.find((k) => k.i > at && k.i < ins)?.pre.match(/^\s*/)?.[0] ?? ''
  lines.splice(ins, 0, indent + keyLit + ' = ' + lit)
  return { ok: true, text: lines.join(nl), from: null, to: c.v }
}

// ─── JSON / JSON5 / JSONC: замена значения по месту ─────────────────────────

interface JsonTok {
  path: string[]
  start: number
  end: number
  raw: string
  hint?: string
}

/** Сканер JSON5: пути примитивов и их позиции. null — не разобрать. */
function jsonScan(src: string): JsonTok[] | null {
  const out: JsonTok[] = []
  let i = 0
  let lastComment = ''
  const n = src.length
  const ws = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++
      if (src.startsWith('//', i)) {
        const e = src.indexOf('\n', i)
        lastComment = src.slice(i + 2, e < 0 ? n : e).trim()
        i = e < 0 ? n : e + 1
      } else if (src.startsWith('/*', i)) {
        const e = src.indexOf('*/', i + 2)
        if (e < 0) throw 0
        lastComment = src.slice(i + 2, e).replace(/\s*\*\s*/g, ' ').trim()
        i = e + 2
      } else return
    }
  }
  const str = (): string => {
    const q = src[i]
    let s = ''
    i++
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        const c = src[i + 1]
        s += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'u' ? String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)) : c
        i += c === 'u' ? 6 : 2
        continue
      }
      s += src[i++]
    }
    if (i >= n) throw 0
    i++
    return s
  }
  const value = (path: string[]): void => {
    ws()
    const ch = src[i]
    if (ch === '{') {
      i++
      for (;;) {
        ws()
        if (src[i] === '}') {
          i++
          return
        }
        let key: string
        if (src[i] === '"' || src[i] === "'") key = str()
        else {
          const m = /^[A-Za-z_$][\w$-]*/.exec(src.slice(i, i + 200))
          if (!m) throw 0
          key = m[0]
          i += key.length
        }
        const hint = lastComment
        lastComment = ''
        ws()
        if (src[i] !== ':') throw 0
        i++
        const before = out.length
        value([...path, key])
        if (hint && out.length === before + 1 && !out[before].hint) out[before].hint = hint.slice(0, 120)
        ws()
        if (src[i] === ',') i++
        else if (src[i] !== '}') throw 0
      }
    }
    if (ch === '[') {
      i++
      let k = 0
      for (;;) {
        ws()
        if (src[i] === ']') {
          i++
          return
        }
        value([...path, String(k++)])
        ws()
        if (src[i] === ',') i++
        else if (src[i] !== ']') throw 0
      }
    }
    const start = i
    if (ch === '"' || ch === "'") str()
    else {
      const m = /^[^,\]}\s/]+/.exec(src.slice(i, i + 400))
      if (!m) throw 0
      i += m[0].length
    }
    out.push({ path, start, end: i, raw: src.slice(start, i) })
  }
  try {
    value([])
    ws()
    return i >= n ? out : null
  } catch {
    return null
  }
}

function jsonUnq(raw: string): string {
  if (/^["']/.test(raw)) {
    try {
      return JSON.parse('"' + raw.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"') + '"')
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

function jsonSet(text: string, path: string, to: string, spec: CfgSpec, create: boolean): CfgEditResult {
  const toks = jsonScan(text)
  if (!toks) return { ok: false, error: 'файл не читается' }
  const want = splitPath(path)
  const hit = toks.find((t) => t.path.length === want.length && t.path.every((p, i) => p === want[i]))
  if (hit) {
    const isStr = /^["']/.test(hit.raw)
    const cur = jsonUnq(hit.raw)
    const c = checkValue(to, cur, { ...spec, type: spec.type ?? (isStr ? (spec.values ? 'enum' : 'string') : undefined) })
    if (!c.ok) return c
    const lit = isStr ? (hit.raw[0] === "'" ? "'" + c.v.replace(/'/g, "\\'") + "'" : JSON.stringify(c.v)) : c.v
    return { ok: true, text: text.slice(0, hit.start) + lit + text.slice(hit.end), from: cur, to: c.v }
  }
  if (!create) return { ok: false, error: 'нет такого ключа' }
  // Нового ключа нет: только в чистом JSON — разобрать и записать заново.
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, error: 'нет такого ключа' }
  }
  const c = checkValue(to, null, spec)
  if (!c.ok) return c
  let node = obj as Record<string, unknown>
  for (const p of want.slice(0, -1)) {
    if (!node || typeof node !== 'object') return { ok: false, error: 'нет такого раздела' }
    node[p] ??= {}
    node = node[p] as Record<string, unknown>
  }
  const t = spec.type ?? guessType(c.v)
  node[want[want.length - 1]] = t === 'bool' ? c.v === 'true' : t === 'int' || t === 'float' ? Number(c.v) : c.v
  const indent = /\n(\s+)"/.exec(text)?.[1] ?? '  '
  return { ok: true, text: JSON.stringify(obj, null, indent.includes('\t') ? '\t' : indent.length) + (text.endsWith('\n') ? '\n' : ''), from: null, to: c.v }
}

// ─── Старый Forge .cfg и простой YAML ──────────────────────────────────────

function blockScan(text: string, format: 'cfg' | 'yaml'): { lines: string[]; keys: { i: number; path: string[]; pre: string; raw: string }[] } {
  const lines = text.split(/\r?\n/)
  const keys: { i: number; path: string[]; pre: string; raw: string }[] = []
  const stack: { name: string; indent: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    if (format === 'cfg') {
      const open = /^("?[^"{=]+"?)\s*\{\s*$/.exec(t)
      if (open) {
        stack.push({ name: unquoteKey(open[1]), indent: 0 })
        continue
      }
      if (t === '}') {
        stack.pop()
        continue
      }
      const m = /^(\s*)([BIDS]:"?[^="]+"?)(\s*=\s*)(.*)$/.exec(line)
      if (m) keys.push({ i, path: [...stack.map((s) => s.name), m[2].replace(/"/g, '')], pre: m[1] + m[2] + m[3], raw: m[4].trim() })
      continue
    }
    const indent = line.length - line.trimStart().length
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const m = /^(\s*)([^:#\-\s][^:#]*?):(\s*)(.*)$/.exec(line)
    if (!m) continue
    const raw = m[4].replace(/\s+#.*$/, '').trim()
    if (!raw) {
      stack.push({ name: unquoteKey(m[2]), indent })
      continue
    }
    keys.push({ i, path: [...stack.map((s) => s.name), unquoteKey(m[2])], pre: m[1] + m[2] + ':' + m[3], raw })
  }
  return { lines, keys }
}

function blockSet(text: string, format: 'cfg' | 'yaml', path: string, to: string, spec: CfgSpec): CfgEditResult {
  const want = splitPath(path)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const { lines, keys } = blockScan(text, format)
  const hit = keys.find((k) => k.path.length === want.length && k.path.every((p, i) => p === want[i]))
  if (!hit) return { ok: false, error: 'нет такого ключа' }
  const quoted = /^["'].*["']$/.test(hit.raw)
  const cur = quoted ? hit.raw.slice(1, -1) : hit.raw
  const cfgType: CfgValueType | undefined = format === 'cfg' ? ({ B: 'bool', I: 'int', D: 'float', S: 'string' } as const)[want[want.length - 1][0] as 'B'] : undefined
  const c = checkValue(to, cur, { ...spec, type: spec.type ?? cfgType })
  if (!c.ok) return c
  const tail = format === 'yaml' ? (/\s+#.*$/.exec(lines[hit.i])?.[0] ?? '') : ''
  lines[hit.i] = hit.pre + (quoted ? hit.raw[0] + c.v + hit.raw[0] : c.v) + tail
  return { ok: true, text: lines.join(nl), from: cur, to: c.v }
}

// ─── Публичное API ─────────────────────────────────────────────────────────

/** Все ключи файла (для выбора моделью и для «было»). */
export function cfgEntries(text: string, format: CfgFormat): CfgEntry[] {
  switch (format) {
    case 'txt-kv':
    case 'properties':
      return kvParse(text, format)
    case 'toml':
      return tomlScan(text).keys.map((k) => ({ path: joinPath(k.path), value: tomlUnq(k.raw), type: tomlType(k.raw), ...(k.hint ? { hint: k.hint } : {}) }))
    case 'json':
    case 'json5':
      return (jsonScan(text) ?? []).map((t) => ({ path: joinPath(t.path), value: jsonUnq(t.raw), type: /^["']/.test(t.raw) ? 'string' : guessType(t.raw), ...(t.hint ? { hint: t.hint } : {}) }))
    case 'cfg':
    case 'yaml':
      return blockScan(text, format).keys.map((k) => {
        const v = k.raw.replace(/^["'](.*)["']$/, '$1')
        return { path: joinPath(k.path), value: v, type: guessType(v) }
      })
  }
}

export function cfgGet(text: string, format: CfgFormat, path: string): string | null {
  if (format === 'txt-kv' || format === 'properties') return kvParse(text, format).find((e) => e.path === path)?.value ?? null
  const want = joinPath(splitPath(path))
  return cfgEntries(text, format).find((e) => e.path === want)?.value ?? null
}

/** Новое содержимое файла с одним изменённым ключом. `create` — дописать, если ключа нет. */
export function cfgSet(text: string, format: CfgFormat, path: string, to: string, spec: CfgSpec = {}, create = false): CfgEditResult {
  switch (format) {
    case 'txt-kv':
    case 'properties':
      return kvSet(text, format, path, to, spec, create)
    case 'toml':
      return tomlSet(text, path, to, spec, create)
    case 'json':
    case 'json5':
      return jsonSet(text, path, to, spec, create)
    case 'cfg':
    case 'yaml':
      return blockSet(text, format, path, to, spec)
  }
}

/** Формат по имени файла. */
export function cfgFormatOf(file: string): CfgFormat | null {
  const f = file.toLowerCase()
  if (/(^|\/)options(of|shaders)?\.txt$/.test(f)) return 'txt-kv'
  if (f.endsWith('.toml')) return 'toml'
  if (f.endsWith('.json')) return 'json'
  if (f.endsWith('.json5') || f.endsWith('.jsonc')) return 'json5'
  if (f.endsWith('.properties')) return 'properties'
  if (f.endsWith('.cfg')) return 'cfg'
  if (f.endsWith('.yml') || f.endsWith('.yaml')) return 'yaml'
  if (f.endsWith('.txt')) return 'txt-kv'
  return null
}
