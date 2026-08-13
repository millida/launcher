/**
 * Apple XML plist read and write, shared by the macOS cross bundler and its
 * test. Text plists only — the bundler never emits a binary one.
 */

/** Apple XML plist, matching what Tauri emits — not a binary plist. */
export function plistValue(value, indent) {
  const pad = '\t'.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>`
    return [`${pad}<array>`, ...value.map((v) => plistValue(v, indent + 1)), `${pad}</array>`].join('\n')
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return `${pad}<dict/>`
    return [
      `${pad}<dict>`,
      ...entries.flatMap(([k, v]) => [`${'\t'.repeat(indent + 1)}<key>${escapeXml(k)}</key>`, plistValue(v, indent + 1)]),
      `${pad}</dict>`,
    ].join('\n')
  }
  if (typeof value === 'boolean') return `${pad}<${value}/>`
  if (typeof value === 'number') return `${pad}<integer>${value}</integer>`
  return `${pad}<string>${escapeXml(String(value))}</string>`
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Reads an Apple XML plist into a plain object. tauri-bundler merges the hand
 * written `Info.plist` into the generated one; keys that live only there (the
 * microphone usage description, without which macOS denies capture instead of
 * prompting) must survive the cross build too.
 */
export function parsePlistXml(xml, source) {
  const text = xml
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  let pos = 0

  const fail = (why) => {
    throw new Error(`${source}: ${why}`)
  }

  function nextTag() {
    const open = text.indexOf('<', pos)
    if (open < 0) return null
    const close = text.indexOf('>', open)
    if (close < 0) fail('незакрытый тег')
    const raw = text.slice(open + 1, close)
    pos = close + 1
    return {
      name: raw.replace(/^\//, '').replace(/\/$/, '').trim().split(/\s+/)[0],
      selfClosing: raw.endsWith('/'),
      closing: raw.startsWith('/'),
    }
  }

  function readUntilClose(tag) {
    const end = text.indexOf(`</${tag}>`, pos)
    if (end < 0) fail(`нет </${tag}>`)
    const raw = text.slice(pos, end)
    pos = end + tag.length + 3
    return unescapeXml(raw).trim()
  }

  function parseValue(tag) {
    switch (tag.name) {
      case 'true':
        return true
      case 'false':
        return false
      case 'string':
        return tag.selfClosing ? '' : readUntilClose('string')
      case 'integer':
        return tag.selfClosing ? 0 : Number(readUntilClose('integer'))
      case 'real':
        return tag.selfClosing ? 0 : Number(readUntilClose('real'))
      case 'dict':
        return tag.selfClosing ? {} : parseDict()
      case 'array':
        return tag.selfClosing ? [] : parseArray()
      default:
        return fail(`неподдерживаемый тег <${tag.name}>`)
    }
  }

  function parseDict() {
    const out = {}
    for (;;) {
      const tag = nextTag()
      if (!tag) fail('нет </dict>')
      if (tag.closing) {
        if (tag.name !== 'dict') fail(`ожидался </dict>, встречен </${tag.name}>`)
        return out
      }
      if (tag.name !== 'key') fail(`ожидался <key>, встречен <${tag.name}>`)
      const key = readUntilClose('key')
      const valueTag = nextTag()
      if (!valueTag || valueTag.closing) fail(`у ключа ${key} нет значения`)
      out[key] = parseValue(valueTag)
    }
  }

  function parseArray() {
    const out = []
    for (;;) {
      const tag = nextTag()
      if (!tag) fail('нет </array>')
      if (tag.closing) {
        if (tag.name !== 'array') fail(`ожидался </array>, встречен </${tag.name}>`)
        return out
      }
      out.push(parseValue(tag))
    }
  }

  for (;;) {
    const tag = nextTag()
    if (!tag) return fail('нет корневого <dict>')
    if (tag.name === 'plist' || tag.closing) continue
    if (tag.name === 'dict') return tag.selfClosing ? {} : parseDict()
    fail(`корень plist должен быть <dict>, а не <${tag.name}>`)
  }
}

export function renderPlist(dict) {

  return [

    '<?xml version="1.0" encoding="UTF-8"?>',

    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',

    '<plist version="1.0">',

    plistValue(dict, 0),

    '</plist>',

    '',

  ].join('\n')

}
