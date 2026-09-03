import type { ReactNode } from 'react'
import { mirrorAsset } from './api'

const H4_STYLE = { margin: '12px 0 6px', color: 'var(--m-fg)' }
const H3_STYLE = { margin: '14px 0 6px', color: 'var(--m-fg)' }
const IMG_STYLE = { maxWidth: '100%', borderRadius: '10px', margin: '8px 0' }
const LINK_STYLE = { color: 'var(--m-accent)' }

const REF = '\u0000'
const B_OPEN = '\u0001'
const B_CLOSE = '\u0002'

interface Ctx {
  nodes: ReactNode[]
  key: number
}

function ref(ctx: Ctx, node: ReactNode): string {
  ctx.nodes.push(node)
  return REF + (ctx.nodes.length - 1) + REF
}

function transform(src: string, ctx: Ctx): string {
  let s = src.replace(/\*\*([\s\S]+?)\*\*/g, (_m, g1) => B_OPEN + g1 + B_CLOSE)
  s = s.replace(/!\[[^\]]*\]\((https?:[^)]+)\)/g, (_m, url) =>
    ref(ctx, <img key={'md' + ctx.key++} src={mirrorAsset(url)} style={IMG_STYLE} />),
  )
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m, text, href) =>
    ref(
      ctx,
      <a key={'md' + ctx.key++} href={href} style={LINK_STYLE}>
        {assemble(text, ctx)}
      </a>,
    ),
  )
  return s
}

/// Markdown списки — самая частая разметка в описаниях модов, а рендерились
/// они одной слипшейся строкой: одиночный перевод строки не давал разрыва.
const LIST_RE = /^([ \t]*)(?:[-*+]|\d{1,2}[.)])[ \t]+/
const HR_RE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/

function pushText(out: ReactNode[], ctx: Ctx, text: string) {
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={'md' + ctx.key++} />)
    if (HR_RE.test(line)) return
    const part = line.replace(LIST_RE, (_m, pad: string) => pad + '• ')
    if (part) out.push(part)
  })
}

function assemble(s: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === REF) {
      const end = s.indexOf(REF, i + 1)
      if (end > 0) {
        pushText(out, ctx, buf)
        buf = ''
        out.push(ctx.nodes[+s.slice(i + 1, end)])
        i = end + 1
        continue
      }
    }
    if (ch === B_OPEN) {
      const end = s.indexOf(B_CLOSE, i + 1)
      if (end > 0) {
        pushText(out, ctx, buf)
        buf = ''
        out.push(<b key={'md' + ctx.key++}>{assemble(s.slice(i + 1, end), ctx)}</b>)
        i = end + 1
        continue
      }
    }
    buf += ch
    i++
  }
  pushText(out, ctx, buf)
  return out
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE'])
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const BOLD_TAGS = new Set(['B', 'STRONG'])
const ITALIC_TAGS = new Set(['I', 'EM'])
const TABLE_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'])

const LI_STYLE = { display: 'list-item', marginLeft: '18px' }
const CODE_STYLE = { fontFamily: 'ui-monospace, monospace', fontSize: '12.5px' }
const DETAILS_STYLE = {
  margin: '8px 0',
  padding: '8px 10px',
  borderRadius: '10px',
  background: 'var(--m-inset)',
}
const SUMMARY_STYLE = { cursor: 'pointer', fontWeight: 600, color: 'var(--m-fg)' }
const HR_STYLE = { border: 0, borderTop: '1px solid var(--m-border)', margin: '12px 0' }
const TABLE_STYLE = { borderCollapse: 'collapse' as const, width: '100%', margin: '8px 0', fontSize: '12.5px' }
const CELL_STYLE = { border: '1px solid var(--m-border)', padding: '4px 8px', textAlign: 'left' as const }
const CENTER_STYLE = { textAlign: 'center' as const, margin: '0 0 8px' }

