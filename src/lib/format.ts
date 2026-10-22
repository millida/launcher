import type { Profile } from '../ipc/commands'
import { formatFixed, formatRelative, intlTag, pluralForm, t } from '../i18n'

export const fmt = (n: number): string =>
  n >= 1e6
    ? t('{n} млн', { n: formatFixed(n / 1e6, 1) })
    : n >= 1e3
      ? t('{n} тыс', { n: (n / 1e3).toFixed(0) })
      : String(n)

export const fmtN = (n: number): string => Number(n || 0).toLocaleString(intlTag())

const LOADER_NAMES: Record<string, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

export const loaderId = (p?: Profile | null): string =>
  (p && (p.loader || (p.fabric ? 'fabric' : 'vanilla'))) || 'vanilla'

export const LOADER_NAME = (p?: Profile | null): string => LOADER_NAMES[loaderId(p)] || t('Ванилла')

const ruMap = (): Record<string, string> => ({
  fabric: 'Fabric',
  forge: 'Forge',
  quilt: 'Quilt',
  neoforge: 'NeoForge',
  optimization: t('Оптимизация'),
  adventure: t('Приключения'),
  technology: t('Технологии'),
  magic: t('Магия'),
  library: t('Библиотека'),
  utility: t('Утилиты'),
  decoration: t('Декор'),
  worldgen: t('Генерация мира'),
  equipment: t('Снаряжение'),
  food: t('Еда'),
  storage: t('Хранилища'),
  multiplayer: t('Мультиплеер'),
  social: t('Социальное'),
  challenging: t('Хардкор'),
  'kitchen-sink': t('Всё сразу'),
  lightweight: t('Лёгкий'),
  combat: t('Бой'),
  mobs: t('Мобы'),
  cursed: t('Странное'),
  economy: t('Экономика'),
  'game-mechanics': t('Механики игры'),
  management: t('Менеджмент'),
  minigame: t('Мини-игры'),
  quests: t('Квесты'),
  transportation: t('Транспорт'),
  audio: t('Звук'),
  blocks: t('Блоки'),
  'core-shaders': t('Ядровые шейдеры'),
  entities: t('Сущности'),
  environment: t('Окружение'),
  fonts: t('Шрифты'),
  gui: t('Интерфейс'),
  items: t('Предметы'),
  locale: t('Локализация'),
  modded: t('Для модов'),
  models: t('Модели'),
  realistic: t('Реалистичные'),
  simplistic: t('Минималистичные'),
  themed: t('Тематические'),
  tweaks: t('Мелкие правки'),
  'vanilla-like': t('Как ванилла'),
  atmosphere: t('Атмосфера'),
  bloom: t('Свечение'),
  cartoon: t('Мультяшные'),
  'colored-lighting': t('Цветной свет'),
  fantasy: t('Фэнтези'),
  foliage: t('Листва'),
  low: t('Низкие требования'),
  medium: t('Средние требования'),
  high: t('Высокие требования'),
  screenshot: t('Для скриншотов'),
  'path-tracing': t('Трассировка пути'),
  pbr: t('PBR-материалы'),
  reflections: t('Отражения'),
  'semi-realistic': t('Полуреалистичные'),
  shadows: t('Тени'),
  potato: t('Для слабых ПК'),
  vanilla: t('Ванилла'),
  datapack: t('Дата-пак'),
  iris: 'Iris',
  optifine: 'OptiFine',
  canvas: 'Canvas',
  paper: 'Paper',
  spigot: 'Spigot',
  purpur: 'Purpur',
  miscellaneous: t('Разное'),
  'mc-miscellaneous': t('Разное'),
  general: t('Разное'),
  survival: t('Выживание'),
  exploration: t('Исследование'),
  'adventure-and-rpg': t('Приключения и RPG'),
  'adventure-rpg': t('Приключения и RPG'),
  'role-playing': t('Ролевая игра'),
  roleplay: t('Ролевая игра'),
  'utility-qol': t('Удобство'),
  pvp: 'PvP',
  'combat-pvp': t('Бой и PvP'),
  cosmetic: t('Косметика'),
  fun: t('Развлечения'),
  tech: t('Технологии'),
  'admin-tools': t('Для админов'),
  'server-utility': t('Для сервера'),
  'anti-griefing-tools': t('Защита от гриферов'),
  'developer-tools': t('Для разработчиков'),
  'armor-weapons-tools': t('Броня и оружие'),
  'armor-tools-and-weapons': t('Броня и оружие'),
  creation: t('Творчество'),
  'data-packs': t('Дата-пак'),
  'mod-support': t('Поддержка модов'),
  mechanics: t('Механики игры'),
  'game-map': t('Карта'),
  'map-based': t('Карта'),
  'map-information': t('Карта и подсказки'),
  informational: t('Подсказки'),
  'world-mobs': t('Мобы'),
  'mc-food': t('Еда'),
  'library-api': t('Библиотека'),
  'small-light': t('Лёгкий'),
  'world-gen': t('Генерация мира'),
  'world-structures': t('Постройки'),
  'world-ores-resources': t('Руды и ресурсы'),
  'world-biomes': t('Биомы'),
  'world-dimensions': t('Измерения'),
  'world-editing-and-management': t('Редактирование мира'),
  'custom-terrain': t('Свой рельеф'),
  'modded-world': t('Мир с модами'),
  shaders: t('Шейдеры'),
  traditional: t('Классические'),
  puzzle: t('Головоломки'),
  players: t('Игроки'),
  horror: t('Хоррор'),
  parkour: t('Паркур'),
  hardcore: t('Хардкор'),
  'chat-related': t('Чат'),
  'extra-large': t('Большие'),
  teleportation: t('Телепортация'),
  medieval: t('Средневековье'),
  modern: t('Современность'),
  animated: t('Анимация'),
  skyblock: t('Скайблок'),
  performance: t('Производительность'),
  fixes: t('Исправления'),
  redstone: t('Редстоун'),
  'technology-farming': t('Фермы'),
  'technology-automation': t('Автоматизация'),
  'technology-processing': t('Переработка'),
  'technology-player-transport': t('Транспорт'),
  'technology-item-fluid-energy-tra': t('Передача ресурсов'),
  'sixteen-x': '16x',
  x16: '16x',
  x32: '32x',
  x64: '64x',
  x128: '128x',
})

