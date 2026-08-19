const MIN_VISIBLE_MS = 520

const startedAt = typeof performance !== 'undefined' ? performance.now() : 0
let hidden = false

export function hideBoot() {
  if (hidden) return
  hidden = true
  const el = document.getElementById('boot')
  if (!el) return
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : MIN_VISIBLE_MS) - startedAt
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed)
  setTimeout(() => {
    el.classList.add('gone')
    setTimeout(() => el.remove(), 400)
  }, wait)
}

/// The splash is a full-screen opaque layer in `index.html`. Only the main
/// window ever hides it, so any other window that loads the same bundle - the
/// overlay - has to drop it before it paints over the whole screen.
export function dropBootSplash(doc: Pick<Document, 'getElementById'>) {
  doc.getElementById('boot')?.remove()
}
