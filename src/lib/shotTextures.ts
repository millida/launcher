import type { Object3D } from 'three'

type Mapped = { map?: { image?: unknown } | null; emissiveMap?: { image?: unknown } | null }

/** Every picture under `root` has arrived: TextureLoader sets `image` only on success. */
export function textured(root: Object3D): boolean {
  let ready = true
  root.traverse((node) => {
    const mats = (node as { material?: Mapped | Mapped[] }).material
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if ((m.map && !m.map.image) || (m.emissiveMap && !m.emissiveMap.image)) ready = false
    }
  })
  return ready
}
