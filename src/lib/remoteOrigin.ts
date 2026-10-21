// What the launcher takes from the website without a release (screens, translation fixes) lives under one
// address and is signed with one Ed25519 key. This file holds the address, the public key and the checks;
// it imports nothing, so the dictionaries can use it without pulling React in.

// Public half of the signing key (raw Ed25519, base64). The private key never leaves the site's CI.
export const REMOTE_UI_PUBLIC_KEY = 'TgYsbCG1NTtZWwyTeaj2dozeEUWkBxqgNmbhrr9frjE='

export const REMOTE_UI_BASE: string =
  (import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('m-ui-base')) ||
  (import.meta.env.DEV ? '/mlu-site/launcher-ui' : 'https://millida.net/launcher-ui')

const b64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let verifyKey: Promise<CryptoKey | null> | null = null

export function publicKey(): Promise<CryptoKey | null> {
  verifyKey ??= crypto.subtle
    .importKey('raw', b64(REMOTE_UI_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'])
    .catch(() => null)
  return verifyKey
}

/** `key` is for tests; undefined means the site's key. */
export async function verifySigned(text: string, sig: string, key?: CryptoKey | null): Promise<boolean> {
  const k = key === undefined ? await publicKey() : key
  if (!k) return false
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, k, b64(sig), new TextEncoder().encode(text))
  } catch {
    return false
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
