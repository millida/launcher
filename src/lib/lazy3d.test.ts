import { describe, expect, test } from 'bun:test'
import { QUIET_FIRST_MID_MS, QUIET_FIRST_MS, firstQuietMs, preloadQuietMs } from './lazy3d'

describe('preloadQuietMs', () => {
  test('only a low PC waits for quiet before it parses three.js, or the parse lands on opening the lobby', () => {
    expect(preloadQuietMs('low')).toBe(QUIET_FIRST_MS)
    expect(preloadQuietMs('mid')).toBeNull()
    expect(preloadQuietMs('high')).toBeNull()
  })
})

describe('firstQuietMs', () => {
  test('a strong PC builds the first scene right after the first frame, without waiting for quiet', () => {
    expect(firstQuietMs('high')).toBeNull()
  })

  test('a mid PC waits a short quiet, a low one keeps the long wait that stops the entry freeze', () => {
    expect(firstQuietMs('mid')).toBe(QUIET_FIRST_MID_MS)
    expect(firstQuietMs('low')).toBe(QUIET_FIRST_MS)
    expect(QUIET_FIRST_MID_MS).toBeLessThan(QUIET_FIRST_MS)
  })
})
