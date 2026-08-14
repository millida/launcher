import { describe, expect, it } from 'bun:test'
import { MIC_TUNING, micGateStep, type GateState } from './mic-worklet'

const START: GateState = { noise: 0.01, gate: 0, hold: 0 }

/// Прогон одного уровня сигнала через N блоков — так же, как это делает
/// процессор в реальном времени.
function run(state: GateState, rms: number, blocks: number, mode: keyof typeof MIC_TUNING): GateState {
  const t = MIC_TUNING[mode]
  let s = state
  for (let i = 0; i < blocks; i++) s = micGateStep(s, rms, t.open, t.floor, t.residual)
  return s
}

describe('шумоподавление микрофона', () => {
  it('речь открывает ворота: голос не должен пропадать в начале фразы', () => {
    const s = run(START, 0.2, 20, 'standard')
    expect(s.gate).toBeGreaterThan(0.9)
  })

  it('тишина закрывает ворота — иначе собеседник слышит комнату целиком', () => {
    const open = run(START, 0.2, 40, 'standard')
    const quiet = run(open, 0.001, 400, 'standard')
    expect(quiet.gate).toBeLessThan(0.15)
  })

  it('тихий шум ниже порога не открывает ворота даже надолго', () => {
    const s = run(START, 0.004, 600, 'standard')
    expect(s.gate).toBeLessThan(0.2)
  })

  it('пауза внутри фразы не захлопывает ворота: удержание держит их открытыми', () => {
    const open = run(START, 0.2, 40, 'standard')
    const gap = run(open, 0.0005, 60, 'standard')
    expect(gap.gate).toBeGreaterThan(0.9)
  })

  it('длинная фраза не становится «шумом» и не режет сама себя', () => {
    const s = run(START, 0.15, 3000, 'standard')
    expect(s.gate).toBeGreaterThan(0.9)
  })

  it('сильный режим строже обычного: то, что проходит в обычном, может не пройти в сильном', () => {
    const soft = run(START, 0.009, 300, 'standard')
    const hard = run(START, 0.009, 300, 'strong')
    expect(hard.gate).toBeLessThan(soft.gate)
  })

  it('выключенное шумоподавление пропускает всё как есть', () => {
    const t = MIC_TUNING.off
    const s = micGateStep(START, 0.0001, t.open, t.floor, t.residual)
    expect(s.gate).toBe(1)
  })
})
