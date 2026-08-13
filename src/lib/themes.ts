import { convertFileSrc, listThemes, readTheme } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { hydratePrefs, readPref, writePref } from './prefs'
import { pinThemeBase } from './theme'
import { createStyleNode, styleBlocked } from './style-node'
import marioCss from '../themes/mario.css?raw'
import win98Css from '../themes/win98.css?raw'
import minimalCss from '../themes/minimal.css?raw'
import terminalCss from '../themes/terminal.css?raw'
import blocksCss from '../themes/blocks.css?raw'
import nightCss from '../themes/night.css?raw'
import paperCss from '../themes/paper.css?raw'

export type ThemeBase = 'dark' | 'light' | 'any'
export type ThemeOptionKind = 'toggle' | 'color' | 'select' | 'slider'

export interface ThemeOptionItem {
  value: string
  label: string
}

export interface ThemeOption {
  key: string
  kind: ThemeOptionKind
  label: string
  hint?: string
  default: string
  items?: ThemeOptionItem[]
  min?: number
  max?: number
  step?: number
  unit?: string
}

export interface ThemeManifest {
  id: string
  name: string
  author?: string
  version?: string
  description?: string
  base: ThemeBase
  preview?: string[]
  options?: ThemeOption[]
}

export interface ThemePack extends ThemeManifest {
  builtin: boolean
  /// Only installed packs have one; images inside their CSS resolve against it.
  dir?: string
}

const PACK_KEY = 'm-theme-pack'
const DENSITY_KEY = 'm-density'
const OPTS_KEY = 'm-theme-opts'
const VALS_KEY = 'm-theme-vals'
const VALS_MAX = 256
const STYLE_ID = 'm-theme-pack-css'

export type Density = '' | 'compact' | 'roomy'

export const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: 'compact', label: 'Плотно', hint: 'Мелкие отступы — на экран помещается заметно больше' },
  { id: '', label: 'Обычно', hint: 'Стандартные размеры лаунчера' },
  { id: 'roomy', label: 'Свободно', hint: 'Крупнее и просторнее, удобно на большом экране' },
]

const BUILTIN_CSS: Record<string, string> = {
  mario: marioCss,
  win98: win98Css,
  minimal: minimalCss,
  terminal: terminalCss,
  blocks: blocksCss,
  night: nightCss,
  paper: paperCss,
}

