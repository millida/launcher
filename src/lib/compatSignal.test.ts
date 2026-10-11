import { describe, expect, test } from 'bun:test'
import { signalBody } from './compatSignal'

const mod = (name: string, p?: string, v?: string, enabled = true) => ({ name, enabled, project_id: p, version_number: v })
const fabric = { version: '1.21.1', loader: 'fabric' }

describe('Голос в граф совместимости', () => {
  test('вылет из-за мода: набор, сигнатура и виновник — только id и версии', () => {
    const body = signalBody(fabric, [mod('sodium.jar', 'AANobbMI', '0.6.0'), mod('iris.jar', 'YL57xq9U', '1.8.0'), mod('off.jar', 'x', '1', false)], {
      kind: 'mixin',
      cause: 'Mixin apply failed',
      culprits: ['iris.jar'],
    })
    expect(body).toEqual({
      mc: '1.21.1',
      loader: 'fabric',
      mods: [
        { p: 'AANobbMI', v: '0.6.0' },
        { p: 'YL57xq9U', v: '1.8.0' },
      ],
      ok: false,
      errorSignature: 'mixin:Mixin apply failed',
      culprit: [{ p: 'YL57xq9U', v: '1.8.0' }],
    })
  })

  test('вылеты не про моды и неопознанные наборы не голосуют', () => {
    const mods = [mod('a.jar', 'A', '1')]
    expect(signalBody(fabric, mods, { kind: 'oom' }), 'память — про компьютер, не про мод').toBeNull()
    expect(signalBody(fabric, mods, { kind: 'gpu_driver' }), 'драйвер — тоже').toBeNull()
    expect(signalBody({ version: '1.21.1', loader: 'vanilla' }, mods, null), 'ванилла без модов').toBeNull()
    expect(signalBody(fabric, [mod('a.jar', 'A', '1'), mod('b.jar'), mod('c.jar')], null), 'две трети не опознаны — набор не сравним').toBeNull()
  })

  test('спокойная игра — голос «работает»', () => {
    expect(signalBody({ version: '1.20.1', fabric: true }, [mod('a.jar', 'A', '1')], null)).toEqual({ mc: '1.20.1', loader: 'fabric', mods: [{ p: 'A', v: '1' }], ok: true })
  })
})
