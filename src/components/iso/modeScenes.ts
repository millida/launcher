/**
 * Сцены плиток режимов: островок из блоков в изометрии, как баннер OneBlock
 * (правка владельца 23.09.2026, 23:00: «с OneBlock охуительно — сделай так же
 * со всеми остальными, мобы, риги»). Вместо плоского значка — объём: блоки,
 * головы мобов и предмет режима, воткнутый в землю.
 *
 * Координаты — в блоках: x вправо-вниз, z влево-вниз, y вверх. Трава острова
 * лежит на y = 0, всё, что стоит на ней, — с y = 1.
 */

import { glyphCanvas } from '../playhub/modeArt'
import { renderScene } from './iso'
import type { Item } from './iso'

const c = (b: string, x: number, y: number, z: number, k?: number, h?: number): Item => ({ b, x, y, z, k, h })
/**
 * Один узнаваемый предмет на режим (правка владельца 24.09.2026, 07:26:
 * «выживание — просто блок земли, анархия — TNT, BedWars — кровать,
 * SkyWars — лук»). Блок — объёмный, как в инвентаре; предмет — плоский.
 */
const block = (b: string): (() => Item[]) => () => [c(b, 0, 0, 0)]
const item = (glyph: string): (() => Item[]) => () => [{ img: glyphCanvas(glyph), x: 0, y: 0, z: 0, s: 1 }]

const SCENES: Record<string, () => Item[]> = {
  SURVIVAL: block('grass'),
  VANILLA: block('grass'),
  ONEBLOCK: block('grass'),
  ANARCHY: block('tnt'),
  TNTRUN: block('tnt'),
  BEDWARS: () => [c('bed_head', 0, 0, 0, 1, 0.56), c('bed_foot', 1, 0, 0, 1, 0.56)],
  SKYWARS: item('bow'),
  PVP: item('sword'),
  KITPVP: item('axe'),
  BOXPVP: item('shield'),
  MINIGAMES: item('trophy'),
  GRIEF: block('chest'),
  HUNGER_GAMES: block('chest'),
  SKYBLOCK: () => [c('grass', 0, 0, 0), c('log', 0.3, 1, 0.3, 0.4), c('leaves', 0.15, 1.4, 0.15, 0.7)],
  LIFESTEAL: item('heart'),
  PRISON: item('bars'),
  FACTIONS: item('flag'),
  MMORPG: item('potion'),
  ADVENTURE: item('map'),
  HARDCORE: block('head_skeleton'),
  HIDE_SEEK: block('head_enderman'),
  ROLEPLAY: block('head_villager'),
  RP: block('head_villager'),
  CREATIVE: () => [
    c('wool_red', 0, 0, 0, 0.5),
    c('wool_blue', 0.5, 0, 0, 0.5),
    c('wool_yellow', 0, 0, 0.5, 0.5),
    c('wool_lime', 0.5, 0, 0.5, 0.5),
    c('wool_purple', 0, 0.5, 0, 0.5),
    c('wool_orange', 0.5, 0.5, 0, 0.5),
    c('wool_cyan', 0, 0.5, 0.5, 0.5),
    c('wool_white', 0.5, 0.5, 0.5, 0.5),
  ],
  BUILD_BATTLE: block('bricks'),
  PARKOUR: item('boot'),
  LUCKY: block('lucky'),
  TECHNIC: block('furnace'),
  TECHNICAL: block('furnace'),
  MODDED: item('gear'),
  ECONOMY: block('emerald_block'),
  SPLEEF: item('shovel'),
  UHC: item('gapple'),
  TOWNY: block('bookshelf'),
}

const cache = new Map<string, { url: string; w: number; h: number }>()

/** Сцена режима data-URL в родном размере; неизвестный код — алмазный островок. */
export function modeScene(cat: string): { url: string; w: number; h: number } {
  const hit = cache.get(cat)
  if (hit) return hit
  const build = SCENES[cat] || block('diamond_ore')
  const r = renderScene(build())
  const out = { url: r.canvas.toDataURL('image/png'), w: r.w, h: r.h }
  cache.set(cat, out)
  return out
}
