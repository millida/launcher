/*
 * Всё содержимое страницы Arcania 2.0 в одном месте: тексты, цвета, картинки.
 * Меняешь страницу — правишь здесь, секции только рисуют то, что тут написано.
 * Картинки лежат в public/packs/arcania (пока без бэкенда).
 */

export const ART = '/packs/arcania/'

export const HEAD = {
  title: 'ARCANIA',
  version: '2.0',
  released: 'вышла',
  lead: 'Единственная сборка с самописным сюжетом и уникальными боссами, которых нет больше нигде.',
}

/* ── ряд героев: семь карт — семь букв ARCANIA, «Начать играть» по центру ── */

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

/* ── что нового в 2.0: барабан слева, кадр справа ── */

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

/* ── сборка в числах ── */

export const STATS = [
  { label: 'модов', value: 280 },
  { label: 'боссов', value: 51 },
  { label: 'квестов', value: 1174 },
]

/* ── боссы ── */

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

/** Плитки мозаики «Новые боссы» — последняя ещё и «+N боссов ждут в игре». */
export const MOSAIC = ['hanashiguro', 'malora', 'knight', 'yeti', 'frost', 'basalt', 'quindris', 'huntress', 'minotaur', 'slime', 'bigpig']

export function bossesLeft(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? 'босс' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'босса' : 'боссов'
  return `Это далеко не все — в игре ещё ${n} ${word}`
}