export const RU_LOADER = (c: string): string => ruMap()[c] || c

export const ruLabel = (c: string): string | null => {
  const map = ruMap()
  return Object.prototype.hasOwnProperty.call(map, c) ? map[c]! : null
}

/// Длина текста, который пишет сам игрок. Ограничение стоит и на поле ввода, и
/// на месте показа: поле бережёт данные, показ — вёрстку, потому что то же имя
/// приходит и из чужой сборки, и из файла, набранного мимо лаунчера.
export const BUILD_NAME_MAX = 40
export const GROUP_NAME_MAX = 24
export const TOAST_TEXT_MAX = 220

/// Обрезка по границе символа с многоточием. Одна на весь интерфейс: две
/// разъедутся, и одно и то же имя окажется обрезано по-разному в двух местах.
export function clipText(text: string, max: number): string {
  const value = String(text ?? '')
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return chars.slice(0, Math.max(1, max - 1)).join('').trimEnd() + '…'
}

/// Catalogue values arrive lower-cased from the APIs ("fabric", "любая"); only
/// the first letter is touched so "NeoForge" and "1.21.4" stay as they are.
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

export const accKindLabel = (k?: string): string =>
  k === 'microsoft'
    ? t('Лицензия Microsoft')
    : k === 'tg' || k === 'millida'
      ? t('Аккаунт Millida')
      : k === 'offline'
        ? t('Офлайн-ник')
        : t('Гость')

