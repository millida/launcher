/// Tauri stamps a nonce on every `<style>` that ships inside `index.html` and
/// adds that nonce to `style-src` of the packaged build. A policy that carries a
/// nonce ignores `'unsafe-inline'`, so a `<style>` created at runtime is dropped
/// without a word: the node sits in the head with its text in place and `sheet`
/// stays null. Nothing of that happens under the dev server, where the document
/// is served untouched — themes and accent worked in `tauri dev` and painted
/// nothing in a release build. Wearing the document's own nonce keeps runtime
/// styles valid under either policy.
export function documentStyleNonce(): string {
  const styles = document.querySelectorAll('style')
  for (const el of styles) {
    if (el.nonce) return el.nonce
  }
  return ''
}

export function createStyleNode(id: string): HTMLStyleElement {
  const el = document.createElement('style')
  el.id = id
  const nonce = documentStyleNonce()
  if (nonce) el.nonce = nonce
  return el
}

/// A connected `<style>` always exposes a stylesheet — an empty one included —
/// unless the policy refused it. Checked before the launcher claims the styles
/// are on screen, so a blocked node reports instead of leaving a theme half
/// applied.
export function styleBlocked(el: HTMLStyleElement): boolean {
  return el.isConnected && !el.sheet
}