export const BUILTIN_THEMES: ThemePack[] = [
  {
    id: 'minimal',
    name: 'Минимал',
    author: 'Millida',
    version: '1.0.0',
    description: 'Тонкие линии, ровные плоскости, никаких градиентов и теней.',
    base: 'any',
    preview: ['#161718', '#1E1F20', '#8A8F8C'],
    builtin: true,
    options: [
      {
        key: 'lines',
        kind: 'toggle',
        label: 'Разделители',
        hint: 'Тонкие линии между строками списков',
        default: '1',
      },
      {
        key: 'radius',
        kind: 'slider',
        label: 'Скругление',
        default: '6',
        min: 0,
        max: 16,
        step: 1,
        unit: 'px',
      },
      {
        key: 'flat',
        kind: 'toggle',
        label: 'Плоские кнопки',
        hint: 'Акцент только цветом текста, без заливки',
        default: '0',
      },
    ],
  },
  {
    id: 'blocks',
    name: 'Блоки',
    author: 'Millida',
    version: '1.0.0',
    description: 'Каменные панели, объёмные грани и сетка инвентаря — лаунчер в духе самой игры.',
    base: 'dark',
    preview: ['#2C2E31', '#4A3524', '#6BBB4B'],
    builtin: true,
    options: [
      {
        key: 'world',
        kind: 'select',
        label: 'Мир',
        hint: 'Палитра блоков, из которых собран интерфейс',
        default: 'overworld',
        items: [
          { value: 'overworld', label: 'Обычный (камень и трава)' },
          { value: 'nether', label: 'Нижний мир' },
          { value: 'end', label: 'Край' },
          { value: 'snow', label: 'Снежные равнины (светлый)' },
        ],
      },
      {
        key: 'slots',
        kind: 'toggle',
        label: 'Сетка инвентаря',
        hint: 'Ячейки за содержимым панелей',
        default: '1',
      },
      {
        key: 'pixel',
        kind: 'toggle',
        label: 'Пиксельная типографика',
        hint: 'Моноширинный шрифт без сглаживания и чёткие картинки',
        default: '0',
      },
    ],
  },
  {
    id: 'night',
    name: 'Ночь',
    author: 'Millida',
    version: '1.0.0',
    description: 'Настоящий чёрный для OLED: панели держатся на линиях, ничего не светится.',
    base: 'dark',
    preview: ['#000000', '#0A0A0B', '#5EC64D'],
    builtin: true,
    options: [
      {
        key: 'accent',
        kind: 'select',
        label: 'Акцент',
        default: 'green',
        items: [
          { value: 'green', label: 'Millida (зелёный)' },
          { value: 'ice', label: 'Ледяной' },
          { value: 'amber', label: 'Янтарный' },
          { value: 'violet', label: 'Фиолетовый' },
          { value: 'plain', label: 'Без цвета' },
        ],
      },
      {
        key: 'lines',
        kind: 'toggle',
        label: 'Границы панелей',
        hint: 'Выключить — панели разделяет только расстояние',
        default: '1',
      },
      {
        key: 'dim',
        kind: 'slider',
        label: 'Приглушить картинки',
        hint: 'Обложки, баннеры и видео — единственное, что светит ночью в полную силу',
        default: '0',
        min: 0,
        max: 60,
        step: 10,
        unit: '%',
      },
    ],
  },
  {
    id: 'paper',
    name: 'Бумага',
    author: 'Millida',
    version: '1.0.0',
    description: 'Светлая тема для дневного света: тёплый лист, чернила и тонкие линейки.',
    base: 'light',
    preview: ['#F1ECE0', '#FBF8F1', '#356B4F'],
    builtin: true,
    options: [
      {
        key: 'tint',
        kind: 'select',
        label: 'Оттенок листа',
        default: 'warm',
        items: [
          { value: 'warm', label: 'Тёплый (крем)' },
          { value: 'cool', label: 'Холодный (белый)' },
          { value: 'sepia', label: 'Сепия' },
        ],
      },
      {
        key: 'serif',
        kind: 'toggle',
        label: 'Заголовки с засечками',
        default: '1',
      },
      {
        key: 'rule',
        kind: 'toggle',
        label: 'Линейки в списках',
        hint: 'Тонкая черта между строками настроек и списков',
        default: '1',
      },
    ],
  },
  {
    id: 'mario',
    name: 'Марио',
    author: 'Millida',
    version: '1.0.0',
    description: 'Кирпич, трубы и облака: восьмибитная классика поверх лаунчера.',
    base: 'dark',
    preview: ['#5C94FC', '#C84C0C', '#FCD800'],
    builtin: true,
    options: [
      {
        key: 'sky',
        kind: 'select',
        label: 'Мир',
        default: 'overworld',
        items: [
          { value: 'overworld', label: 'Надземный (небо)' },
          { value: 'underground', label: 'Подземелье' },
          { value: 'castle', label: 'Замок Боузера' },
        ],
      },
      {
        key: 'brick',
        kind: 'color',
        label: 'Цвет кирпича',
        default: '#C84C0C',
      },
      {
        key: 'coin',
        kind: 'toggle',
        label: 'Монетный акцент',
        hint: 'Кнопки и выделение золотые, как блок с монетой',
        default: '1',
      },
      {
        key: 'pixel',
        kind: 'toggle',
        label: 'Пиксельная типографика',
        hint: 'Моноширинный шрифт с жёсткой тенью',
        default: '1',
      },
      {
        key: 'scan',
        kind: 'slider',
        label: 'Сканлайны',
        hint: 'Полосы ЭЛТ-экрана поверх интерфейса',
        default: '0',
        min: 0,
        max: 40,
        step: 5,
        unit: '%',
      },
    ],
  },
  {
    id: 'win98',
    name: 'Windows 98',
    author: 'Millida',
    version: '1.0.0',
    description: 'Серый пластик, объёмные рамки и синий заголовок окна.',
    base: 'light',
    preview: ['#008080', '#C0C0C0', '#000080'],
    builtin: true,
    options: [
      {
        key: 'wall',
        kind: 'select',
        label: 'Рабочий стол',
        default: 'teal',
        items: [
          { value: 'teal', label: 'Бирюзовый (по умолчанию)' },
          { value: 'plum', label: 'Сливовый' },
          { value: 'grey', label: 'Серый' },
        ],
      },
      {
        key: 'title',
        kind: 'color',
        label: 'Цвет заголовка',
        default: '#000080',
      },
      {
        key: 'bevel',
        kind: 'toggle',
        label: 'Объёмные рамки',
        hint: 'Классический выпуклый бордюр у кнопок и панелей',
        default: '1',
      },
      {
        key: 'crisp',
        kind: 'toggle',
        label: 'Без сглаживания',
        hint: 'Резкий текст и отключённая анимация',
        default: '1',
      },
    ],
  },
  {
    id: 'terminal',
    name: 'Терминал',
    author: 'Millida',
    version: '1.0.0',
    description: 'Моноширинный интерфейс на чёрном: люминофор и рамки из символов.',
    base: 'dark',
    preview: ['#050807', '#0B120E', '#39FF88'],
    builtin: true,
    options: [
      {
        key: 'phosphor',
        kind: 'select',
        label: 'Люминофор',
        default: 'green',
        items: [
          { value: 'green', label: 'Зелёный' },
          { value: 'amber', label: 'Янтарный' },
          { value: 'ice', label: 'Ледяной' },
        ],
      },
      {
        key: 'glow',
        kind: 'slider',
        label: 'Свечение',
        default: '40',
        min: 0,
        max: 100,
        step: 10,
        unit: '%',
      },
      {
        key: 'scan',
        kind: 'toggle',
        label: 'Сканлайны',
        default: '1',
      },
    ],
  },
]

