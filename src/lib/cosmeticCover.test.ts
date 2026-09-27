import { expect, test } from 'bun:test'
import type { Object3D } from 'three'
import {
  chosenSide,
  cutSkin,
  hiddenBones,
  hiddenJoints,
  hidesRegularCape,
  maskUrls,
  pieceCover,
  type CoverBone,
  type CoverItem,
  type Pixels,
} from './cosmeticCover'
import { buildCosmetic } from './cosmeticModel'

;(globalThis as { document?: unknown }).document ??= {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(_: string) {} }),
}

const ONESIE: CoverItem = { id: 'FOX_ONESIE', slot: 'SUIT' }
const HALO: CoverItem = { id: 'ANGEL_HALO', slot: 'HAT', hides: { FOX_ONESIE: ['head'], AFRO: ['head'] } }
const HALO_RED: CoverItem = { ...HALO, id: 'ANGEL_HALO~red', baseId: 'ANGEL_HALO' }
const ONESIE_RED: CoverItem = { ...ONESIE, id: 'FOX_ONESIE~red', baseId: 'FOX_ONESIE' }
const WINGS: CoverItem = { id: 'ANGEL_WINGS', slot: 'WINGS' }
const GLASSES: CoverItem = { id: 'GLASSES', slot: 'FACE', hides: { FOX_ONESIE: { Head: true, tail: false } } }

const bonesTable: { why: string; outfit: CoverItem[]; item: CoverItem; hidden: string[] }[] = [
  {
    why: 'кигуруми + нимб: в игре нимб прячет капюшон кигуруми, превью обязано так же',
    outfit: [ONESIE, HALO],
    item: ONESIE,
    hidden: ['head'],
  },
  { why: 'кигуруми одно: прятать капюшон некому', outfit: [ONESIE], item: ONESIE, hidden: [] },
  { why: 'крылья и нимб друг про друга ничего не пишут', outfit: [WINGS, HALO], item: WINGS, hidden: [] },
  { why: 'правило не про саму вещь: нимб себя не прячет', outfit: [ONESIE, HALO], item: HALO, hidden: [] },
  {
    why: 'расцветки - отдельные карточки, а правило записано на код вещи',
    outfit: [ONESIE_RED, HALO_RED],
    item: ONESIE_RED,
    hidden: ['head'],
  },
  {
    why: 'правило объектом { кость: true } читается, как в CosmeticCodec; false не прячет',
    outfit: [ONESIE, GLASSES],
    item: ONESIE,
    hidden: ['head'],
  },
]

for (const row of bonesTable) {
  test('кости: ' + row.why, () => {
    expect([...hiddenBones(row.outfit, row.item)].sort(), row.why).toEqual(row.hidden)
  })
}

const RIG: CoverBone[] = [
  { name: 'body', parent: -1 },
  { name: 'Head', parent: 0 },
  { name: 'ears', parent: 1 },
  { name: 'tail', parent: 0 },
]

const jointTable: { why: string; bones: CoverBone[]; cover: Parameters<typeof hiddenJoints>[1]; hidden: boolean[] }[] = [
  {
    why: 'имя кости сравнивается без регистра, дети спрятанной кости уходят с ней (MeshPose.bake)',
    bones: RIG,
    cover: { bones: new Set(['head']) },
    hidden: [false, true, true, false],
  },
  { why: 'без правил видно всё', bones: RIG, cover: undefined, hidden: [false, false, false, false] },
  {
    why: 'вещь на одну руку: остаётся сторона каталога, вторая половина прячется (CosmeticSide)',
    bones: [
      { name: 'root', parent: -1 },
      { name: 'l', parent: 0, side: 'left' },
      { name: 'r', parent: 0, side: 'right' },
      { name: 'r_tip', parent: 2 },
    ],
    cover: { bones: new Set(), side: 'RIGHT' },
    hidden: [false, true, false, false],
  },
  {
    why: 'сторона не задана: левая впереди правой, как ORDER в моде',
    bones: [
      { name: 'r', parent: -1, side: 'right' },
      { name: 'l', parent: -1, side: 'left' },
    ],
    cover: { bones: new Set() },
    hidden: [true, false],
  },
]

for (const row of jointTable) {
  test('узлы: ' + row.why, () => {
    expect(hiddenJoints(row.bones, row.cover), row.why).toEqual(row.hidden)
  })
}

test('сторона: выбор игрока, потом каталога, потом порядок left/right/front/back', () => {
  const both = new Set(['left', 'right'])
  expect(chosenSide(both, 'right', 'left'), 'выбор игрока главнее каталога').toBe('right')
  expect(chosenSide(both, undefined, 'Right'), 'каталог главнее порядка').toBe('right')
  expect(chosenSide(new Set(['back', 'front']), undefined, 'left'), 'нет такой стороны - по порядку').toBe('front')
  expect(chosenSide(new Set(), 'left'), 'сторон у модели нет - выбирать не из чего').toBeUndefined()
})