export function monogramAvatar(nick: string | undefined, size = 40): string {
  const name = (nick || '?').trim() || '?'
  const letter = name[0].toUpperCase()
  // Golden-angle hue steps keep adjacent nicknames visually distinct.
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100003
  const hue = (hash * 137) % 360
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">' +
    '<rect width="' + size + '" height="' + size + '" rx="' + Math.round(size / 5) + '" fill="hsl(' + hue + ',38%,36%)"/>' +
    '<text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" ' +
    'font-size="' + Math.round(size * 0.46) + '" font-weight="700">' +
    letter.replace(/[<>&]/g, '') +
    '</text></svg>'
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export function onAvatarError(e: { currentTarget: HTMLImageElement }, size = 32, nick?: string): void {
  const img = e.currentTarget
  if (img.dataset.fb) return
  const tries = Number(img.dataset.try || '0')
  if (tries < 1 && !img.src.startsWith('data:')) {
    img.dataset.try = String(tries + 1)
    // Retry with a marker param: the plain URL would be served from the browser error cache.
    const url = img.src.replace(/([?&])mr=\d+/, '$1').replace(/[?&]$/, '')
    const retry = url + (url.includes('?') ? '&' : '?') + 'mr=' + (tries + 1)
    setTimeout(() => {
      img.src = retry
    }, 700)
    return
  }
  img.dataset.fb = '1'
  img.src = monogramAvatar(nick || img.dataset.nick || img.alt, size)
}

export const plural = (n: number, one: string, few: string, many: string): string => pluralForm(n, one, few, many)

export const fmtPlaytime = (seconds?: number): string => {
  const s = Math.max(0, Math.round(seconds || 0))
  if (s < 60) return t('меньше минуты')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (!h) return t('{m} мин', { m })
  return h >= 100 ? t('{h} ч', { h }) : t('{h} ч {m} м', { h, m })
}

export const whenText = (tsSeconds?: number): string =>
  tsSeconds ? formatRelative(tsSeconds * 1000, { floor: 'day' }) : ''

export const agoText = (ts?: number): string => (ts ? formatRelative(ts * 1000, { style: 'short' }) : '')

export interface MotdPart {
  text: string
  color: string
  bold: boolean
}

const MC_COLORS: Record<string, string> = {
  '0': '#000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555',
  '9': '#5555FF',
  a: '#55FF55',
  b: '#55FFFF',
  c: '#FF5555',
  d: '#FF55FF',
  e: '#FFFF55',
  f: '#FFF',
}

export function motdParts(m?: string): MotdPart[] {
  if (!m) return []
  const out: MotdPart[] = []
  let color = '#7ED96F'
  let bold = false
  let i = 0
  let buf = ''
  const flush = (t: string) => {
    if (t) out.push({ text: t, color, bold })
  }
  while (i < m.length) {
    const ch = m[i]
    if (ch === '§' && i + 1 < m.length) {
      flush(buf)
      buf = ''
      const c = m[i + 1].toLowerCase()
      if (c === 'x' && i + 13 <= m.length) {
        let hex = ''
        for (let k = 0; k < 6; k++) hex += m[i + 3 + k * 2] || ''
        if (/^[0-9a-f]{6}$/i.test(hex)) {
          color = '#' + hex
          i += 14
          continue
        }
        i += 2
        continue
      }
      if (c === '#') {
        const hex = m.substr(i + 2, 6)
        if (/^[0-9a-f]{6}$/i.test(hex)) {
          color = '#' + hex
          i += 8
          continue
        }
      }
      if (MC_COLORS[c]) {
        color = MC_COLORS[c]
        bold = false
      } else if (c === 'l') bold = true
      else if (c === 'r') {
        color = '#7ED96F'
        bold = false
      }
      i += 2
      continue
    }
    buf += ch
    i++
  }
  flush(buf)
  return out
}

export const fmtSize = (bytes?: number): string => {
  const b = bytes || 0
  if (!b) return ''
  if (b < 1024 * 1024) return t('{n} КБ', { n: Math.max(1, Math.round(b / 1024)) })
  return t('{n} МБ', { n: (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) })
}

export const timeHM = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString(intlTag(), { hour: '2-digit', minute: '2-digit' }) : ''
