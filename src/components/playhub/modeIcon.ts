import ART from './mode-art.json'

/**
 * Значок режима — набор в стиле Blups (владелец 30.09.2026, 15:06: «перерисовать
 * все иконки режимов с нуля»): предмет 16×16 с толстым контуром на мозаике
 * цвета режима. Источник — `scripts/mode-icons.mjs`, картинки и этот манифест
 * пишет `scripts/render-mode-art.mjs` (те же файлы уходят на millida.net/katalog).
 * Кода нет в наборе — `null`, плитка рисует прежнюю сцену из блоков.
 */
export interface ModeIconArt {
  title: string
  color: string
  /** Значок 16×16, растягивается целым шагом без сглаживания. */
  icon: string
  /** Фон плитки: мозаика 12×12 клеток. */
  bg: string
  /**
   * Риг режима — рендер hero-rigs сайта в стиле Mojang (владелец 30.09.2026,
   * 15:42: плоские значки заменить ригами). Пишет scripts/render-mode-rigs.py.
   */
  rig: { url: string; w: number; h: number } | null
}

const MANIFEST = ART as Record<string, { title: string; color: string; w: number; h: number; rig?: { src: string; w: number; h: number } }>

export function modeIcon(code: string): ModeIconArt | null {
  const m = MANIFEST[code]
  if (!m) return null
  return {
    title: m.title,
    color: m.color,
    icon: '/mode-art/' + code + '.png',
    bg: '/mode-art/' + code + '-bg.png',
    rig: m.rig ? { url: '/mode-art/rigs/' + code + '.webp', w: m.rig.w, h: m.rig.h } : null,
  }
}

/** Картинки баннера OneBlock — те же, что в первом экране mcru.me (осенний сезон). */
export const ONEBLOCK_ART = {
  bg: '/mode-art/oneblock/bg.webp',
  logo: '/mode-art/oneblock/logo.webp',
  rig: '/mode-art/oneblock/rig-47.webp',
}
