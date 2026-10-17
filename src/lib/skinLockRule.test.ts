import { describe, expect, test } from 'bun:test'
import { isOrderedSkin, skinLockVerdict, type SkinLockInput, type SkinLockVerdict } from './skinLockRule'

const base: SkinLockInput = { millidaSkin: true, plusActive: false, orderedSkin: false, skinWidth: 64 }

describe('запуск с HD-скином без PLUS', () => {
  const cases: [Partial<SkinLockInput>, SkinLockVerdict, string][] = [
    [{ skinWidth: 128 }, 'hd-needs-plus', 'HD 128×128 после конца PLUS — ровно тот случай, ради которого блок'],
    [{ skinWidth: 256 }, 'hd-needs-plus', 'HD 256×256 тоже HD'],
    [{ skinWidth: 64 }, 'play', 'обычный скин 64×64 запускается без PLUS'],
    [{ skinWidth: 0 }, 'play', 'размер не узнали — не мешаем играть'],
    [{ skinWidth: 128, plusActive: true }, 'play', 'с действующим PLUS HD разрешён'],
    [{ skinWidth: 256, orderedSkin: true }, 'play', 'скин из оплаченного заказа сервер разрешает навсегда'],
    [{ skinWidth: 128, millidaSkin: false }, 'play', 'лицензия и офлайн-ник берут не скин профиля Millida'],
  ]
  for (const [patch, want, why] of cases) {
    test(why, () => {
      expect(skinLockVerdict({ ...base, ...patch }), why).toBe(want)
    })
  }
})

describe('скин из оплаченного заказа', () => {
  const CDN = 'https://cdn.millida.trade/launcher/skins/'
  const ordered = { kind: 'skin' as const, url: CDN + 'abc.png', source: 'order' }
  const cases: [string | null, Pick<{ kind: 'skin' | 'cape'; url: string; source: string }, 'kind' | 'url' | 'source'>[], boolean, string][] = [
    [CDN + 'abc.png', [ordered], true, 'надетый скин совпал с заказом в гардеробе'],
    [CDN + 'abc.png?v=2', [ordered], true, 'метка кэша в адресе не делает скин чужим'],
    [CDN + 'abc.png', [{ ...ordered, source: 'upload' }], false, 'свой загруженный HD — не заказ'],
    [CDN + 'abc.png', [{ ...ordered, kind: 'cape' }], false, 'заказанный плащ не разрешает HD-скин'],
    [CDN + 'other.png', [ordered], false, 'в гардеробе есть заказ, но надет другой скин'],
    [null, [ordered], false, 'без скина нечего разрешать'],
  ]
  for (const [url, items, want, why] of cases) {
    test(why, () => {
      expect(isOrderedSkin(url, items), why).toBe(want)
    })
  }
})
