import type { Vars } from '../../i18n'
import { plural } from '../../lib/format'
import { MEDIA_WAIT, mediaUrl } from '../../lib/media'

// Page texts are Russian i18n keys: every place that shows them passes them through t().
export const ART = '/packs/arcania/'
export const ARCANIA_POSTER = ART + 'cover-poster.webp'

/** Остаётся в установщике: постеры нужны до того, как что-то скачается, шрифт и логотип — на каждой странице. */
const KEPT = new Set(['cover-poster.webp', 'guide-poster.jpg', 'skill-tree-poster.jpg', 'logo.png', 'cast.woff2'])

/** Имя пакета картинок в media/manifest.json: боссы, классы, карта мира. Ядро качает его целиком, одним файлом. */
export const ART_BUNDLE = '@arcania-art'

/**
 * Адрес картинки Arcania. Постеры лежат в установщике, остальное приходит из кэша медиа; пока пакет не скачан —
 * прозрачная заглушка (серая плитка по стилю 05-media.css), и компонент перерисуется, когда файлы лягут.
 * Компонент, который зовёт art(), вызывает useArcaniaArt().
 */
export const art = (file: string): string => (KEPT.has(file) ? ART + file : (mediaUrl('packs/arcania/' + file) ?? MEDIA_WAIT))

/** Имя ролика в кэше медиа. */
export const artClip = (file: string): string => 'packs/arcania/' + file

export const ARCANIA_VERSION = '2.0'

export const HEAD = {
  title: 'ARCANIA',
  version: ARCANIA_VERSION,
  lead: 'Единственная сборка с самописным сюжетом и уникальными боссами, которых нет больше нигде.',
}

export type ClassCard = { id: string; letter: string; role: string; color: string; height: string }
export type PlayCard = { play: true; letter: string }

export const CAST: (ClassCard | PlayCard)[] = [
  { id: 'paladin', letter: 'A', role: 'паладином', color: '#ffd060', height: '50%' },
  { id: 'archer', letter: 'R', role: 'лучником', color: '#60e070', height: '54%' },
  { id: 'warrior', letter: 'C', role: 'воином', color: '#ff3040', height: '78%' },
  { play: true, letter: 'A' },
  { id: 'assassin', letter: 'N', role: 'ассасином', color: '#9aa6b8', height: '54%' },
  { id: 'support', letter: 'I', role: 'поддержкой', color: '#ffaa33', height: '62%' },
  { id: 'watcher', letter: 'A', role: 'стражем', color: '#a060ff', height: '54%' },
]

export type News =
  | { title: string; text: string; mosaic: true; ms: number }
  | { title: string; text: string; image: string; ms: number }
  | { title: string; text: string; video: string; poster: string; ms: number }
  | { title: string; text: string; lineup: true; ms: number }

export const NEWS: News[] = [
  { title: 'Новые боссы', text: 'Самописные боссы со своими атаками и фазами боя.', mosaic: true, ms: 4200 },
  { title: '30+ глав квестов', text: 'Книга квестов ведёт от первых шагов до магии, технологий и новых миров.', image: 'quests.webp', ms: 2200 },
  { title: 'Книга знаний', text: 'Гайд прямо в игре: управление, задания и всё, что нужно новичку.', video: 'guide.mp4', poster: 'guide-poster.jpg', ms: 8800 },
  { title: 'Классы и навыки', text: 'Переработанное древо навыков для каждого класса.', video: 'skill-tree.mp4', poster: 'skill-tree-poster.jpg', ms: 14500 },
  { title: 'Игра с друзьями', text: 'Собери группу прямо в игре и проходите сюжет вместе.', image: 'group.webp', ms: 2200 },
  { title: 'Графика и 3D', text: 'Уникальная система пресетов графики и уникальная система 3D.', image: 'graphics.webp', ms: 2200 },
]

export const STATS = [
  { label: 'модов', value: 280 },
  { label: 'боссов', value: 51 },
  { label: 'квестов', value: 1174 },
]

export const TOTAL_BOSSES = 51

export const BOSSES = [
  { id: 'hanashiguro', name: 'Ханасигуро', color: '#ffb23a' },
  { id: 'malora', name: 'Малора', color: '#62c8ff' },
  { id: 'knight', name: 'Тёмный рыцарь', color: '#ff4a5c' },
  { id: 'quindris', name: 'Магус Квиндрис', color: '#b67bff' },
  { id: 'yeti', name: 'Йети', color: '#8ff0ff' },
  { id: 'slime', name: 'Кубослайм', color: '#7ee05a' },
  { id: 'bigpig', name: 'Бигпиг', color: '#ffa27a' },
  { id: 'minotaur', name: 'Минотавр', color: '#e8b25c' },
  { id: 'basalt', name: 'Базальтовый страж', color: '#ff7a2a' },
]

export const MOSAIC = ['hanashiguro', 'malora', 'knight', 'yeti', 'frost', 'basalt', 'quindris', 'huntress', 'minotaur', 'slime', 'bigpig']

export function bossesLeft(n: number, t: (key: string, vars?: Vars) => string): string {
  return plural(
    n,
    t('Это далеко не все — в игре ещё {n} босс', { n }),
    t('Это далеко не все — в игре ещё {n} босса', { n }),
    t('Это далеко не все — в игре ещё {n} боссов', { n }),
  )
}