export function storedPackId(): string {
  return readPref(PACK_KEY, '')
}

export function storedDensity(): Density {
  const v = readPref(DENSITY_KEY, '')
  return v === 'compact' || v === 'roomy' ? v : ''
}

export function applyDensity(v: Density) {
  const root = document.documentElement
  if (v) root.dataset.density = v
  else delete root.dataset.density
  writePref(DENSITY_KEY, v)
}

function allOptionValues(): Record<string, Record<string, string>> {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as Record<string, Record<string, string>>) : {}
  } catch {
    return {}
  }
}

/// Web storage keeps every pack's settings, but only the active pack's are
/// mirrored into the durable file: the core caps one setting at 256 bytes, and
/// the values that have to survive a restart are the ones currently on screen.
function durableValues(): { id: string; v: Record<string, string> } | null {
  try {
    const raw = JSON.parse(readPref(VALS_KEY, '') || 'null')
    if (!raw || typeof raw !== 'object') return null
    const id = typeof raw.id === 'string' ? raw.id : ''
    const v = raw.v && typeof raw.v === 'object' ? (raw.v as Record<string, string>) : null
    return id && v ? { id, v } : null
  } catch {
    return null
  }
}

export function optionValues(pack: ThemePack): Record<string, string> {
  const mirrored = durableValues()
  const stored =
    allOptionValues()[pack.id] || (mirrored && mirrored.id === pack.id ? mirrored.v : {})
  const out: Record<string, string> = {}
  for (const o of pack.options || []) {
    const v = stored[o.key]
    out[o.key] = typeof v === 'string' ? v : o.default
  }
  return out
}

export function saveOptionValues(pack: ThemePack, values: Record<string, string>) {
  const all = allOptionValues()
  all[pack.id] = values
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify(all))
  } catch {}
  const mirror = JSON.stringify({ id: pack.id, v: values })
  if (mirror.length <= VALS_MAX) writePref(VALS_KEY, mirror)
}

function optionCssValue(o: ThemeOption, raw: string): string {
  if (o.kind === 'toggle') return raw === '1' ? '1' : '0'
  if (o.kind === 'slider') return raw + (o.unit || '')
  return raw
}

