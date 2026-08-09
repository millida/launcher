import { convertFileSrc, listThemes, readTheme } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { readPref, writePref } from './prefs'
import { pinThemeBase, withColorFade } from './theme'
import marioCss from '../themes/mario.css?raw'
import win98Css from '../themes/win98.css?raw'
import minimalCss from '../themes/minimal.css?raw'
import terminalCss from '../themes/terminal.css?raw'

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

export function optionValues(pack: ThemePack): Record<string, string> {
  const stored = allOptionValues()[pack.id] || {}
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
  styleEl = found instanceof HTMLStyleElement ? found : document.createElement('style')
  styleEl.id = STYLE_ID
  // Appended last so a pack overrides the bundled kit at equal specificity.
  if (!styleEl.isConnected) document.head.appendChild(styleEl)
  return styleEl
}

let activePack: ThemePack | null = null

export function activeThemePack(): ThemePack | null {
  return activePack
}

async function packCss(pack: ThemePack): Promise<string> {
  if (pack.builtin) return BUILTIN_CSS[pack.id] || ''
  const src = await readTheme(pack.id)
  return resolveAssets(src.css, src.dir)
}

/// Installed packs are read from disk, so the list is only complete once the
/// core answers; builtins are always available.
export async function availableThemes(): Promise<ThemePack[]> {
  if (!hasTauri()) return BUILTIN_THEMES
  try {
    const installed = await listThemes()
    return [
      ...BUILTIN_THEMES,
      ...installed.map((t) => ({ ...t, builtin: false }) as ThemePack),
    ]
  } catch {
    return BUILTIN_THEMES
  }
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
    withColorFade(() => clearThemePack())
    return
  }
  const css = await packCss(pack)
  const values = optionValues(pack)
  withColorFade(() => {
    if (activePack && activePack.id !== pack.id) clearOptions(activePack)
    activePack = pack
    // textContent, never innerHTML: the pack is author-supplied text and a
    // style element parses it as CSS, so a stray tag stays inert.
    styleNode().textContent = css
    document.documentElement.dataset.themePack = pack.id
    pinThemeBase(pack.base === 'any' ? '' : pack.base)
    applyOptions(pack, values)
  })
  writePref(PACK_KEY, pack.id)
}

/// Applies the stored pack and density on boot. A pack that was uninstalled
/// outside the launcher simply falls back to the plain theme.
export async function initThemePacks(): Promise<void> {
  const density = storedDensity()
  if (density) document.documentElement.dataset.density = density
  const id = storedPackId()
  if (!id) return
  const builtin = BUILTIN_THEMES.find((t) => t.id === id)
  if (builtin) {
    await applyThemePack(builtin)
    return
  }
  const found = (await availableThemes()).find((t) => t.id === id)
  if (found) await applyThemePack(found)
  else clearThemePack()
}
