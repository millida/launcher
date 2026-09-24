import { describe, expect, it } from 'bun:test'
import { defaultVariant } from './cosmeticVariants'

describe('цвет вещи по умолчанию', () => {
  it('берём тот же, которым нарисована картинка каталога', () => {
    // Афро и очки лежат в каталоге чёрными первыми, а на картинке они белые.
    const afro = [{ name: 'black' }, { name: 'blonde' }, { name: 'white' }]
    expect(defaultVariant(afro)?.name).toBe('white')
  })

  it('привычных имён нет - берём первый, а не пустоту', () => {
    expect(defaultVariant([{ name: 'gold' }, { name: 'silver' }])?.name).toBe('gold')
    expect(defaultVariant([])).toBeNull()
    expect(defaultVariant(undefined)).toBeNull()
  })

  it('порядок предпочтений соблюдается: обычный раньше светлого', () => {
    expect(defaultVariant([{ name: 'light' }, { name: 'default' }])?.name).toBe('default')
  })
})
