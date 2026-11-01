import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Скачанное обновление живёт на диске у ядра, а не в памяти окна (R2 ревью 27.10.2026):
// новая страница его подхватывает, не качает заново, а выход ставит готовое.
const realTimeout = globalThis.setTimeout
// «Через 15 с тишины» в тесте — сразу.
globalThis.setTimeout = ((fn: () => void, ms?: number) => realTimeout(fn, (ms ?? 0) >= 10_000 ? 0 : ms)) as typeof setTimeout
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
})

interface Staged {
  version: string
  path: string
  started: boolean
}
let staged: Staged | null = null
const calls = { stage: 0, stageSkipsDelta: [] as Array<boolean | undefined>, deltaAsked: 0, run: [] as Array<[string, boolean | undefined]>, showAfter: 0, exit: 0, pluginDownload: 0, pluginCheck: 0 }
let manifest = { version: '2.0.302', critical: false }
let stageFails = false
let pluginFindsVersion: string | null = '2.0.302'

mock.module('../ipc/tauri', () => ({ hasTauri: () => true, tauri: () => null }))
mock.module('../ipc/commands', () => ({
  appVersion: async () => '2.0.300',
  isFlatpak: async () => false,
  showAfterUpdate: async () => void calls.showAfter++,
  updateFallbackCheck: async () => ({ version: manifest.version, notes: '', url: '', file: 'f', signature: 's', source: '', critical: manifest.critical }),
  updateFallbackRun: async (path: string, restart?: boolean) => {
    calls.run.push([path, restart])
    return { version: '', path, started: true }
  },
  updateFallbackStage: async (skipDelta?: boolean) => {
    calls.stage++
    calls.stageSkipsDelta.push(skipDelta)
    if (stageFails) throw new Error('нет сети')
    staged = { version: manifest.version, path: '/updates/new.exe', started: false }
    return staged
  },
  updateStaged: async () => staged,
  // Патча в этих сценариях нет: обычный путь.
  updateDeltaStage: async () => {
    calls.deltaAsked++
    return null
  },
}))
mock.module('@tauri-apps/plugin-updater', () => ({
  check: async () => {
    calls.pluginCheck++
    if (!pluginFindsVersion) return null
    return {
      version: pluginFindsVersion,
      body: '',
      rawJson: {},
      download: async () => void calls.pluginDownload++,
      install: async () => {},
    }
  },
}))
mock.module('@tauri-apps/plugin-process', () => ({
  exit: async () => void calls.exit++,
  relaunch: async () => {},
}))
mock.module('./prefs', () => ({ readPref: (_k: string, d: string) => d, writePref: () => {}, hydratePrefs: async () => {} }))
mock.module('../state/ui', () => ({ showToast: () => {} }))
mock.module('./api', () => ({ openExt: () => {} }))
mock.module('./crash', () => ({ reportError: async () => {} }))
mock.module('./telemetry', () => ({
  cancelAppExit: () => {},
  track: () => {},
  trackAppExit: () => {},
  trackFailure: () => {},
}))

const U = await import('./updater')
const { useUpdate } = await import('../state/update')
const settle = () => new Promise((r) => realTimeout(r, 30))

describe('обновление лаунчера лежит на диске у ядра', () => {
  beforeEach(() => {
    U.__resetUpdaterForTests()
    useUpdate.setState({ version: null, staged: false, busy: false, manual: false, failed: false, bootPhase: 'idle', bootPct: 0 })
    staged = null
    stageFails = false
    manifest = { version: '2.0.302', critical: false }
    pluginFindsVersion = '2.0.302'
    calls.stage = 0
    calls.stageSkipsDelta = []
    calls.deltaAsked = 0
    calls.run = []
    calls.showAfter = 0
    calls.exit = 0
    calls.pluginDownload = 0
    calls.pluginCheck = 0
  })

  test('новое окно подхватывает скачанное ядром и показывает «готово», ничего не качая', async () => {
    staged = { version: '2.0.302', path: '/updates/x.exe', started: false }
    expect(await U.adoptStaged()).toBe('2.0.302')
    expect(U.updateReady(), 'выход из трея теперь знает, что ставить').toBe(true)
    expect(useUpdate.getState().staged).toBe(true)
    expect(U.pendingUpdate()?.version).toBe('2.0.302')
    expect(calls.stage + calls.pluginDownload).toBe(0)
  })

  test('на диске ничего нет — окно остаётся без «готово»', async () => {
    expect(await U.adoptStaged()).toBeNull()
    expect(U.updateReady()).toBe(false)
  })

  test('каждое открытие окна не качает ~55 МиБ заново: скачанная версия та же', async () => {
    staged = { version: '2.0.302', path: '/updates/x.exe', started: false }
    await U.bootUpdate()
    await settle()
    expect(calls.pluginCheck).toBe(1)
    expect(calls.stage, 'ядро не просят скачать то, что уже лежит на диске').toBe(0)
    expect(calls.pluginDownload, 'плагин не качает в память окна').toBe(0)
    expect(useUpdate.getState().staged).toBe(true)
  })

  test('вышла версия новее скачанной — ядро качает её на диск, плагин не нужен', async () => {
    staged = { version: '2.0.301', path: '/updates/old.exe', started: false }
    await U.bootUpdate()
    await settle()
    expect(calls.stage).toBe(1)
    expect(calls.pluginDownload).toBe(0)
    expect(U.updateReady()).toBe(true)
  })

  test('первая загрузка обычного выпуска идёт через ядро, на диск', async () => {
    await U.bootUpdate()
    await settle()
    expect(calls.stage).toBe(1)
    expect(calls.pluginDownload, 'скачанное плагином пропало бы вместе с окном').toBe(0)
  })

  // С3 второго ревью: патч пробовался дважды за проход — окно, а потом ещё раз ядро, когда стало качать установщик.
  test('патч пробуется один раз за проход: после него ядру велено сразу взять установщик', async () => {
    await U.bootUpdate()
    await settle()
    expect(calls.deltaAsked, 'окно спросило ядро про патч').toBe(1)
    expect(calls.stage).toBe(1)
    expect(calls.stageSkipsDelta, 'ядро не пробует патч второй раз').toEqual([true])
  })

  test('ядро не смогло скачать — запасной путь через плагин остаётся', async () => {
    stageFails = true
    const warn = console.warn
    console.warn = () => {}
    try {
      await U.bootUpdate()
      await settle()
    } finally {
      console.warn = warn
    }
    expect(calls.stage).toBe(1)
    expect(calls.pluginDownload).toBe(1)
  })

  test('выход сразу после открытия окна ставит скачанное ядром, без перезапуска', async () => {
    staged = { version: '2.0.302', path: '/updates/x.exe', started: false }
    expect(await U.installUpdateOnExit()).toBe(true)
    expect(calls.run).toEqual([['/updates/x.exe', false]])
    expect(calls.exit, 'лаунчер закрыт, как просил игрок').toBe(1)
  })

  test('нечего ставить — выход идёт как обычно', async () => {
    expect(await U.installUpdateOnExit()).toBe(false)
    expect(calls.run).toEqual([])
  })

  test('кнопка «Обновить» ставит скачанное без нового запроса манифеста и просит показать окно после обновления', async () => {
    staged = { version: '2.0.302', path: '/updates/x.exe', started: false }
    await U.adoptStaged()
    await U.applyUpdate()
    expect(calls.run).toEqual([['/updates/x.exe', undefined]])
    expect(calls.showAfter).toBe(1)
  })
})
