import { loadCosmeticCatalog } from './gameProfile'
import { cosmeticModel } from './characterStage'
import { defaultVariant } from './cosmeticVariants'
import type { WearRef } from '../state/wearIntent'

/**
 * «Надеть» из магазина, сундука или пропуска (04.11.2026: «надевание набора очень долгое»):
 * модели и картинки вещей начинают качаться в момент нажатия, а не когда гардероб открылся,
 * дождался каталога, прав и надетого и только потом стал одевать фигуру. Гардероб берёт их из
 * того же кэша моделей (lib/characterStage) и из кэша картинок браузера.
 */
export function prefetchWear(refs: WearRef[]): void {
  void loadCosmeticCatalog()
    .then((cat) => {
      for (const r of refs) {
        const same = (cat.items || []).filter((c) => c.id === r.code || c.baseId === r.code)
        const item = (r.variant && same.find((c) => c.id.endsWith('~' + r.variant))) || same.find((c) => c.id === r.code) || same[0]
        if (!item?.model) continue
        void cosmeticModel(item.model)
        for (const url of [defaultVariant(item.variants)?.texture ?? item.texture, item.emissive]) {
          if (url) new Image().src = url
        }
      }
    })
    .catch(() => {})
}