export function applyOptions(pack: ThemePack, values: Record<string, string>) {
  const root = document.documentElement
  for (const o of pack.options || []) {
    const raw = values[o.key] ?? o.default
    root.style.setProperty('--o-' + o.key, optionCssValue(o, raw))
    if (o.kind === 'toggle') root.dataset['o' + capitalize(o.key)] = raw === '1' ? 'on' : 'off'
    if (o.kind === 'select') root.dataset['o' + capitalize(o.key)] = raw
  }
}

function clearOptions(pack: ThemePack) {
  const root = document.documentElement
  for (const o of pack.options || []) {
    root.style.removeProperty('--o-' + o.key)
    delete root.dataset['o' + capitalize(o.key)]
  }
}

/// `data-o-my-key` reaches JS as `dataset.oMyKey`; the CSS side keeps writing
/// the dashed form, so both spellings have to agree exactly.
function capitalize(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^([a-z])/, (_, c: string) => c.toUpperCase())
}

/// Relative `url()` in an installed pack points at a file inside its folder,
/// which the webview can only read through the asset protocol.
function resolveAssets(css: string, dir?: string): string {
  if (!dir) return css
  const base = dir.replace(/[\\/]+$/, '')
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote: string, ref: string) => {
    const value = ref.trim()
    if (/^(data:|asset:|https?:|\/\/)/i.test(value)) return whole
    const rel = value.replace(/^\.?[\\/]+/, '')
    return 'url(' + quote + convertFileSrc(base + '/' + rel) + quote + ')'
  })
}

let styleEl: HTMLStyleElement | null = null

function styleNode(): HTMLStyleElement {
  if (styleEl && styleEl.isConnected) return styleEl
  const found = document.getElementById(STYLE_ID)
  styleEl = found instanceof HTMLStyleElement ? found : createStyleNode(STYLE_ID)
  styleEl.id = STYLE_ID
  // Appended last so a pack overrides the bundled kit at equal specificity.
  if (!styleEl.isConnected) document.head.appendChild(styleEl)
  return styleEl
}

/// The node has to be able to hold rules before anything else moves: a pack that
/// pins the palette and lights up its card while the stylesheet is refused is
/// exactly the failure that reads as "themes do not work in the release build".
function paintableNode(): HTMLStyleElement {
  const el = styleNode()
  if (styleBlocked(el)) {
    throw new Error('Стили оформления заблокированы политикой безопасности сборки (CSP)')
  }
  return el
}

let activePack: ThemePack | null = null

export function activeThemePack(): ThemePack | null {
  return activePack
}

/// Empty stylesheet text is never a valid pack. Applying it anyway still pinned
/// the palette and marked the card active, so the launcher claimed a theme it
/// had not drawn and the only visible effect was the light palette showing
/// through — the failure has to reach the user instead.
async function packCss(pack: ThemePack): Promise<string> {
  if (pack.builtin) {
    const css = BUILTIN_CSS[pack.id]
    if (!css || !css.trim()) {
      throw new Error('Оформление «' + pack.name + '» не попало в сборку лаунчера')
    }
    return css
  }
  const src = await readTheme(pack.id)
  const css = resolveAssets(src.css, src.dir)
  if (!css.trim()) throw new Error('Файл оформления «' + pack.name + '» пуст')
  return css
}

/// Исходный CSS темы — тот, что лежит в файле: без подстановки asset-адресов,
/// которую делает применение. Редактор правит именно текст файла.
export async function rawPackCss(pack: ThemePack): Promise<string> {
  if (pack.builtin) return BUILTIN_CSS[pack.id] || ''
  const src = await readTheme(pack.id)
  return src.css
}

/// Installed packs are read from disk, so the list is only complete once the
/// core answers; builtins are always available and win a clash of ids, because
/// a pack dropped into the folder must not shadow one that ships with the app.
export async function availableThemes(): Promise<ThemePack[]> {
  if (!hasTauri()) return BUILTIN_THEMES
  try {
    const installed = await listThemes()
    const taken = new Set(BUILTIN_THEMES.map((t) => t.id))
    return [
      ...BUILTIN_THEMES,
      ...installed.filter((t) => !taken.has(t.id)).map((t) => ({ ...t, builtin: false }) as ThemePack),
    ]
  } catch {
    return BUILTIN_THEMES
  }
}

