export const ABONENT_SLUG = 'abonent'

const MEDIA = 'https://cdn.millida.trade/catalog/launcher-packs/abonent/page/'

export const clip = (name: string) => ({ video: MEDIA + name + '.mp4', poster: MEDIA + name + '.jpg' })

export const HERO = clip('hero')
export const TRAILER = clip('trailer')
export const ICONS = { coop: MEDIA + 'coop.png', own: MEDIA + 'own.png', sign: '/packs/abonent/abonent-tab.png' }

export const LINKS = {
  discord: 'https://discord.gg/EXp8vEEnVP',
  telegram: 'https://t.me/Arcania_news',
  youtube: 'https://www.youtube.com/@m0qen/featured',
}

export type Tile = { name: string; title: string }

export const LOBBY: Tile[] = [
  { name: 'lobby_billiard', title: 'Бильярд' },
  { name: 'lobby_hockey', title: 'Аэрохоккей' },
  { name: 'lobby_tir', title: 'Тир' },
  { name: 'lobby_chess', title: 'Шахматы' },
  { name: 'lobby_checkers', title: 'Шашки' },
  { name: 'lobby_domino', title: 'Домино' },
]

export const CHAPTER: Tile[] = [
  { name: 'ch1_flat', title: 'Квартира' },
  { name: 'ch1_stairs', title: 'Подъезд' },
  { name: 'ch1_torch', title: 'Фонарики' },
]

export const ROUTE: Tile[] = [
  { name: 'route_pripyat', title: 'Припять' },
  { name: 'route_medsan_walk', title: 'Медсанчасть' },
  { name: 'route_redforest', title: 'Рыжий лес' },
  { name: 'route_station', title: 'ЧАЭС' },
]

export const PERKS = ['Полный доступ к Абоненту', 'Кооператив и голосовой чат', 'Обновления сборки', 'Доступ в сообщество']

export const FAQ: { q: string; a: string; friends?: boolean }[] = [
  {
    q: 'Как поиграть с друзьями?',
    a: 'Играть можно от одного до четырёх, голосовой чат уже в игре. Напарника легко найти в нашем Discord: оставь карточку в канале «поиск-напарника» и выбери «Абонент».',
    friends: true,
  },
  { q: 'Как получить все сборки?', a: 'Оформите Премиум: он открывает Arcania, Абонент и Верити, когда она выйдет.' },
  { q: 'Как установить?', a: 'Через лаунчер Millida: найдите «Абонент» и введите ключ из кабинета.' },
]
