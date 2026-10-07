import { describe, expect, test } from 'bun:test'
import { Group, Mesh, MeshLambertMaterial, Texture } from 'three'
import { textured } from './shotTextures'

const picture = { width: 64, height: 64 }

function item(map: Texture | null, glow?: Texture) {
  const root = new Group()
  const inner = new Group()
  inner.add(new Mesh(undefined, new MeshLambertMaterial({ map, ...(glow ? { emissiveMap: glow } : {}) })))
  root.add(inner)
  return root
}

const loaded = () => new Texture(picture as unknown as HTMLImageElement)
const missing = () => new Texture()

/** A shop snapshot counts an item as worn only when its pictures arrived; otherwise a bare figure gets cached. */
describe('textured', () => {
  const cases: [string, () => Group, boolean, string][] = [
    ['picture arrived', () => item(loaded()), true, 'a loaded item must count as worn'],
    ['picture failed', () => item(missing()), false, 'a failed CDN load renders invisible and must not count'],
    ['glow failed', () => item(loaded(), missing()), false, 'neon items without their glow map render as dark blots'],
    ['no picture at all', () => item(null), true, 'an untextured mesh has nothing to wait for'],
  ]
  for (const [name, make, want, why] of cases) {
    test(name, () => {
      expect(textured(make()), why).toBe(want)
    })
  }
})
