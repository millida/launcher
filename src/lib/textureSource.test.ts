import { describe, expect, mock, test } from 'bun:test'

let fetched: string[] = []
let fetchImpl: (url: string) => Promise<string> = async (url) => 'data:image/png;base64,' + url

mock.module('../ipc/tauri', () => ({ hasTauri: () => true }))
mock.module('../ipc/commands', () => ({
  fetchTexture: (url: string) => {
    fetched.push(url)
    return fetchImpl(url)
  },
}))

const { textureSource, forgetTextureSource } = await import('./textureSource')

const CDN = 'https://cdn.millida.trade/launcher/capes/a.png'

describe('textureSource', () => {
  test('remote textures are read by the core, so no CORS header is needed', async () => {
    fetched = []
    expect(await textureSource(CDN)).toBe('data:image/png;base64,' + CDN)
    expect(fetched).toEqual([CDN])
  })

  test('the same texture is fetched once: cards, 3D preview and apply share one read', async () => {
    fetched = []
    forgetTextureSource(CDN)
    await Promise.all([textureSource(CDN), textureSource(CDN)])
    await textureSource(CDN)
    expect(fetched.length).toBe(1)
  })

  test('a failed read falls back to the original link instead of losing the picture', async () => {
    forgetTextureSource(CDN)
    fetchImpl = async () => {
      throw new Error('нет сети')
    }
    expect(await textureSource(CDN)).toBe(CDN)
    fetchImpl = async (url) => 'data:image/png;base64,' + url
  })

  test('local and inline textures stay untouched: the core has nothing to fetch', async () => {
    fetched = []
    expect(await textureSource('/capes/millida.png')).toBe('/capes/millida.png')
    expect(await textureSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(fetched).toEqual([])
  })
})
