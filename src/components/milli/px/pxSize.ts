/**
 * Выбор размера сборки (≈25 · ≈70 · ≈150 · ≈250 модов): сундук → большой сундук →
 * сундук Края → ящик шалкера. Вид спереди в три четверти (крышка сверху видна):
 * в 12–16 px он читается лучше изометрии. Формат — pxTypes.ts.
 */
import type { PxSprite } from './pxTypes'

/** Сундук, лицевая сторона 12 клеток: крышка, шов, железная защёлка. */
const CHEST_ROWS = [
  '................',
  '................',
  '................',
  '..oooooooooooo..',
  '..oHHHHHHHHHho..',
  '..ohhhhhhhhhdo..',
  '..okkkkkkkkkko..',
  '..oWwwwwwwwwdo..',
  '..oWwwwoowwwdo..',
  '..oWwwoLlowwdo..',
  '..okkkoLlokkko..',
  '..oWwwwoowwwdo..',
  '..oWwwwwwwwwdo..',
  '..oddddddddddo..',
  '..oooooooooooo..',
  '................',
]

const OAK = {
  o: '#2b1606', H: '#d9a05a', h: '#b8803e', k: '#3e2410', W: '#a8702f', w: '#8f5c26', d: '#66401a',
  L: '#f0f0ea', l: '#9c9ca4',
}

/** Сундук — «≈25 модов». */
const CHEST: PxSprite = { pal: OAK, rows: CHEST_ROWS }

/** Большой сундук — «≈70»: на всю ширину, защёлка посередине, стык двух половин на крышке. */
const CHEST_LARGE: PxSprite = {
  pal: OAK,
  rows: [
    '................',
    '................',
    '................',
    'oooooooooooooooo',
    'oHHHHHHhHHHHHHho',
    'ohhhhhhdhhhhhhdo',
    'okkkkkkkkkkkkkko',
    'oWwwwwwwwwwwwwdo',
    'oWwwwwwoowwwwwdo',
    'oWwwwwoLlowwwwdo',
    'okkkkkoLlokkkkko',
    'oWwwwwwoowwwwwdo',
    'oWwwwwwwwwwwwwdo',
    'oddddddddddddddo',
    'oooooooooooooooo',
    '................',
  ],
}

/** Сундук Края — «≈150»: обсидиан, вместо защёлки — бирюзовый глаз Края. */
const ENDER_CHEST: PxSprite = {
  rows: [
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '..oHHHHgHHHHho..',
    '..ohhhhhhhhhdo..',
    '..okkkkkkkkkko..',
    '..oWwwwwwwwgdo..',
    '..oWwwwoowwwdo..',
    '..oWwwoLlowwdo..',
    '..okkkoEeokkko..',
    '..oWgwwoowwwdo..',
    '..oWwwwwwwwwdo..',
    '..oddddddddddo..',
    '..oooooooooooo..',
    '................',
  ],
  pal: {
    o: '#05080a', H: '#6a9294', h: '#4a6e70', k: '#142224', W: '#3a5a5c', w: '#2e4a4c', d: '#1e3436',
    L: '#d6fff0', l: '#3fd6a0', E: '#1f8f6a', e: '#0f4f3a', g: '#5fe0b4',
  },
}

/** Ящик шалкера — «≈250»: фиолетовая крышка с кромкой поверх основания. */
const SHULKER_BOX: PxSprite = {
  pal: {
    o: '#24102e', H: '#d6a8e6', h: '#b585c8', k: '#3e1f4e', W: '#a06ab5', w: '#8a56a0', d: '#653a7c',
    b: '#7a4890', B: '#5a3070',
  },
  rows: [
    '................',
    '................',
    '.oooooooooooooo.',
    '.oHHHHHHHHHHHho.',
    '.ohhhhhhhhhhhdo.',
    '.okkkkkkkkkkkko.',
    '.oWWwwwwwwwwwdo.',
    '.oWwwwwwwwwwwdo.',
    '.oWwwwwwwwwwwdo.',
    '.oWwwwwwwwwwwdo.',
    '.oddddddddddddo.',
    '.okkkkkkkkkkkko.',
    '..obbbbbbbbbBo..',
    '..obbbbbbbbbBo..',
    '..oBBBBBBBBBBo..',
    '..oooooooooooo..',
  ],
}

export const PX_SIZE = {
  chest: CHEST,
  chest_large: CHEST_LARGE,
  ender_chest: ENDER_CHEST,
  shulker_box: SHULKER_BOX,
} satisfies Record<string, PxSprite>
