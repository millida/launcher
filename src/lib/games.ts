import { create } from 'zustand'

/*
 * Игры Minecraft в библиотеке (владелец 29.09.2026: «добавь все майнкрафт-игры»).
 * Названия и слоганы — с minecraft.net/ru-ru, даты и номера магазинов —
 * Steam API и каталог Microsoft Store (разбор 29.09.2026,
 * Работа/Проекты/millida/cache/2026-09/mc-games/<игра>/manifest.json).
 * Картинки — официальные постеры и арт из Microsoft Store.
 *
 * Как запускаем:
 * - legends — копия игрока в Steam или Microsoft Store (engine/games);
 * - education — официальный установщик Microsoft (aka.ms/downloadmee-desktopApp).
 * Обычный Minecraft здесь не стоит: это сам лаунчер (владелец 29.09.2026).
 */
export type GameSlug = 'legends' | 'education' | 'bedrock'

export type GameRun = 'store'

export interface GameInfo {
  slug: GameSlug
  name: string
  tagline: string
  /** ДД.ММ.ГГГГ */
  released: string
  run: GameRun
  isNew?: boolean
  /** Что считается модом у этой игры; null — модов нет. */
  mods: string | null
  /** Строка под названием на карточке библиотеки. */
  meta: string
  steam: boolean
  store: boolean
  /** Скрыта из библиотеки; файлы и установка у игроков остаются. */
  hidden?: boolean
}

const ALL_GAMES: GameInfo[] = [
  {
    // Bedrock — отдельной игрой в «Других играх» (владелец 29.09.2026, вместо
    // переключателя Java | Bedrock). С 2022 года Java и Bedrock продаются
    // вместе; файлы Bedrock зашифрованы под лицензию — играем своей копией.
    slug: 'bedrock',
    name: 'Minecraft Bedrock',
    tagline: 'Та же игра, что на телефоне и консоли',
    // Better Together: с этого обновления издание называется Bedrock.
    released: '20.09.2017',
    run: 'store',
    meta: 'Серверы в один клик',
    mods: 'Аддоны',
    steam: false,
    store: true,
  },
  {
    slug: 'legends',
    name: 'Minecraft Legends',
    tagline: 'Экшн-стратегия: защити Верхний мир',
    released: '18.04.2023',
    run: 'store',
    meta: 'Экшн-стратегия',
    mods: 'Паки Mojang',
    steam: true,
    store: true,
  },
  {
    slug: 'education',
    name: 'Minecraft Education',
    tagline: 'Для школы и дома',
    released: '01.11.2016',
    run: 'store',
    meta: 'Для школы и дома',
    mods: null,
    steam: false,
    store: true,
  },
]

export const GAMES: GameInfo[] = ALL_GAMES.filter((g) => !g.hidden)

export const gamePoster = (slug: GameSlug) => '/games/' + slug + '/poster.jpg'
export const gameHero = (slug: GameSlug) => '/games/' + slug + '/hero.jpg'
/*
 * «Купить» ведёт в Blups: Steam и Microsoft не продают эти игры в России,
 * а Blups продаёт пополнение Xbox и Game Pass (59 товаров от 63 ₽, blups.me/game/xbox,
 * 29.09.2026). Карта пополняет кошелёк Microsoft — игру покупают в Store
 * на свой аккаунт, и дальше лаунчер ставит её официально.
 */
export const gameBuyUrl = (slug: GameSlug) =>
  'https://blups.me/game/xbox?utm_source=millida_launcher&utm_medium=game&utm_campaign=' + slug
export const gameSite = (slug: GameSlug) => 'https://millida.net/games/' + slug + '?utm_source=launcher&utm_medium=game'

export const useGame = create<{ slug: GameSlug; open: (slug: GameSlug) => void }>((set) => ({
  slug: 'bedrock',
  open: (slug) => set({ slug }),
}))
