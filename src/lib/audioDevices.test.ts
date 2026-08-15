import { describe, expect, it } from 'bun:test'
import { micConstraintFor, micProcessingConstraint } from './audioDevices'

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
