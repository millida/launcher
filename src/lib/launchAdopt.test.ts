import { expect, test } from 'bun:test'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

// The beat that adopting sends reads the screen for telemetry; the test only needs it not to throw.
;(globalThis as { window?: unknown }).window ??= {
  screen: { width: 0, height: 0 },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
}

// Vite defines these at build time; the launch module pulls in modules that read them.
Object.defineProperty(globalThis, '__HAS_BUNDLED_MUSIC__', { value: false, configurable: true })
Object.defineProperty(globalThis, '__BUNDLED_VIDEOS__', { value: [], configurable: true })

const { adoptRunningGame, gameSession, setGameSession } = await import('./launch')

test('a page built while the game runs takes the running build as its session', () => {
  setGameSession(null)
  adoptRunningGame([])
  expect(gameSession(), 'no game, no session').toBeNull()
  adoptRunningGame(['Dominion'])
  expect(gameSession()).toEqual({ profile: 'Dominion', server: null, serverName: null })
})

test('a session the page already has is not replaced', () => {
  setGameSession(null)
  setGameSession('Arcania', 'mc.example.net', 'Example')
  adoptRunningGame(['Dominion'])
  expect(gameSession()).toEqual({ profile: 'Arcania', server: 'mc.example.net', serverName: 'Example' })
  setGameSession(null)
})
