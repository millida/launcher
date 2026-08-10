import { beforeEach, expect, mock, test } from 'bun:test'

const prefs = new Map<string, string>()
const web = new Map<string, string>()
const disk = new Map<string, string>()

mock.module('./prefs', () => ({
  readPref: (k: string, fallback: string) => (prefs.has(k) ? prefs.get(k)! : fallback),
  writePref: (k: string, v: string) => void prefs.set(k, v),
  hydratePrefs: async () => {
    for (const [k, v] of disk) prefs.set(k, v)
  },
}))
mock.module('../ipc/tauri', () => ({ hasTauri: () => true }))
mock.module('../ipc/commands', () => ({
  convertFileSrc: (p: string) => p,
  listThemes: async () => {
    if (listFails) throw new Error('core unavailable')
    return installed
  },
  readTheme: async (id: string) => ({ css: '/* ' + id + ' */', dir: '/packs/' + id }),
}))
mock.module('./theme', () => ({
  pinThemeBase: (v: string) => void (pinned = v),
  withColorFade: (fn: () => void) => fn(),
}))
for (const id of ['mario', 'win98', 'minimal', 'terminal']) {
  mock.module('../themes/' + id + '.css?raw', () => ({ default: ':root{--pack:' + id + '}' }))
}

let installed: { id: string; name: string; base: string }[] = []
let listFails = false
let pinned = ''

const style = { id: '', isConnected: false, textContent: '' }
const root = {
  dataset: {} as Record<string, string | undefined>,
  style: {
    values: new Map<string, string>(),
    setProperty(k: string, v: string) {
      this.values.set(k, v)
    },
    removeProperty(k: string) {
      this.values.delete(k)
    },
  },
}

// Some of these globals are read-only getters once the runtime has installed
// its own, so they are defined rather than assigned.
const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })

define('HTMLStyleElement', class {})
define('localStorage', {
  getItem: (k: string) => (web.has(k) ? web.get(k)! : null),
  setItem: (k: string, v: string) => void web.set(k, v),
})
define('document', {
  documentElement: root,
  head: { appendChild: () => void (style.isConnected = true) },
  getElementById: () => null,
  createElement: () => style,
})

const { applyThemePack, BUILTIN_THEMES, initThemePacks, optionValues, saveOptionValues } =
  await import('./themes')

const pack = (id: string) => BUILTIN_THEMES.find((t) => t.id === id)!

beforeEach(() => {
  prefs.clear()
  web.clear()
  disk.clear()
  installed = []
  listFails = false
  pinned = ''
  style.textContent = ''
  for (const k of Object.keys(root.dataset)) delete root.dataset[k]
  root.style.values.clear()
})

/// Web storage is committed lazily and a session that ended through the tray
/// never got to, so the boot read can come back empty while the durable copy
/// still holds the choice. The pack has to land once that copy arrives.
test('a pack stored only on disk is restored after prefs hydrate', async () => {
  disk.set('m-theme-pack', 'win98')
  disk.set('m-density', 'compact')
  await initThemePacks()
  expect(root.dataset.themePack).toBe('win98')
  expect(root.dataset.density).toBe('compact')
  expect(style.textContent).toContain('--pack:win98')
})

test('an installed pack survives a core that cannot list themes', async () => {
  prefs.set('m-theme-pack', 'neon')
  listFails = true
  await initThemePacks()
  expect(root.dataset.themePack).toBeUndefined()
  expect(prefs.get('m-theme-pack')).toBe('neon')
})

test('a pack uninstalled outside the launcher falls back to the plain theme', async () => {
  prefs.set('m-theme-pack', 'neon')
  installed = []
  await initThemePacks()
  expect(root.dataset.themePack).toBeUndefined()
  expect(prefs.get('m-theme-pack')).toBe('')
})

/// Option values are what makes a pack look like itself; losing them with web
/// storage brings the pack back stripped of everything the user chose.
test('option values come back from the durable copy when web storage is empty', async () => {
  saveOptionValues(pack('win98'), { wall: 'plum', title: '#7B0000', bevel: '0', crisp: '0' })
  const mirrored = prefs.get('m-theme-vals')
  web.clear()
  prefs.clear()
  prefs.set('m-theme-vals', mirrored!)
  expect(optionValues(pack('win98'))).toEqual({
    wall: 'plum',
    title: '#7B0000',
    bevel: '0',
    crisp: '0',
  })
})

/// The pack files are read from disk here on purpose: the mocked `?raw` imports
/// above prove the wiring, not that a real pack still carries its stylesheet.
/// An empty one used to pin the palette and light up the card while drawing
/// nothing, which reads as "the theme does not work".
test('every built-in pack ships a stylesheet scoped to its own id', async () => {
  const { readFileSync } = await import('node:fs')
  for (const p of BUILTIN_THEMES) {
    const css = readFileSync(new URL('../themes/' + p.id + '.css', import.meta.url), 'utf8')
    expect(css.trim().length).toBeGreaterThan(200)
    expect(css).toContain('[data-theme-pack="' + p.id + '"]')
    for (const o of p.options || []) {
      const used = css.includes('--o-' + o.key) || css.includes('[data-o-' + o.key + '=')
      expect(used).toBe(true)
    }
  }
})

test('a built-in pack with no stylesheet is refused instead of half applied', async () => {
  const broken = { ...pack('terminal'), id: 'not-bundled' }
  await expect(applyThemePack(broken)).rejects.toThrow(/не попало в сборку/)
  expect(root.dataset.themePack).toBeUndefined()
  expect(prefs.get('m-theme-pack')).toBeUndefined()
})

/// A key written through `writePref` that is missing from the durable list is
/// saved to disk and never read back, so the setting survives everywhere except
/// the one case the file exists for — a wiped web storage.
test('every pref key used in the app is registered as durable', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const src = new URL('..', import.meta.url).pathname.replace(/^\//, '')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) files.push(p)
    }
  }
  walk(src)
  const declared = new Set(
    [...readFileSync(join(src, 'lib', 'prefs.ts'), 'utf8').matchAll(/^\s+'([a-z0-9-]+)',$/gm)].map(
      (m) => m[1],
    ),
  )
  const used = new Set<string>()
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    // Call sites name the key either inline or through a module constant.
    const consts = new Map<string, string>()
    for (const m of text.matchAll(/^const ([A-Z][A-Z0-9_]*) = '([a-z0-9-]+)'$/gm)) {
      consts.set(m[1], m[2])
    }
    for (const m of text.matchAll(/\b(?:read|write)Pref\(\s*(?:'([a-z0-9-]+)'|([A-Z][A-Z0-9_]*))/g)) {
      const key = m[1] || consts.get(m[2])
      if (key) used.add(key)
    }
  }
  expect(used.size).toBeGreaterThan(0)
  expect([...used].filter((k) => !declared.has(k))).toEqual([])
})

test('applying a pack pins its palette and writes both durable keys', async () => {
  await applyThemePack(pack('terminal'))
  expect(pinned).toBe('dark')
  expect(prefs.get('m-theme-pack')).toBe('terminal')
  expect(JSON.parse(prefs.get('m-theme-vals')!).id).toBe('terminal')
})
