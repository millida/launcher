import { describe, expect, test } from 'bun:test'
import { fittedZoom } from './uiZoom'

describe('interface size zooms the webview only as far as the layout still fits the window', () => {
  const cases: Array<[Parameters<typeof fittedZoom>[0], number, number, number, string]> = [
    [100, 1200, 760, 1, '100% never zooms'],
    [130, 1920, 1040, 1.3, 'a maximised window takes the full choice'],
    [150, 1920, 1040, 1.5, 'a maximised window takes 150% as well'],
    [150, 1200, 760, 1.19, 'the default window stops where the lobby would be cut at the bottom'],
    [130, 980, 640, 1, 'the minimum window has no room to zoom at all'],
    [115, 1600, 900, 1.15, 'a roomy window takes a small step as is'],
    [150, 0, 0, 1, 'an unknown window size leaves the interface at 100%'],
  ]
  for (const [scale, w, h, want, why] of cases) test(why, () => expect(fittedZoom(scale, w, h), why).toBe(want))
})
