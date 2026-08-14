import { describe, expect, it } from 'bun:test'
import { CALL_LOG_PREFIX, callLogTitle, parseCallLog } from './callLog'
import { parseInvite } from '../invite'

describe('запись звонка в переписке', () => {
  it('читает метку, которую пишет сервер', () => {
    expect(parseCallLog(CALL_LOG_PREFIX + '{"outcome":"done","seconds":204}')).toEqual({
      outcome: 'done',
      seconds: 204,
    })
  })

  it('обычный текст и приглашение на сервер карточкой звонка не становятся', () => {
    expect(parseCallLog('позвони мне')).toBeNull()
    expect(parseCallLog('⟪mc-invite⟫{"addr":"play.example.net","name":"Сервер"}')).toBeNull()
  })

  it('метка звонка не читается как приглашение — иначе в ленте была бы кнопка захода', () => {
    expect(parseInvite(CALL_LOG_PREFIX + '{"outcome":"missed","seconds":0}')).toBeNull()
  })

  it('битая метка не роняет ленту', () => {
    expect(parseCallLog(CALL_LOG_PREFIX + 'не json')).toBeNull()
    expect(parseCallLog(CALL_LOG_PREFIX + '{"outcome":"что-то","seconds":1}')).toBeNull()
  })

  it('заголовок зависит от стороны: пропущенный у одного — недозвон у другого', () => {
    expect(callLogTitle({ outcome: 'missed', seconds: 0 }, true)).toBe('Не дозвонился')
    expect(callLogTitle({ outcome: 'missed', seconds: 0 }, false)).toBe('Пропущенный звонок')
    expect(callLogTitle({ outcome: 'done', seconds: 5 }, true)).toBe('Исходящий звонок')
  })
})
