import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { hasTauri } from '../ipc/tauri'

// The launcher runs on http://tauri.localhost, which is not a secure context, so
// navigator.clipboard is unavailable; in WebView2 it can also hang without a user gesture.
const TIMEOUT_MS = 1500

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), TIMEOUT_MS)),
  ])
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  if (hasTauri()) {
    try {
      await withTimeout(writeText(text))
      return true
    } catch {}
  }
  try {
    if (navigator.clipboard?.writeText) {
      await withTimeout(navigator.clipboard.writeText(text))
      return true
    }
  } catch {}
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.top = '0'
    el.style.opacity = '0'
    el.setAttribute('readonly', '')
    document.body.appendChild(el)
    el.select()
    el.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  } catch {
    return false
  }
}
