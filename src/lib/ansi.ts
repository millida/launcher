
export interface ConsolePart {
  text: string
  color?: string
  bold?: boolean
  link?: string
}

const URL_RE = new RegExp('https?://[^\\s\\u001b<>"\'`§]+', 'g')

const TRAILING_PUNCT = '.,;:!?)]}»"\''

function trimUrl(raw: string): string {
  let end = raw.length
  while (end > 0 && TRAILING_PUNCT.includes(raw[end - 1])) end -= 1
  return raw.slice(0, end)
}

const ANSI_16 = [
  '#3b4048', '#e05561', '#8cc265', '#d5a44b', '#4aa5f0', '#c162de', '#42b3c2', '#c6ccd7',
  '#6b7280', '#ff6b74', '#a5e075', '#f0c674', '#6cb6ff', '#d38aea', '#5ccfe6', '#e6e6e6',
]

const MC_COLORS: Record<string, string> = {
  '0': '#5a5a5a', '1': '#5555FF', '2': '#8cc265', '3': '#42b3c2', '4': '#e05561',
  '5': '#c162de', '6': '#d5a44b', '7': '#9aa4ad', '8': '#6b7280', '9': '#6cb6ff',
  a: '#a5e075', b: '#5ccfe6', c: '#ff6b74', d: '#d38aea', e: '#f0c674', f: '#e6e6e6',
}

function xterm256(n: number): string {
  if (n < 16) return ANSI_16[n]
  if (n < 232) {
    const i = n - 16
    const level = (v: number) => (v ? v * 40 + 55 : 0)
    const hex = (v: number) => level(v).toString(16).padStart(2, '0')
    return '#' + hex(Math.floor(i / 36)) + hex(Math.floor(i / 6) % 6) + hex(i % 6)
  }
  const g = ((n - 232) * 10 + 8).toString(16).padStart(2, '0')
  return '#' + g + g + g
}

function applySgr(codes: number[], state: { color?: string; bold?: boolean }) {
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) {
      state.color = undefined
      state.bold = false
    } else if (c === 1) state.bold = true
    else if (c === 22) state.bold = false
    else if (c === 39) state.color = undefined
    else if (c >= 30 && c <= 37) state.color = ANSI_16[c - 30]
    else if (c >= 90 && c <= 97) state.color = ANSI_16[c - 90 + 8]
    else if (c === 38 || c === 48) {
      const mode = codes[i + 1]
      if (mode === 5) {
        if (c === 38) state.color = xterm256(codes[i + 2] || 0)
        i += 2
      } else if (mode === 2) {
        if (c === 38) {
          const [r, g, b] = [codes[i + 2] || 0, codes[i + 3] || 0, codes[i + 4] || 0]
          state.color = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
        }
        i += 4
      }
    }
  }
}

const ESC = new RegExp('\\u001b\\[([0-9;]*)([A-Za-z])', 'g')

export function consoleParts(line: string): ConsolePart[] {
  const out: ConsolePart[] = []
  const state: { color?: string; bold?: boolean } = {}
  const pushPlain = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && !last.link && last.color === state.color && last.bold === state.bold) last.text += text
    else out.push({ text, color: state.color, bold: state.bold })
  }
  const push = (text: string) => {
    if (!text) return
    URL_RE.lastIndex = 0
    let at = 0
    let m: RegExpExecArray | null
    while ((m = URL_RE.exec(text))) {
      const href = trimUrl(m[0])
      if (!href) continue
      pushPlain(text.slice(at, m.index))
      out.push({ text: href, color: state.color, bold: state.bold, link: href })
      at = m.index + href.length
    }
    pushPlain(text.slice(at))
  }
  const pushMc = (chunk: string) => {
    let i = 0
    let buf = ''
    while (i < chunk.length) {
      const ch = chunk[i]
      if (ch === '§' && i + 1 < chunk.length) {
        push(buf)
        buf = ''
        const c = chunk[i + 1].toLowerCase()
        if (MC_COLORS[c]) {
          state.color = MC_COLORS[c]
          state.bold = false
        } else if (c === 'l') state.bold = true
        else if (c === 'r') {
          state.color = undefined
          state.bold = false
        }
        i += 2
        continue
      }
      buf += ch
      i++
    }
    push(buf)
  }

  ESC.lastIndex = 0
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = ESC.exec(line))) {
    pushMc(line.slice(pos, m.index))
    if (m[2] === 'm') applySgr((m[1] || '0').split(';').map((v) => parseInt(v, 10) || 0), state)
    pos = m.index + m[0].length
  }
  pushMc(line.slice(pos))
  return out
}

export function logLevelClass(line: string): string {
  const plain = line.replace(ESC, '')
  if (/\b(ERROR|SEVERE|FATAL|Exception|Caused by)\b/.test(plain)) return 'lvl-err'
  if (/\bWARN(ING)?\b/.test(plain)) return 'lvl-warn'
  if (/\b(joined the game|left the game|Done \(|Starting minecraft server)\b/i.test(plain)) return 'lvl-ok'
  return ''
}
