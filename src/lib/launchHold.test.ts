import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Крестик во время подготовки к «Играть» (C2): окно не должно уничтожаться вместе с подготовкой,
// а ошибка запуска, случившаяся при спрятанном окне, должна дойти до игрока.
let tauriPresent = true
const shown: number[] = []
let showFails = false
mock.module('../ipc/tauri', () => ({ hasTauri: () => tauriPresent, tauri: () => null }))
mock.module('../ipc/commands', () => ({
  showFromTray: () => {
    shown.push(1)
    return showFails ? Promise.reject(new Error('no tray')) : Promise.resolve()
  },
}))

const { currentHold, watchHolds } = await import('./unloadHold')
const H = await import('./launchHold')

const setVisibility = (state: 'hidden' | 'visible') =>
  Object.defineProperty(globalThis, 'document', { value: { visibilityState: state }, configurable: true })

describe('удержание окна на время подготовки запуска', () => {
  beforeEach(() => {
    H.setLaunchBusy(false)
    shown.length = 0
    tauriPresent = true
    showFails = false
    setVisibility('visible')
  })

  test('пока запуск готовится, окно удерживается; когда ушёл в ядро — отпускается', () => {
    expect(currentHold()).toBeNull()
    H.setLaunchBusy(true)
    expect(currentHold(), 'без удержания крестик уничтожил бы страницу, и игра не стартовала бы').toBe('launch')
    expect(H.launchBusy()).toBe(true)
    H.setLaunchBusy(false)
    expect(currentHold()).toBeNull()
  })

  test('окно слышит конец подготовки, чтобы выгрузиться само, и только одно изменение за раз', () => {
    let heard = 0
    const off = watchHolds(() => heard++)
    H.setLaunchBusy(true)
    H.setLaunchBusy(true)
    H.setLaunchBusy(false)
    H.setLaunchBusy(false)
    expect(heard).toBe(2)
    off()
    H.setLaunchBusy(true)
    expect(heard, 'после снятия подписки окно не будится').toBe(2)
  })

  test('ошибка запуска при спрятанном окне выводит окно на экран', () => {
    setVisibility('hidden')
    H.surfaceLaunchFailure()
    expect(shown.length, 'тост в спрятанном окне никто не увидит').toBe(1)
  })

  test('при видимом окне, в браузере и без ядра окно не трогается', () => {
    H.surfaceLaunchFailure()
    setVisibility('hidden')
    tauriPresent = false
    H.surfaceLaunchFailure()
    expect(shown.length).toBe(0)
  })

  test('сбой показа окна не роняет обработку ошибки запуска', async () => {
    setVisibility('hidden')
    showFails = true
    const warn = console.warn
    const seen: unknown[][] = []
    console.warn = (...a: unknown[]) => void seen.push(a)
    try {
      H.surfaceLaunchFailure()
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      console.warn = warn
    }
    expect(String(seen[0]?.[0])).toContain('[launch]')
  })
})
