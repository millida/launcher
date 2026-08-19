import type { Profile } from '../ipc/commands'

export const fmt = (n: number): string =>
  n >= 1e6
    ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн'
    : n >= 1e3
      ? (n / 1e3).toFixed(0) + ' тыс'
      : String(n)

export const fmtN = (n: number): string => Number(n || 0).toLocaleString('ru-RU')

const LOADER_NAMES: Record<string, string> = {
  vanilla: 'Ванилла',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

export const loaderId = (p?: Profile | null): string =>
  (p && (p.loader || (p.fabric ? 'fabric' : 'vanilla'))) || 'vanilla'

export const LOADER_NAME = (p?: Profile | null): string => LOADER_NAMES[loaderId(p)] || 'Ванилла'

const RU_MAP: Record<string, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  quilt: 'Quilt',
  neoforge: 'NeoForge',
  optimization: 'Оптимизация',
  adventure: 'Приключения',
  technology: 'Технологии',
  magic: 'Магия',
  library: 'Библиотека',
  utility: 'Утилиты',
  decoration: 'Декор',
  worldgen: 'Генерация мира',
  equipment: 'Снаряжение',
  food: 'Еда',
  storage: 'Хранилища',
  multiplayer: 'Мультиплеер',
  social: 'Социальное',
  challenging: 'Хардкор',
  'kitchen-sink': 'Всё сразу',
  lightweight: 'Лёгкий',
  combat: 'Бой',
  mobs: 'Мобы',
  cursed: 'Странное',
  economy: 'Экономика',
  'game-mechanics': 'Механики игры',
  management: 'Менеджмент',
  minigame: 'Мини-игры',
  quests: 'Квесты',
  transportation: 'Транспорт',
  audio: 'Звук',
  blocks: 'Блоки',
  'core-shaders': 'Ядровые шейдеры',
  entities: 'Сущности',
  environment: 'Окружение',
  fonts: 'Шрифты',
  gui: 'Интерфейс',
  items: 'Предметы',
  locale: 'Локализация',
  modded: 'Для модов',
  models: 'Модели',
  realistic: 'Реалистичные',
  simplistic: 'Минималистичные',
  themed: 'Тематические',
  tweaks: 'Мелкие правки',
  'vanilla-like': 'Как ванилла',
  atmosphere: 'Атмосфера',
  bloom: 'Свечение',
  cartoon: 'Мультяшные',
  'colored-lighting': 'Цветной свет',
  fantasy: 'Фэнтези',
  foliage: 'Листва',
  low: 'Низкие требования',
  medium: 'Средние требования',
  high: 'Высокие требования',
  screenshot: 'Для скриншотов',
  'path-tracing': 'Трассировка пути',
  pbr: 'PBR-материалы',
  reflections: 'Отражения',
  'semi-realistic': 'Полуреалистичные',
  shadows: 'Тени',
  potato: 'Для слабых ПК',
  vanilla: 'Ванилла',
  datapack: 'Дата-пак',
  iris: 'Iris',
  optifine: 'OptiFine',
  canvas: 'Canvas',
}

export const RU_LOADER = (c: string): string => RU_MAP[c] || c

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
    ? 'Лицензия Microsoft'
    : k === 'tg' || k === 'millida'
      ? 'Аккаунт Millida'
      : k === 'offline'
        ? 'Офлайн-ник'
        : 'Гость'

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

export const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

export const fmtPlaytime = (seconds?: number): string => {
  const s = Math.max(0, Math.round(seconds || 0))
  if (s < 60) return 'меньше минуты'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (!h) return m + ' мин'
  return h >= 100 ? h + ' ч' : h + ' ч ' + m + ' м'
}

export const whenText = (tsSeconds?: number): string => {
  if (!tsSeconds) return ''
  const days = (Date.now() / 1000 - tsSeconds) / 86400
  if (days < 1) return 'сегодня'
  if (days < 2) return 'вчера'
  if (days < 30) return Math.round(days) + ' дн назад'
  const mo = Math.round(days / 30)
  return mo < 12 ? mo + ' мес назад' : Math.round(days / 365) + ' г назад'
}

export const agoText = (t?: number): string => {
  if (!t) return ''
  const m = Math.round(Date.now() / 1000 - t) / 60
  return m < 60
    ? Math.round(m) + ' мин назад'
    : m < 1440
      ? Math.round(m / 60) + ' ч назад'
      : Math.round(m / 1440) + ' дн назад'
}

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
  if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + ' КБ'
  return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' МБ'
}