/// A pack changes fonts, radii and borders alongside the palette, and only the
/// colours can be tweened. Fading them left the screen visibly mid-swap for a
/// third of a second — long enough to read as "the theme did not apply" — so a
/// pack lands at once and the fade stays for accent and light/dark, where every
/// property involved can actually travel.
function swap(change: () => void) {
  change()
}

let previewing = false

/// Живой просмотр черновика: стили встают в тот же узел, что и настоящий пакет,
/// но выбор темы никуда не пишется. Иначе закрытый без сохранения редактор
/// оставлял бы лаунчер в теме, которой на диске нет.
export function previewDraftCss(id: string, base: ThemeBase, css: string, dir?: string) {
  const node = paintableNode()
  previewing = true
  node.textContent = resolveAssets(css, dir)
  document.documentElement.dataset.themePack = id
  pinThemeBase(base === 'any' ? '' : base)
}

export async function stopDraftPreview(): Promise<void> {
  if (!previewing) return
  previewing = false
  const pack = activePack
  activePack = null
  await applyThemePack(pack)
}

export function clearThemePack() {
  if (activePack) clearOptions(activePack)
  activePack = null
  styleNode().textContent = ''
  delete document.documentElement.dataset.themePack
  pinThemeBase('')
  writePref(PACK_KEY, '')
}

export async function applyThemePack(pack: ThemePack | null): Promise<void> {
  if (!pack) {
    swap(() => clearThemePack())
    return
  }
  const css = await packCss(pack)
  const node = paintableNode()
  const values = optionValues(pack)
  swap(() => {
    if (activePack && activePack.id !== pack.id) clearOptions(activePack)
    activePack = pack
    // textContent, never innerHTML: the pack is author-supplied text and a
    // style element parses it as CSS, so a stray tag stays inert.
    node.textContent = css
    document.documentElement.dataset.themePack = pack.id
    pinThemeBase(pack.base === 'any' ? '' : pack.base)
    applyOptions(pack, values)
  })
  writePref(PACK_KEY, pack.id)
  const mirror = JSON.stringify({ id: pack.id, v: values })
  if (mirror.length <= VALS_MAX) writePref(VALS_KEY, mirror)
}

/// Reached from boot, where the toast layer is not mounted yet, so the reason
/// goes to the log the crash report collects and to the next gallery attempt.
function reportThemeFailure(e: unknown) {
  console.error('theme pack not applied:', e)
}

async function restoreStoredPack(): Promise<void> {
  const density = storedDensity()
  const root = document.documentElement
  if (density) root.dataset.density = density
  else delete root.dataset.density
  const id = storedPackId()
  if (!id || (activePack && activePack.id === id)) return
  const builtin = BUILTIN_THEMES.find((t) => t.id === id)
  if (builtin) {
    await applyThemePack(builtin)
    return
  }
  if (!hasTauri()) return
  // A pack that was uninstalled outside the launcher falls back to the plain
  // theme, but a core that failed to answer must not: dropping the choice on a
  // transient error would lose it for good.
  let installed: ThemeManifest[]
  try {
    installed = await listThemes()
  } catch {
    return
  }
  const found = installed.find((t) => t.id === id)
  if (found) await applyThemePack({ ...found, builtin: false })
  else clearThemePack()
}

/// Applies the stored pack and density on boot. Web storage can start empty
/// while the durable copy on disk still holds the choice — the webview commits
/// it lazily and a session that ended through the tray never got to — so the
/// restore runs a second time once that copy has landed.
export async function initThemePacks(): Promise<void> {
  // A pack that cannot be drawn must not take the boot down with it: the plain
  // theme is a working launcher, and the gallery reports the reason on the next
  // attempt.
  const restore = () => restoreStoredPack().catch((e) => void reportThemeFailure(e))
  await restore()
  await hydratePrefs()
  await restore()
}