/// Some Modrinth descriptions are stored as raw HTML; parsed into React nodes through an
/// allowlist instead of dangerouslySetInnerHTML.
function htmlNodes(node: Node, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const raw = child.textContent || ''
      // A description can mix raw HTML (banners, badges) with plain Markdown
      // syntax around it — the text nodes here still need **bold**, [links](),
      // and #headers interpreted, not dumped as literal characters.
      if (raw.trim()) out.push(...mdBlock(raw, ctx))
      else if (raw.replace(/\s+/g, ' ') === ' ') out.push(' ')
      return
    }
    if (child.nodeType !== 1) return
    const el = child as Element
    const tag = el.tagName.toUpperCase()
    const key = 'html' + ctx.key++
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME') return
    if (tag === 'BR') {
      out.push(<br key={key} />)
      return
    }
    if (tag === 'IMG') {
      const src = el.getAttribute('src') || ''
      if (/^https?:/i.test(src)) out.push(<img key={key} src={mirrorAsset(src)} style={IMG_STYLE} />)
      return
    }
    if (tag === 'A') {
      const href = el.getAttribute('href') || ''
      out.push(
        /^https?:/i.test(href) ? (
          <a key={key} href={href} style={LINK_STYLE}>
            {htmlNodes(el, ctx)}
          </a>
        ) : (
          <span key={key}>{htmlNodes(el, ctx)}</span>
        ),
      )
      return
    }
    if (HEADING_TAGS.has(tag)) {
      const Tag = tag === 'H1' || tag === 'H2' || tag === 'H3' ? 'h3' : 'h4'
      const style = Tag === 'h3' ? H3_STYLE : H4_STYLE
      out.push(
        <Tag key={key} style={style}>
          {htmlNodes(el, ctx)}
        </Tag>,
      )
      return
    }
    if (BOLD_TAGS.has(tag)) {
      out.push(<b key={key}>{htmlNodes(el, ctx)}</b>)
      return
    }
    if (ITALIC_TAGS.has(tag)) {
      out.push(<i key={key}>{htmlNodes(el, ctx)}</i>)
      return
    }
    if (tag === 'DETAILS') {
      out.push(
        <details key={key} style={DETAILS_STYLE}>
          {htmlNodes(el, ctx)}
        </details>,
      )
      return
    }
    if (tag === 'SUMMARY') {
      out.push(
        <summary key={key} style={SUMMARY_STYLE}>
          {htmlNodes(el, ctx)}
        </summary>,
      )
      return
    }
    if (tag === 'HR') {
      out.push(<hr key={key} style={HR_STYLE} />)
      return
    }
    if (tag === 'CENTER') {
      out.push(
        <div key={key} style={CENTER_STYLE}>
          {htmlNodes(el, ctx)}
        </div>,
      )
      return
    }
    if (TABLE_TAGS.has(tag)) {
      const Tag = tag.toLowerCase() as 'table' | 'thead' | 'tbody' | 'tr' | 'th' | 'td'
      out.push(
        <Tag key={key} style={tag === 'TABLE' ? TABLE_STYLE : tag === 'TH' || tag === 'TD' ? CELL_STYLE : undefined}>
          {htmlNodes(el, ctx)}
        </Tag>,
      )
      return
    }
    if (tag === 'CODE' || tag === 'PRE') {
      out.push(
        <code key={key} style={CODE_STYLE}>
          {htmlNodes(el, ctx)}
        </code>,
      )
      return
    }
    if (BLOCK_TAGS.has(tag)) {
      out.push(
        <div key={key} style={tag === 'LI' ? LI_STYLE : { margin: '0 0 8px' }}>
          {htmlNodes(el, ctx)}
        </div>,
      )
      return
    }
    out.push(...htmlNodes(el, ctx))
  })
  return out
}

function renderHtml(body: string): ReactNode[] {
  try {
    const doc = new DOMParser().parseFromString(body, 'text/html')
    return htmlNodes(doc.body, { nodes: [], key: 0 })
  } catch {
    return [body.replace(/<[^>]+>/g, ' ')]
  }
}

/// Turns a block of plain Markdown text (headers, **bold**, [links](), ![images]())
/// into React nodes. Shared by the pure-Markdown path and by HTML text nodes so a
/// description mixing both formats renders consistently either way.
function mdBlock(body: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = []
  const re = /^(#{1,3}) (.*)$/gm
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m.index > last) out.push(...assemble(transform(body.slice(last, m.index), ctx), ctx))
    const level = m[1].length
    const content = assemble(transform(m[2], ctx), ctx)
    if (level === 3) {
      out.push(
        <h4 key={'md' + ctx.key++} style={H4_STYLE}>
          {content}
        </h4>,
      )
    } else {
      out.push(
        <h3 key={'md' + ctx.key++} style={H3_STYLE}>
          {content}
        </h3>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < body.length) out.push(...assemble(transform(body.slice(last), ctx), ctx))
  return out
}

/// Описания приходят и как Markdown, и как HTML, и как их смесь — часть тегов
/// (details, table, center) не попадала ни в один список и уезжала игроку
/// текстом. Единственный путь: разобрать всё как HTML, а текстовые узлы внутри
/// прогнать через Markdown.
export function renderMarkdown(body: string): ReactNode[] {
  return renderHtml(body)
}
