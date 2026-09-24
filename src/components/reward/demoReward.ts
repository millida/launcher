/**
 * ТОЛЬКО DEV: `window.__testReward(kind)` — показать миг награды без покупки.
 *   big (по умолчанию) — одна эпическая вещь; fan — набор из 5; legend — легендарная;
 *   plus — праздник PLUS; server — свой сервер; rubies — рубины;
 *   mid — сохранён образ; friend — новый друг; small — надет образ.
 * Грузится динамически из RewardHost под import.meta.env.DEV.
 */
import { showReward, type RewardCall } from './rewardBus'

const cdn = (file: string) => 'https://cdn.millida.net/cosmetics/previews/' + file

const CAT = {
  name: 'Кот-геймер',
  rarity: 'EPIC',
  preview: cdn('GAMER_CAT.dfdd17d0d4.png'),
}
const WINGS = {
  name: 'Смешанные огненные крылья',
  rarity: 'LEGENDARY',
  preview: cdn('MIXED_FIRE_WINGS_REMASTER.48c50f24e6.png'),
}
const HALO = {
  name: 'Сердечный нимб',
  rarity: 'RARE',
  preview: cdn('HEART_HALO.ab5e76b913.png'),
}
const CROWN = {
  name: 'Большая корона',
  rarity: 'RARE',
  preview: cdn('KING_CROWN.5d97038503.png'),
}
const FOX = {
  name: 'Лисёнок',
  rarity: 'EPIC',
  preview: cdn('FOX.5ee0ddc710.png'),
}
const WOLF = {
  name: 'Волчонок',
  rarity: 'UNCOMMON',
  preview: cdn('BABY_WOLF.47ffc56986.png'),
}

const DEMO: Record<string, RewardCall> = {
  big: { items: [CAT], onWear: () => {} },
  legend: { items: [WINGS], onWear: () => {} },
  fan: {
    items: [HALO, FOX, WINGS, CROWN, WOLF],
    title: 'Набор твой',
    sub: '5 вещей навсегда',
  },
  plus: {
    items: [{ name: 'PLUS', icon: 'crown' }],
    tone: 'var(--m-rarity-legendary)',
    kicker: 'Подписка',
    title: 'PLUS открыт',
    sub: 'Вторая строка наград — твоя',
  },
  server: {
    items: [{ name: 'Сервер', icon: 'server' }],
    kicker: 'Свой сервер',
    title: 'Сервер создаётся',
    sub: 'Появится в списке через минуту',
  },
  rubies: {
    level: 'mid',
    items: [{ name: 'Рубины', rubies: 1200 }],
    title: 'Начислено',
    sub: '1 200 рубинов',
  },
  mid: {
    level: 'mid',
    items: [{ name: 'Образ', icon: 'looks' }],
    title: 'Образ сохранён',
    sub: '«Вечерний»',
  },
  friend: {
    level: 'mid',
    items: [{ name: 'Друг', icon: 'users' }],
    kicker: 'Новый друг',
    title: 'Steve_2011',
    sub: 'Теперь в друзьях',
  },
  small: {
    level: 'small',
    items: [{ name: 'Образ', icon: 'shirt' }],
    title: '«Вечерний» надет',
  },
}

export function installRewardDemo() {
  ;(window as unknown as { __testReward?: (k?: string) => number }).__testReward = (k = 'big') =>
    showReward(DEMO[k] || DEMO.big)
}
