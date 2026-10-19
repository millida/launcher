// Replies to bug reports: "known, we are fixing it" right after sending, and "fixed in version X, update" later.
// The server keeps the replies (GET /bug-reports/me/replies); the launcher shows each once and confirms it.

export type BugReplyKind = 'ack' | 'fixed'

export interface BugReply {
  id: string
  kind: BugReplyKind | string
  text: string
  version: string | null
}

/** What POST /bug-reports answers for a launcher report: a ready reply or nothing. */
export interface BugAck {
  kind: BugReplyKind
  text: string
  workaround: string | null
  version: string | null
}

type Tr = (key: string, vars?: Record<string, string | number>) => string

const VERSION_RE = /^\d+(?:\.\d+){1,3}$/

/** Toast text for a reply. The words come from the launcher dictionary; only the version and the admin's advice come from the server. */
export function replyText(r: Pick<BugAck, 'kind' | 'workaround' | 'version'>, tr: Tr): string {
  if (r.kind === 'fixed' && r.version && VERSION_RE.test(r.version)) {
    return tr('Починили в версии {v} — обновись', { v: r.version })
  }
  const head = tr('Знаем об этой проблеме, чиним')
  const tip = (r.workaround || '').trim()
  return tip ? head + '. ' + tip : head
}

/** Unseen replies worth a toast: fixed-notices first, no more than two per start so a long backlog does not bury the screen. */
export function pickReplies(items: unknown): BugReply[] {
  if (!Array.isArray(items)) return []
  const ok = items.filter(
    (x): x is BugReply =>
      !!x && typeof x === 'object' && typeof (x as BugReply).id === 'string' && (x as BugReply).kind === 'fixed' && VERSION_RE.test(String((x as BugReply).version)),
  )
  return ok.slice(0, 2)
}
