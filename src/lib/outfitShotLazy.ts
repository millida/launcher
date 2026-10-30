import { idle3d } from './lazy3d'
import type { OutfitShot } from './outfitSnapshot'
import { noted } from './noted'

/*
 * Снимки наборов магазина без three.js в экране. Настоящий модуль (outfitSnapshot.ts) тянет
 * three.js и движок mine3d ≈735 КБ; экраны «Магазин» и «Скины» теперь берут снимки отсюда:
 * 3D подгружается после простоя, а на слабом ПК не грузится — карточка остаётся с плоским
 * превью вещей (как при сорванном снимке).
 */

export { focusOf, shotAspect } from './outfitShotMeta'
export type { OutfitShot }

type Snapshot = typeof import('./outfitSnapshot')

const load = (): Promise<Snapshot> => import('./outfitSnapshot')

export function outfitShot(...args: Parameters<Snapshot['outfitShot']>): Promise<OutfitShot | null> {
  return idle3d()
    .then((ok) => (ok ? load().then((m) => m.outfitShot(...args)) : null))
    .catch(() => null)
}

export function warmOutfitShots(): void {
  void idle3d()
    .then((ok) => (ok ? load().then((m) => m.warmOutfitShots()) : undefined))
    .catch(noted('outfit-shots'))
}
