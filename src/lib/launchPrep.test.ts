import { expect, test } from 'bun:test'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

// Vite defines these at build time; the launch module pulls in modules that read them.
Object.defineProperty(globalThis, '__HAS_BUNDLED_MUSIC__', { value: false, configurable: true })
Object.defineProperty(globalThis, '__BUNDLED_VIDEOS__', { value: [], configurable: true })

const { cancelPrelaunch, withLaunchPrep } = await import('./launch')
const { useUi } = await import('../state/ui')

test('the launch window is open while the build is prepared and closes before the launch', async () => {
  let openDuring = false
  const prep = await withLaunchPrep('Minecraft 1.20.1', async () => {
    openDuring = useUi.getState().prelaunch.open
    return 'Minecraft 1.20.1'
  })
  expect(openDuring, 'the player sees the window at once, not after the preparation').toBe(true)
  expect(prep).toEqual({ value: 'Minecraft 1.20.1' })
  expect(useUi.getState().prelaunch.open, 'the launch opens its own window').toBe(false)
})

test('a preparation cancelled midway never starts the game', async () => {
  const prep = await withLaunchPrep('Minecraft 1.20.1', async () => {
    cancelPrelaunch()
    return 'Minecraft 1.20.1'
  })
  expect(prep).toBeNull()
  expect(useUi.getState().prelaunch.open).toBe(false)
})

test('work with later steps sees the cancel, so a join behind the preparation can stop before it starts the game', async () => {
  const seen: boolean[] = []
  await withLaunchPrep('Anarchy', async (wanted) => {
    seen.push(wanted())
    cancelPrelaunch()
    seen.push(wanted())
  })
  expect(seen).toEqual([true, false])
})

test('the window stays open for as long as the work runs and closes when it fails too', async () => {
  let openAtLastStep = false
  await expect(
    withLaunchPrep('Anarchy', async () => {
      await Promise.resolve()
      openAtLastStep = useUi.getState().prelaunch.open
      throw new Error('no-profile')
    }),
  ).rejects.toThrow('no-profile')
  expect(openAtLastStep, 'a join inside the work keeps the window on screen').toBe(true)
  expect(useUi.getState().prelaunch.open, 'a failed join must not leave the window hanging').toBe(false)
})
