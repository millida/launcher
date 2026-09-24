import { expect, test } from 'bun:test'

interface Started {
  freq: number
}

const started: Started[] = []
let resumed = 0

class FakeGain {
  gain = {
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  }
  connect() {}
}

class FakeOsc {
  type = ''
  frequency = { value: 0 }
  connect() {}
  start() {
    started.push({ freq: this.frequency.value })
  }
  stop() {}
}

class FakeAudioContext {
  state: 'suspended' | 'running' = 'suspended'
  currentTime = 0
  destination = {}
  resume() {
    resumed++
    this.state = 'running'
    return Promise.resolve()
  }
  createOscillator() {
    return new FakeOsc()
  }
  createGain() {
    return new FakeGain()
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} }
  }
}

Object.defineProperty(globalThis, 'window', {
  value: { AudioContext: FakeAudioContext, addEventListener() {}, removeEventListener() {} },
  configurable: true,
})

const { playSound } = await import('./sound')

// Звуки — только из Minecraft (приказ владельца 22.09.2026): пока файлы игры
// не скачались, уведомление молчит. Раньше здесь синтезировался тон, и это
// был единственный чужой звук в лаунчере.
test('звуки игры не скачаны — лаунчер будит аудио, но ничего не синтезирует', async () => {
  playSound('notify')
  await Promise.resolve()
  await Promise.resolve()
  expect(resumed).toBe(1)
  expect(started.map((s) => s.freq)).toEqual([])
})

test('выключенный звук ничего не будит', async () => {
  started.length = 0
  resumed = 0
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => (k === 'm-sound-mode' ? 'off' : null), setItem() {}, removeItem() {} },
    configurable: true,
  })
  playSound('success')
  await Promise.resolve()
  expect(started).toHaveLength(0)
  expect(resumed).toBe(0)
})
