export const hexColor = (c?: string | null) => {
  const s = (c || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] as const
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Порог «цветного» пикселя: ниже — серый, чёрный или белый. */
const GREY = 0.18
/** Бесцветная база: у чёрной, белой и серой расцветки тон ничего не значит. */
const GREY_BASE = 0.15
/** Насколько светлота пикселя может уйти от бесцветной базы и ещё быть её цветом. */
const GREY_BAND = 0.3
/**
 * Чёрная база в цветную расцветку: насколько подтянуть светлоту к цвету
 * расцветки. Не до конца — у «красных» демонических крыльев красные только
 * перепонки, а кости остаются чёрными; полная заливка ошибалась сильнее, чем
 * никакая. Подобрано по 199 расцветкам, у которых есть своё превью: средняя
 * ошибка цвета 41 → 20 (из 255).
 */
const GREY_TO_COLOR = 0.4
const GREY_TO_COLOR_SAT = 0.7

/**
 * Перекраска RGBA-пикселей превью из цвета базовой расцветки `from` в `to`.
 * Чистая функция над массивом: её же гоняет аудит каталога на настоящих
 * превью. Возвращает число перекрашенных пикселей — ноль значит, что карточка
 * расцветки выйдет копией базы.
 */
export function recolorPixels(d: Uint8ClampedArray | number[], from: string | null | undefined, to: string): number {
  const target = hexColor(to)
  if (!target) return 0
  const [th, ts, tl] = rgb2hsl(target[0], target[1], target[2])
  const base = hexColor(from)
  const bh = base ? rgb2hsl(base[0], base[1], base[2]) : null
  const greyBase = !!bh && bh[1] <= GREY_BASE
  // Светлота расцветки против базовой: чёрная расцветка темнит, белая светлит.
  const lk = bh ? (tl + 0.05) / (bh[2] + 0.05) : 1
  // Серая цель из серой базы: пиксели уходят к светлоте цели, тень и блик
  // остаются сдвигом. Чистые чёрный и белый на превью не бывают — у «чёрной»
  // ткани тени и блики, поэтому цель ставится внутрь.
  const goal = clamp(tl, 0.2, 0.8)
  let changed = 0
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] as number) < 16) continue
    const [h, s, l] = rgb2hsl(d[i] as number, d[i + 1] as number, d[i + 2] as number)
    let ns: number
    let nl: number
    if (greyBase) {
      // Бесцветная база: свои пиксели узнаются по светлоте, а не по тону.
      if (s >= GREY || Math.abs(l - bh![2]) > GREY_BAND) continue
      if (ts <= GREY_BASE) {
        const shift = (l - bh![2]) * 0.8
        nl = goal + shift
        // Тень белой вещи на чёрной уходит в минус — отражаем её в блик.
        if (nl < 0.04 || nl > 0.96) nl = goal - shift
        ns = ts
      } else {
        nl = l + (tl - l) * GREY_TO_COLOR
        ns = Math.min(1, ts * GREY_TO_COLOR_SAT)
      }
    } else {
      // Цветная база: прежнее правило — оно точнее любого другого на 263
      // расцветках со своим превью (средняя ошибка 41 → 26).
      if (s < GREY) continue
      if (bh && bh[1] > GREY_BASE && hueGap(h, bh[0]) > 38) continue
      ns = ts < 0.08 ? ts : Math.min(1, s * (ts / Math.max(0.2, bh ? bh[1] : s)))
      nl = l * lk
    }
    const [r, g, b] = hsl2rgb(th, ns, clamp(nl, 0.03, 0.97))
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    changed++
  }
  return changed
}
