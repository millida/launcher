import type { ReactNode } from 'react'

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
    ref(ctx, <img key={'md' + ctx.key++} src={url} style={IMG_STYLE} />),
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

function pushText(out: ReactNode[], ctx: Ctx, text: string) {
  const parts = text.split(/\n{2,}/)
  parts.forEach((part, i) => {
    if (i > 0) {
      out.push(<br key={'md' + ctx.key++} />)
      out.push(<br key={'md' + ctx.key++} />)
    }
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

const HTML_RE = /<(p|div|br|h[1-6]|strong|em|b|i|ul|ol|li|img|a|blockquote|code|pre|table)\b[^>]*>/i

const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE'])
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const BOLD_TAGS = new Set(['B', 'STRONG'])
const ITALIC_TAGS = new Set(['I', 'EM'])

const LI_STYLE = { display: 'list-item', marginLeft: '18px' }
const CODE_STYLE = { fontFamily: 'ui-monospace, monospace', fontSize: '12.5px' }

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
      if (/^https?:/i.test(src)) out.push(<img key={key} src={src} style={IMG_STYLE} />)
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

export function renderMarkdown(body: string): ReactNode[] {
  if (HTML_RE.test(body)) return renderHtml(body)
  return mdBlock(body, { nodes: [], key: 0 })
}
