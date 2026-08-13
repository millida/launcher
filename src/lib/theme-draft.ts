import { accentFromHex, computeAccent } from './accent'
import type { ThemeBase, ThemeManifest, ThemeOption } from './themes'

/// Разметка сгенерированной части. Редактор пересобирает только её, поэтому всё,
/// что человек дописал руками ниже, переживает любое число сохранений — иначе
/// конструктор и ручной CSS были бы взаимоисключающими режимами.
const TOKENS_MARK = '/* millida:tokens */'
export const CUSTOM_MARK = '/* millida:custom */'

export type TokenKind = 'color' | 'size' | 'text'

export interface TokenDef {
  key: string
  label: string
  kind: TokenKind
  hint?: string
  fallback: string
  min?: number
  max?: number
}

export interface TokenGroup {
  id: string
  label: string
  tokens: TokenDef[]
}

/// Токены, которых хватает, чтобы перекрасить весь лаунчер, не написав ни
/// строчки CSS. Полный список живёт в `styles/02-kit.css`; сюда вынесено то,
/// что действительно меняет облик, а не единичный элемент.
export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: 'bg',
    label: 'Фон',
    tokens: [
      { key: '--m-bg', label: 'Фон окна', kind: 'color', fallback: '#161718' },
      { key: '--m-surface', label: 'Панели', kind: 'color', fallback: '#1E1F20' },
      { key: '--m-surface-2', label: 'Панели глубже', kind: 'color', fallback: '#242526' },
      { key: '--m-raised', label: 'Всплывающее', kind: 'color', hint: 'Меню, модалки', fallback: '#2A2B2C' },
      { key: '--m-inset', label: 'Углубления', kind: 'color', hint: 'Поля ввода', fallback: '#141516' },
    ],
  },
  {
    id: 'line',
    label: 'Границы',
    tokens: [
      { key: '--m-border', label: 'Линии', kind: 'color', fallback: '#2E2F30' },
      { key: '--m-border-strong', label: 'Линии заметнее', kind: 'color', fallback: '#3C3D3E' },
    ],
  },
  {
    id: 'fg',
    label: 'Текст',
    tokens: [
      { key: '--m-fg', label: 'Основной', kind: 'color', fallback: '#F2F3F3' },
      { key: '--m-fg-muted', label: 'Вторичный', kind: 'color', fallback: '#B4B7B6' },
      { key: '--m-fg-subtle', label: 'Подписи', kind: 'color', fallback: '#8A8F8C' },
      { key: '--m-fg-faint', label: 'Едва видный', kind: 'color', fallback: '#666B69' },
    ],
  },
  {
    id: 'accent',
    label: 'Акцент',
    tokens: [
      {
        key: '--m-accent',
        label: 'Акцент',
        kind: 'color',
        hint: 'Наведение, мягкая заливка, градиент и свечение считаются от него',
        fallback: '#5EC64D',
      },
    ],
  },
  {
    id: 'status',
    label: 'Статусы',
    tokens: [
      { key: '--m-danger', label: 'Ошибка', kind: 'color', fallback: '#FF6B5E' },
      { key: '--m-warning', label: 'Предупреждение', kind: 'color', fallback: '#F5AA38' },
      { key: '--m-success', label: 'Успех', kind: 'color', fallback: '#5EC64D' },
      { key: '--m-info', label: 'Информация', kind: 'color', fallback: '#4C8DFF' },
    ],
  },
  {
    id: 'shape',
    label: 'Форма',
    tokens: [
      { key: '--m-r-mini', label: 'Скругление мелкое', kind: 'size', fallback: '6px', min: 0, max: 20 },
      { key: '--m-r-ctl', label: 'Скругление кнопок', kind: 'size', fallback: '10px', min: 0, max: 24 },
      { key: '--m-r-md', label: 'Скругление среднее', kind: 'size', fallback: '12px', min: 0, max: 28 },
      { key: '--m-r-card', label: 'Скругление карточек', kind: 'size', fallback: '14px', min: 0, max: 32 },
    ],
  },
  {
    id: 'font',
    label: 'Шрифт',
    tokens: [
      {
        key: '--m-font',
        label: 'Основной',
        kind: 'text',
        hint: 'Название шрифта; свой файл кладётся в папку темы и подключается через @font-face в ручном CSS',
        fallback: 'Inter, system-ui, sans-serif',
      },
      { key: '--m-mono', label: 'Моноширинный', kind: 'text', fallback: 'ui-monospace, monospace' },
    ],
  },
]

export const ALL_TOKENS: TokenDef[] = TOKEN_GROUPS.flatMap((g) => g.tokens)

export interface ThemeDraft {
  id: string
  name: string
  author: string
  version: string
  description: string
  base: ThemeBase
  tokens: Record<string, string>
  css: string
  /// Настройки темы редактор не строит, но и не теряет: тема, у которой они
  /// написаны руками, переживает сохранение из конструктора.
  options: ThemeOption[]
  /// Идентификатор темы-основы, пока у копии ещё нет своего: по нему
  /// переписываются селекторы, когда автор наберёт новый.
  basedOn?: string
}

export function emptyDraft(): ThemeDraft {
  return {
    id: '',
    name: '',
    author: '',
    version: '1.0.0',
    description: '',
    base: 'any',
    tokens: {},
    css: '',
    options: [],
  }
}