const maskTable: { why: string; outfit: CoverItem[]; slim: boolean; emote?: CoverItem; urls: string[] }[] = [
  {
    why: 'маска под модель рук игрока',
    outfit: [{ id: 'A', slot: 'SUIT', masks: { steve: 's.png', alex: 'a.png' } }],
    slim: true,
    urls: ['a.png'],
  },
  {
    why: 'маска стороны вещи главнее общей',
    outfit: [{ id: 'A', slot: 'ARM', side: 'left', masks: { steve: 's.png', 'steve.left': 'sl.png' } }],
    slim: false,
    urls: ['sl.png'],
  },
  {
    why: 'нет маски своей модели - берётся чужая, как в CosmeticItem.maskUrl',
    outfit: [{ id: 'A', slot: 'SUIT', masks: { 'alex.right': 'ar.png' } }],
    slim: false,
    urls: ['ar.png'],
  },
  {
    why: 'надетая эмоция режет скин только пока играет',
    outfit: [{ id: 'E', slot: 'EMOTE', masks: { steve: 'e.png' } }],
    slim: false,
    urls: [],
  },
  {
    why: 'играющая эмоция добавляет свою маску',
    outfit: [],
    slim: false,
    emote: { id: 'E', slot: 'EMOTE', masks: { steve: 'e.png' } },
    urls: ['e.png'],
  },
]

for (const row of maskTable) {
  test('маски: ' + row.why, () => {
    expect(maskUrls(row.outfit, row.slim, row.emote), row.why).toEqual(row.urls)
  })
}

test('плащ-косметика прячет обычный плащ (CapeRule), шляпа - нет', () => {
  expect(hidesRegularCape([HALO, { id: 'C', slot: 'CAPE' }]), 'плащ-вещь и плащ аккаунта рисуются друг сквозь друга').toBe(true)
  expect(hidesRegularCape([HALO]), 'без плаща-вещи плащ аккаунта виден').toBe(false)
})

const picture = (width: number, height: number, fill: [number, number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < data.length; at += 4) data.set(fill, at)
  return { data, width, height }
}

const paint = (image: Pixels, rect: [number, number, number, number], rgba: [number, number, number, number]) => {
  for (let y = rect[1]; y < rect[3]; y += 1) {
    for (let x = rect[0]; x < rect[2]; x += 1) image.data.set(rgba, (y * image.width + x) * 4)
  }
}

const alpha = (image: Pixels, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]

test('скин: чёрный пиксель маски вырезает кожу, белый оставляет', () => {
  const skin = picture(64, 64, [200, 150, 100, 255])
  const mask = picture(64, 64, [255, 255, 255, 255])
  paint(mask, [44, 20, 45, 21], [0, 0, 0, 255])
  expect(cutSkin(skin, [mask], false), 'маска что-то закрывает - скин меняется').toBe(true)
  expect(alpha(skin, 44, 20), 'пиксель под чёрным вырезан').toBe(0)
  expect(alpha(skin, 45, 20), 'сосед под белым остался').toBe(255)
})

test('скин: часть, закрытая на 95%, прячется целиком вместе со своим вторым слоем', () => {
  const skin = picture(64, 64, [200, 150, 100, 255])
  const mask = picture(64, 64, [255, 255, 255, 255])
  paint(mask, [8, 0, 24, 8], [0, 0, 0, 255])
  paint(mask, [0, 8, 32, 16], [0, 0, 0, 255])
  mask.data.set([255, 255, 255, 255], (8 * 64 + 0) * 4)
  cutSkin(skin, [mask], false)
  expect(alpha(skin, 0, 8), 'пиксель головы, оставленный маской, всё равно прячется: голова закрыта целиком').toBe(0)
  expect(alpha(skin, 40, 8), 'шапка висит под головой и уходит вместе с ней').toBe(0)
  expect(alpha(skin, 20, 20), 'тело не тронуто').toBe(255)
})

test('скин: белая маска ничего не меняет', () => {
  const skin = picture(64, 64, [200, 150, 100, 255])
  expect(cutSkin(skin, [picture(64, 64, [255, 255, 255, 255])], false), 'пустая маска - тот же скин').toBe(false)
})

const ONESIE_MODEL = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.fox_onesie', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [0, 0] }] },
        { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 16] }] },
      ],
    },
  ],
}

const joint = (pieces: { object: Object3D }[], name: string) => {
  let found: Object3D | undefined
  for (const piece of pieces) piece.object.traverse((node) => (node.name === name ? (found = node) : undefined))
  return found
}

test('на фигуре: нимб прячет капюшон кигуруми, без нимба капюшон виден', () => {
  const withHalo = buildCosmetic(ONESIE_MODEL, 'x.png', 'SUIT', undefined, undefined, undefined, pieceCover([ONESIE, HALO], ONESIE))
  expect(joint(withHalo, 'head')?.visible, 'капюшон сквозь нимб - превью врёт о том, что будет в игре').toBe(false)
  expect(joint(withHalo, 'body')?.visible, 'тело кигуруми нимб не трогает').toBe(true)
  const alone = buildCosmetic(ONESIE_MODEL, 'x.png', 'SUIT', undefined, undefined, undefined, pieceCover([ONESIE], ONESIE))
  expect(joint(alone, 'head')?.visible, 'кигуруми одно - капюшон на месте').toBe(true)
})
