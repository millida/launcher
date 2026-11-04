import { describe, expect, mock, test } from 'bun:test'
import { onMediaChange } from './mediaQuery'

describe('onMediaChange', () => {
  test('uses the standard listener where the WebView has it', () => {
    const query = { addEventListener: mock(), removeEventListener: mock(), addListener: mock(), removeListener: mock() }
    const listener = () => {}
    const stop = onMediaChange(query as unknown as MediaQueryList, listener)
    stop()
    expect(query.addEventListener).toHaveBeenCalledWith('change', listener)
    expect(query.removeEventListener).toHaveBeenCalledWith('change', listener)
    expect(query.addListener).not.toHaveBeenCalled()
  })

  test('falls back on old WebKit, where addEventListener threw on the hosting screen', () => {
    const query = { addListener: mock(), removeListener: mock() }
    const listener = () => {}
    const stop = onMediaChange(query as unknown as MediaQueryList, listener)
    stop()
    expect(query.addListener).toHaveBeenCalledWith(listener)
    expect(query.removeListener).toHaveBeenCalledWith(listener)
  })
})
