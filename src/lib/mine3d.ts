import type * as Mine3d from '../vendor/mine3d'

export type Mine3dModule = typeof Mine3d

let pending: Promise<Mine3dModule> | null = null

export function loadMine3d(): Promise<Mine3dModule> {
  if (pending) return pending
  pending = import('../vendor/mine3d').catch((e) => {
    pending = null
    throw e
  })
  return pending
}
