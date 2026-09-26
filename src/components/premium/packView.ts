import { realDownloads } from '../../lib/realDownloads'
import { api } from '../../lib/api'
import { cachedCatalog, forgetCatalog } from '../../lib/catalogCache'

/*
 * Карточка сборки нашего каталога — общие данные страницы сборки (PackPage) и
 * баннера «нет доступа» (PackKeyModal). Один адрес и один разбор, чтобы факты
 * на двух экранах не расходились.
 */

/** Блок описания нашего каталога: абзац, заголовок, список, картинка (catalog/admin-item-text.ts). */
export type DescBlock =
  | { type: 'paragraph' | 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'image'; src: string; alt?: string }

/** GET /catalog/packs/:slug — карточка сборки для лаунчера. */
export interface PackView {
  slug?: string
  title?: string
  summary?: string
  version?: string
  game?: string
  loader?: string
  loaderVersion?: string
  cover?: string | null
  banner?: string | null
  video?: string | null
  gallery?: string[]
  description?: DescBlock[] | null
  author?: string | null
  accessRequired?: boolean
  /** Где купить доступ — сайт сборки. */
  accessBuyUrl?: string | null
  files?: { side: string; version: string; size: number }[]
}

const packViewKey = (slug: string) => 'pack-view:' + slug

export const loadPackView = (slug: string): Promise<PackView> =>
  cachedCatalog(packViewKey(slug), () => api<PackView>('/catalog/packs/' + encodeURIComponent(slug)))

export const forgetPackView = (slug: string): void => forgetCatalog(packViewKey(slug))

/** Наши скачивания сборки — из карточки сайта. */
export const loadPackDownloads = (slug: string): Promise<number | null> =>
  cachedCatalog('pack-dl:' + slug, () =>
    api<{ downloads?: number | null }>('/catalog/items/' + encodeURIComponent(slug)).then((d) =>
      d && typeof d.downloads === 'number' && d.downloads > 0 ? realDownloads(slug, d.downloads) : null,
    ),
  )

export const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace('.', ',') + ' ГБ'
export const LOADER: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }

/** Число модов из текста описания автора («291 мод», «258 модов»): не выдумываем, а читаем. */
export function modsFromText(blocks: DescBlock[] | null | undefined): number | null {
  for (const b of blocks || []) {
    const text = b.type === 'list' ? (b.items || []).join(' ') : b.type === 'image' ? '' : b.text || ''
    const m = /(\d{2,4})\s+мод(?:ов|а)?(?![а-яё])/i.exec(text)
    if (m) return Number(m[1])
  }
  return null
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const capital = (s: string) => s.charAt(0).toLocaleUpperCase('ru') + s.slice(1)

function benefitOf(item: string): string | null {
  const at = item.search(/\s[—–]\s/)
  if (at < 0) return null
  const tail = item.slice(at + 3).trim().replace(/[.;]+$/, '')
  if (!tail) return null
  if (words(tail) <= 5) return capital(tail)
  const clause = tail.split(/,\s+/)[0]!.trim()
  return clause && words(clause) <= 5 ? capital(clause) : null
}

function headOf(item: string): string | null {
  const head = item.split(/\s*[:—–]\s*|,\s+/)[0]!.trim()
  return head && words(head) <= 4 ? head : null
}

/**
 * Плюсы сборки коротко — из списка «Что внутри» её же описания. Сначала польза
 * из пунктов «Моды — что дают»: игроку важнее «Магия», чем название мода.
 * Не хватило — добираем головами пунктов. Длинное пропускаем: это уже абзац.
 */
export function packPluses(blocks: DescBlock[] | null | undefined, max = 4): string[] {
  const list = blocks || []
  const at = list.findIndex((b) => b.type === 'heading' && /внутри|особенност|что есть/i.test(b.text))
  const src = (at >= 0 ? list.slice(at + 1) : list).find((b) => b.type === 'list')
  if (!src || src.type !== 'list') return []
  const benefits = src.items.map(benefitOf)
  const heads = src.items.map((item, i) => (benefits[i] ? null : headOf(item)))
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of [...benefits, ...heads]) {
    if (!x || seen.has(x.toLowerCase())) continue
    seen.add(x.toLowerCase())
    out.push(x)
    if (out.length >= max) break
  }
  return out
}

/** Значок к плюсу — по смыслу слова; не нашли — галочка. */
const PLUS_ICON: [RegExp, string][] = [
  [/класс|рас[аы]|происхожд/i, 'i-users'],
  [/навык|древо|прокач|уров/i, 'i-star'],
  [/кот|спутник|питом|пет/i, 'i-heart'],
  [/босс|монстр|моб/i, 'i-flame'],
  [/квест|сюжет|истор/i, 'i-book'],
  [/артефакт|оруж|предмет|брон/i, 'i-gem'],
  [/маги|заклин|спелл/i, 'i-zap'],
  [/шейдер|графи|ресурс|текстур/i, 'i-image'],
  [/биом|мир|подзем|измерен|остров/i, 'i-map'],
  [/сервер|друз|мульти/i, 'i-server'],
  [/бой|сраж|битв/i, 'i-shield'],
]
export const plusIcon = (text: string): string => PLUS_ICON.find(([re]) => re.test(text))?.[1] || 'i-check'
