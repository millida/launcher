import { describe, expect, it } from 'bun:test'
import { offPlatformReason } from '../lib/offPlatform'

/// The launcher must tell why a message was held, and must not offer «try again»
/// for it: the same text is held again and the rule stays unexplained.
describe('offPlatformReason', () => {
  it('reads the reason the core passed with its marker', () => {
    const e = new Error('off-platform: Сообщение не отправлено: контакты вне площадки запрещены.')
    expect(offPlatformReason(e)).toBe('Сообщение не отправлено: контакты вне площадки запрещены.')
  })

  it('an ordinary network failure stays retryable', () => {
    expect(offPlatformReason(new Error('http 500'))).toBeNull()
    expect(offPlatformReason(new Error('нет сети'))).toBeNull()
  })

  it('survives a non-error throw', () => {
    expect(offPlatformReason('off-platform: нельзя')).toBe('нельзя')
    expect(offPlatformReason(null)).toBeNull()
  })
})
