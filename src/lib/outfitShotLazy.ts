import { idle3d } from './lazy3d'
import { fullShotKey, storedShot, type OutfitShot } from './outfitShotStore'
import { SHOT_H, SHOT_W, type ShotFocus } from './outfitShotMeta'
import { noted } from './noted'

/*
 * Снимки наборов магазина без three.js в экране. Настоящий модуль (outfitSnapshot.ts) тянет
 * three.js и движок mine3d ≈735 КБ; экраны «Магазин» и «Скины» теперь берут снимки отсюда:
 * 3D подгружается после простоя, а на слабом ПК не грузится — карточка остаётся с плоским
 * превью вещей (как при сорванном снимке).
 *
 * A finished shot (memory, IndexedDB) shows at once, without waiting for idle or the 3D module.
 * The shots module is needed only for what is missing: a new shot and the loop of a moving item.
 */

export { focusOf, shotAspect } from './outfitShotMeta'
export type { OutfitShot }

type Snapshot = typeof import('./outfitSnapshot')

const load = (): Promise<Snapshot> => import('./outfitSnapshot')

export function outfitShot(
  skin: string,
  slim: boolean,
  codes: readonly string[],
  focus: ShotFocus = 'full',
  aspect = SHOT_W / SHOT_H,
  el?: Element | null,
  onLoop?: (shot: OutfitShot) => void,
): Promise<OutfitShot | null> {
  const heavy = () =>
    idle3d()
      .then((ok) => (ok ? load().then((m) => m.outfitShot(skin, slim, codes, focus, aspect, el, onLoop)) : null))
      .catch(() => null)
  return storedShot(fullShotKey(skin, slim, codes, focus, aspect))
    .then((hit) => {
      if (!hit) return heavy()
      // A frame from disk with no loop yet: the shots module makes it once 3D is allowed.
      if (hit.pending && onLoop) void heavy()
      return hit
    })
    .catch(() => null)
}

export function warmOutfitShots(): void {
  void idle3d()
    .then((ok) => (ok ? load().then((m) => m.warmOutfitShots()) : undefined))
    .catch(noted('outfit-shots'))
}
