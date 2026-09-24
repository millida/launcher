import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Отказ от телеметрии обязан выключать и отчёты об ошибках (аудит 24.09.2026,
// CORE-9): раньше reportError и паники ядра уходили на /errors в обход настройки.
let telemetryOn = true
const posted: Array<{ path: string; body: any }> = []
let crashes: Array<{ file: string; message: string; details: string }> = []
let cleared = 0

mock.module('./telemetry', () => ({ telemetryEnabled: () => telemetryOn }))
mock.module('./api', () => ({
  api: async (path: string, init: { body: string }) => {
    posted.push({ path, body: JSON.parse(init.body) })
    return {}
  },
}))
mock.module('../ipc/tauri', () => ({ hasTauri: () => true }))
mock.module('../ipc/commands', () => ({
  appVersion: async () => '1.0.0',
  readCrashes: async () => crashes,
  clearCrashes: async () => void (cleared += 1),
  onCoreFailure: () => {},
  defaultJava: async () => null,
  deviceSpecs: async () => null,
  listJavaRuntimes: async () => [],
  loadProfileSettings: async () => null,
  testJava: async () => '',
  tuneProfile: async () => null,
}))

const { reportError, flushNativeCrashes } = await import('./crash')

describe('отчёты об ошибках и отказ от телеметрии', () => {
  beforeEach(() => {
    posted.length = 0
    crashes = [{ file: 'panic-1.txt', message: 'boom', details: 'at C:\\Users\\Иван\\AppData\\x.rs' }]
    cleared = 0
  })

  test('без согласия reportError ничего не отправляет', async () => {
    telemetryOn = false
    await reportError('window', new Error('fail in /Users/ivan/secret'))
    expect(posted).toHaveLength(0)
  })

  test('без согласия паники ядра стираются, но не уходят', async () => {
    telemetryOn = false
    await flushNativeCrashes()
    expect(posted).toHaveLength(0)
    expect(cleared).toBe(1)
  })

  test('с согласием уходит отчёт без имени пользователя в путях', async () => {
    telemetryOn = true
    await reportError('window', new Error('fail in /Users/ivan/secret'))
    await flushNativeCrashes()
    expect(posted.length).toBe(2)
    const text = JSON.stringify(posted)
    expect(text).not.toContain('ivan')
    expect(text).not.toContain('Иван')
  })
})