/// Значения, которые лаунчер выводит из акцента. Пишутся только когда акцент
/// задан и не переопределён вручную: иначе кнопка была бы одного цвета, а
/// свечение вокруг неё — другого.
function accentDerived(hex: string): Record<string, string> {
  const a = computeAccent(accentFromHex(hex))
  return {
    '--m-accent': a.textC || a.c,
    '--m-accent-hover': a.h,
    '--m-accent-soft': a.s,
    '--m-accent-fg': a.fg || '#ffffff',
    '--m-accent-rgb': a.rgb || '',
    '--m-grad': a.grad || '',
  }
}

function tokenDeclarations(draft: ThemeDraft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const def of ALL_TOKENS) {
    const value = (draft.tokens[def.key] ?? '').trim()
    if (!value) continue
    if (def.key === '--m-accent') {
      Object.assign(out, accentDerived(value))
      continue
    }
    out[def.key] = value
  }
  return out
}

export function draftPreview(draft: ThemeDraft): string[] {
  const pick = (key: string, fallback: string) => (draft.tokens[key] || '').trim() || fallback
  return [pick('--m-bg', '#161718'), pick('--m-surface', '#1E1F20'), pick('--m-accent', '#5EC64D')]
}

/// Собирает файл темы: блок токенов под маркером и ручной хвост как есть.
export function draftCss(draft: ThemeDraft): string {
  const decls = tokenDeclarations(draft)
  const body = Object.entries(decls)
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k}:${v};`)
    .join('\n')
  const generated = body
    ? `${TOKENS_MARK}\n:root[data-theme-pack="${draft.id}"]{\n${body}\n}\n`
    : ''
  const custom = draft.css.trim()
  return `${generated}${CUSTOM_MARK}\n${custom}\n`
}

export function draftManifest(draft: ThemeDraft): ThemeManifest {
  return {
    id: draft.id,
    name: draft.name.trim(),
    author: draft.author.trim(),
    version: draft.version.trim() || '1.0.0',
    description: draft.description.trim(),
    base: draft.base,
    preview: draftPreview(draft),
    options: draft.options,
  }
}

/// Обратный разбор: тема, сохранённая редактором, открывается в нём же с теми
/// же значениями. Файл без маркеров — чужой, написанный руками: он целиком
/// уходит в ручную часть, и ни одна его строка не переписывается.
export function parseDraft(manifest: ThemeManifest, css: string): ThemeDraft {
  const draft: ThemeDraft = {
    id: manifest.id,
    name: manifest.name,
    author: manifest.author || '',
    version: manifest.version || '1.0.0',
    description: manifest.description || '',
    base: manifest.base,
    tokens: {},
    css: '',
    options: manifest.options || [],
  }
  const cut = css.indexOf(CUSTOM_MARK)
  if (cut < 0 || css.indexOf(TOKENS_MARK) < 0) {
    draft.css = css.trim()
    return draft
  }
  const generated = css.slice(0, cut)
  draft.css = css.slice(cut + CUSTOM_MARK.length).trim()
  const known = new Set(ALL_TOKENS.map((t) => t.key))
  for (const match of generated.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;\n}]+)/gi)) {
    const key = match[1].trim()
    if (known.has(key)) draft.tokens[key] = match[2].trim()
  }
  return draft
}

/// Слепок содержимого черновика: по нему редактор отличает «ничего не трогал»
/// от «есть что терять». Пустые токены и пробелы по краям в файл темы не
/// попадают, поэтому и на слепок влиять не должны.
export function draftFingerprint(draft: ThemeDraft): string {
  const tokens = Object.entries(draft.tokens)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return JSON.stringify([
    draft.id,
    draft.name.trim(),
    draft.author.trim(),
    draft.version.trim(),
    draft.description.trim(),
    draft.base,
    tokens,
    draft.css.trim(),
    draft.options,
  ])
}

const SLUG = /^[a-z0-9-]{1,32}$/

/// Причина, по которой тему нельзя сохранить, или null. Проверки те же, что в
/// ядре: расхождение означало бы отказ уже после нажатия «Сохранить».
export function draftProblem(draft: ThemeDraft, takenIds: string[]): string | null {
  if (!SLUG.test(draft.id) || draft.id.startsWith('-')) {
    return 'Идентификатор: строчные латинские буквы, цифры и дефис, до 32 символов'
  }
  if (takenIds.includes(draft.id)) {
    return `Идентификатор «${draft.id}» уже занят другой темой`
  }
  if (!draft.name.trim() || draft.name.trim().length > 64) {
    return 'Название пустое или длиннее 64 символов'
  }
  if (!Object.keys(tokenDeclarations(draft)).length && !draft.css.trim()) {
    return 'Тема пустая: задайте хотя бы один цвет или напишите CSS'
  }
  return null
}

/// Готовит чужую тему как основу для новой: селекторы пакета переписываются на
/// новый идентификатор, иначе скопированный CSS не применился бы ни к чему.
export function rebaseCss(css: string, fromId: string, toId: string): string {
  if (!fromId || fromId === toId) return css
  return css.split(`data-theme-pack="${fromId}"`).join(`data-theme-pack="${toId}"`)
}
