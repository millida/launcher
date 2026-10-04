export type WeaveKind = 'text' | 'head' | 'media'

export const WEAVE = { every: 2, max: 4 }

// A description that already carries its own pictures keeps the author's layout.
export function weave<T>(items: T[], shots: string[], kind: (t: T) => WeaveKind, toShot: (url: string) => T, opts = WEAVE): T[] {
  if (!shots.length || items.some((t) => kind(t) === 'media')) return items
  const limit = Math.min(opts.max, shots.length)
  const out: T[] = []
  let run = 0
  let used = 0
  items.forEach((it, i) => {
    out.push(it)
    if (kind(it) !== 'text') return
    run++
    if (run < opts.every || used >= limit || i === items.length - 1) return
    out.push(toShot(shots[used++]!))
    run = 0
  })
  return out
}

const HTML_TAG = /<\s*[a-z][\w-]*[\s>/]/i
const MD_IMAGE = /!\[[^\]]*\]\(/

// HTML bodies are left alone: a blank line may sit inside a tag, and splitting there breaks the markup.
export function weaveMarkdown(body: string, shots: string[], opts = WEAVE): string {
  if (!body || !shots.length || HTML_TAG.test(body) || MD_IMAGE.test(body)) return body
  const parts = body.split(/\n[ \t]*\n+/).filter((p) => p.trim())
  return weave(
    parts,
    shots,
    (p) => (/^\s*#{1,6}\s/.test(p) ? 'head' : 'text'),
    (url) => '![](' + url + ')',
    opts,
  ).join('\n\n')
}
