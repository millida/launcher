import { describe, expect, it } from 'bun:test'
import { listAudioDevices, micConstraintFor, micProcessingConstraint } from './audioDevices'

// Вход → вердикт. Автоуровень движка ведёт громкость сам и на долгой речи её
// убавляет, поэтому он обязан подчиняться настройке, а не стоять жёстко.
describe('ограничения микрофона', () => {
  it('автоуровень уходит в захват ровно таким, каким его выбрали', () => {
    expect(micConstraintFor('', { agc: false, echo: true }, 'standard').autoGainControl).toBe(false)
    expect(micConstraintFor('', { agc: true, echo: true }, 'standard').autoGainControl).toBe(true)
  })

  it('эхоподавление настраивается отдельно от автоуровня', () => {
    expect(micConstraintFor('', { agc: false, echo: false }, 'standard').echoCancellation).toBe(false)
    expect(micConstraintFor('', { agc: false, echo: true }, 'standard').echoCancellation).toBe(true)
  })

  // «Выключен» обязан выключать оба слоя: пока шумоподавление движка стояло
  // жёстко, микрофон продолжал приседать на речи, и в настройках это не отключалось.
  it('шумоподавление движка подчиняется выбранному режиму', () => {
    expect(micConstraintFor('', { agc: false, echo: false }, 'off').noiseSuppression).toBe(false)
    expect(micConstraintFor('', { agc: false, echo: false }, 'standard').noiseSuppression).toBe(true)
    expect(micConstraintFor('', { agc: false, echo: false }, 'strong').noiseSuppression).toBe(true)
  })

  it('выбранное устройство запрашивается точно, системное — не запрашивается вовсе', () => {
    expect(micConstraintFor('dev-1', { agc: false, echo: true }, 'standard').deviceId).toEqual({
      exact: 'dev-1',
    })
    expect('deviceId' in micConstraintFor('', { agc: false, echo: true }, 'standard')).toBe(false)
  })

  it('живой дорожке уходит только обработка: смена устройства требует нового захвата', () => {
    expect(micProcessingConstraint({ agc: true, echo: false }, 'off')).toEqual({
      autoGainControl: true,
      echoCancellation: false,
      noiseSuppression: false,
    })
  })
})

type FakeDevice = { kind: string; deviceId: string; label: string }

const withDevices = async (list: FakeDevice[]) => {
  ;(globalThis as unknown as { navigator: unknown }).navigator = {
    mediaDevices: { enumerateDevices: () => Promise.resolve(list) },
  }
  return listAudioDevices(false)
}

// Вход → вердикт. Названия устройств браузер прячет, пока страница ни разу не
// держала микрофон, а «Устройство 1» и «Устройство 2» — это выбор вслепую.
describe('список звуковых устройств', () => {
  it('устройства без названий в список не попадают', async () => {
    const d = await withDevices([
      { kind: 'audioinput', deviceId: 'default', label: '' },
      { kind: 'audiooutput', deviceId: 'default', label: '' },
    ])
    expect(d.named, 'безымянный список обязан помечаться как «названий нет»').toBe(false)
    expect(d.inputs.length + d.outputs.length, 'безымянные устройства выбирать нечем').toBe(0)
  })

  // Псевдоним default повторяет первый пункт списка — «Системное по умолчанию».
  it('системный псевдоним не дублирует пункт по умолчанию', async () => {
    const d = await withDevices([
      { kind: 'audiooutput', deviceId: 'default', label: 'Default - Наушники' },
      { kind: 'audiooutput', deviceId: 'communications', label: 'Communications - Наушники' },
      { kind: 'audiooutput', deviceId: 'abc', label: 'Наушники (High Definition Audio)' },
      { kind: 'audioinput', deviceId: 'mic1', label: 'Микрофон (USB)' },
    ])
    expect(d.named).toBe(true)
    expect(d.outputs.map((o) => o.label), 'в списке остаются только настоящие устройства').toEqual([
      'Наушники (High Definition Audio)',
    ])
    expect(d.inputs.map((i) => i.id)).toEqual(['mic1'])
  })
})
