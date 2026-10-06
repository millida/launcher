import type { DescBlock } from './packView'
import { plusIcon } from './packView'

/*
 * Разбор описания премиум-сборки для её страницы (PremiumPackPage): главы
 * истории и системные требования. Всё —
 * из блоков описания, которые прислал каталог; чего в тексте нет, того на
 * странице нет.
 */

export interface Chapter {
  /** Якорь главы на странице. */
  id: string
  title: string
  image: { src: string; alt: string; caption?: string } | null
  text: string[]
  items: string[]
}

export interface Story {
  /** Абзацы до первого заголовка — вступление. */
  lead: string[]
  leadImage: { src: string; alt: string } | null
  chapters: Chapter[]
  /** Абзац «Системные требования», если автор его написал. */
  reqs: string | null
}

const SKIP = /как установить|установка/i
const REQS = /требован/i

/**
 * Число модов на премиум-странице не показываем нигде (владелец 04.10.2026),
 * и в тексте автора тоже: «…на Fabric, 291 мод, около 3 ГБ» → «…на Fabric, около 3 ГБ».
 */
export function withoutModCount(text: string): string {
  return text
    .replace(/(^|[,;]\s*)(?:более\s+|около\s+|свыше\s+)?\d{2,4}\s+мод(?:ов|а)?(?![а-яё])(?:\s+и\s+|,\s*)?/gi, (_, lead: string) => lead)
    .replace(/,\s*([.;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function storyOf(blocks: DescBlock[] | null | undefined): Story {
  const out: Story = { lead: [], leadImage: null, chapters: [], reqs: null }
  let cur: Chapter | null = null
  let mode: 'lead' | 'chapter' | 'reqs' | 'skip' = 'lead'
  for (const b of blocks || []) {
    if (b.type === 'heading') {
      cur = null
      if (REQS.test(b.text)) mode = 'reqs'
      else if (SKIP.test(b.text)) mode = 'skip'
      else {
        mode = 'chapter'
        cur = { id: 'ppx-ch-' + out.chapters.length, title: b.text.trim(), image: null, text: [], items: [] }
        out.chapters.push(cur)
      }
      continue
    }
    if (mode === 'skip') continue
    if (mode === 'reqs') {
      if (b.type === 'paragraph') out.reqs = out.reqs ? out.reqs + ' ' + b.text : b.text
      else if (b.type === 'list') out.reqs = (out.reqs ? out.reqs + ' ' : '') + b.items.join('; ')
      continue
    }
    if (mode === 'lead' || !cur) {
      if (b.type === 'paragraph') out.lead.push(withoutModCount(b.text))
      else if (b.type === 'image' && b.src && !out.leadImage) out.leadImage = { src: b.src, alt: b.alt || '' }
      continue
    }
    if (b.type === 'paragraph') cur.text.push(withoutModCount(b.text))
    else if (b.type === 'list') cur.items.push(...(b.items || []).map(withoutModCount))
    else if (b.type === 'image' && b.src && !cur.image) cur.image = { src: b.src, alt: b.alt || '', caption: b.caption }
  }
  return out
}

export interface Exclusive {
  /** Глава «О сборке». */
  chapter: string
  title: string
  /** Короткое имя вкладки: «Сюжет», «Боссы», «Классы», «Кот Сёма». */
  tab: string
  /** Текст главы целиком — абзацы или пункты списка, без обрезки. */
  text: string[]
  icon: string
  image: string | null
}

const ADJ = /(?:ые|ый|ий|ая|ое|ие)$/i

/** «Сюжет и диалоги» → «Сюжет», «Самописные боссы» → «Боссы», «Кот Сёма» → «Кот Сёма». */
export function tabLabel(title: string): string {
  const head = title.split(/\s+и\s+/)[0]!.trim()
  const words = head.split(/\s+/)
  if (words.length === 2 && ADJ.test(words[0]!)) return words[1]!.charAt(0).toLocaleUpperCase('ru') + words[1]!.slice(1)
  return head
}

// Автор сам говорит, что сделал своё: «самописные боссы», «с нуля», «свой сюжет».
const OWN_WORK = /самопис|с нуля|уникальн|собственн|авторск|своим сюжетом|свой сюжет|нигде больше|эксклюзив/i
// Глава о своём контенте — сюжет, боссы, классы, спутник; графика и шейдеры — чужие.
const OWN_TOPIC = /сюжет|диалог|квест|истори|босс|класс|навык|спутник|кот\b|кот |питом|артефакт|самопис|уникальн/i
const NOT_OWN = /шейдер|ресурспак|графи|установ|требован/i

/**
 * Эксклюзив сборки — то, чего нет нигде больше: свои моды, боссы и сюжет
 * студии. Только когда автор сам так написал; у сборки из чужих модов (ATM10)
 * блока и метки нет.
 */
export function exclusivesOf(story: Story, tagline?: string | null, max = 4): Exclusive[] {
  const all = [tagline || '', ...story.lead, ...story.chapters.flatMap((c) => [c.title, ...c.text, ...c.items])].join(' ')
  if (!OWN_WORK.test(all)) return []
  return story.chapters
    .filter((c) => !NOT_OWN.test(c.title) && OWN_TOPIC.test(c.title + ' ' + (c.text[0] || '')))
    .slice(0, max)
    .map((c) => ({
      chapter: c.id,
      title: c.title,
      tab: tabLabel(c.title),
      text: c.text.length ? c.text : c.items,
      icon: iconOf(c.title, c.text[0] || c.items[0] || ''),
      image: c.image ? c.image.src : null,
    }))
}

const OWN_ICON: [RegExp, string][] = [
  [/техни|автомат|завод|механи|индустр/i, 'i-hammer'],
  [/ферм|урож|пчёл|пчел|сельск|еда/i, 'i-emerald'],
  [/кот|кошк|спутник|питом/i, 'i-paw'],
]

/** Значок главы: сначала свои слова страницы, потом общий словарь плюсов. */
export function iconOf(title: string, line = ''): string {
  const own = OWN_ICON.find(([re]) => re.test(title))?.[1]
  if (own) return own
  const icon = plusIcon(title)
  return icon === 'i-check' ? plusIcon(title + ' ' + line) : icon
}

export interface ReqRow {
  label: string
  value: string
}

export interface Reqs {
  min: ReqRow[]
  rec: ReqRow[]
  note: string | null
}

function reqRows(text: string): ReqRow[] {
  const rows: ReqRow[] = []
  for (const raw of text.split(/,\s+|\s+и\s+(?=видео|[A-Za-zi])/)) {
    const s = raw.trim().replace(/[.;]+$/, '')
    if (!s) continue
    const gb = /(\d+(?:[.,]\d+)?)\s*ГБ/i.exec(s)
    if (/оператив|ОЗУ|RAM|памят/i.test(s)) rows.push({ label: 'Память', value: gb ? gb[1] + ' ГБ' : s })
    else if (/видеокарт|GPU|GTX|RTX|Radeon/i.test(s))
      rows.push({ label: 'Видеокарта', value: gb ? gb[1] + ' ГБ видеопамяти' : s.replace(/^видеокарта\s*/i, '') })
    else if (/\bi\d\b|Ryzen|процессор|CPU|Intel|AMD/i.test(s)) rows.push({ label: 'Процессор', value: s.replace(/^процессор\s*/i, '') })
    else if (/диск|SSD|места/i.test(s)) rows.push({ label: 'Диск', value: s })
    // «8 ГБ» без слова «память» в начале строки требований — это память.
    else if (gb && !rows.length && /^\d/.test(s)) rows.push({ label: 'Память', value: gb[1] + ' ГБ' })
  }
  return rows
}

/**
 * «Минимум — 4 ГБ…, i3…; для комфортной игры — 8 ГБ…» → две колонки. Не
 * узнали формат — null, и страница покажет абзац автора как есть.
 */
export function parseReqs(text: string | null | undefined): Reqs | null {
  if (!text) return null
  const m = /миним[а-яё]*\s*[—–:-]\s*(.+?)[;.]\s*(?:для комфортн[а-яё]* игры|рекоменд[а-яё]*|комфорт[а-яё]*|оптимал[а-яё]*)\s*[—–:-]\s*(.+?)(?:\.\s|\.$|$)/i.exec(text)
  if (!m) return null
  const min = reqRows(m[1]!)
  const rec = reqRows(m[2]!)
  if (!min.length && !rec.length) return null
  const rest = text.slice((m.index || 0) + m[0].length).trim()
  return { min, rec, note: rest || null }
}

/** «Arcania 1.4.3» → имя «Arcania» и версия «1.4.3»: версию страница ставит меткой. */
export function splitTitle(title: string, version?: string | null): { name: string; version: string | null } {
  const m = /^(.*?\S)\s+v?(\d+(?:\.\d+)+[a-z]?)$/i.exec(title.trim())
  if (m && (!version || version === m[2])) return { name: m[1]!, version: m[2]! }
  return { name: title, version: version || null }
}

/* ---------------- окно студии ---------------- */

/** Скачивания коротко: «940», «10,9 тыс.», «123 тыс.», «1,2 млн». */
export function downloadsShort(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)))
  if (n < 1e6) {
    const k = Math.round(n / 100) / 10
    if (k < 100) return k.toLocaleString('ru-RU') + ' тыс.'
    const whole = Math.round(n / 1e3)
    if (whole < 1000) return whole.toLocaleString('ru-RU') + ' тыс.'
  }
  return (Math.round(n / 1e5) / 10).toLocaleString('ru-RU') + ' млн'
}

/**
 * Суть сборки на две строки карточки — целыми частями фразы, без «…» посреди
 * слова: «Зомби-апокалипсис: зачистка районов, оружие, техника и машины» →
 * «Зомби-апокалипсис: зачистка районов, оружие». Одна часть длиннее предела —
 * режем по слову и ставим многоточие.
 */
export function shortPitch(text: string, max = 40): string {
  const t = text.trim().replace(/[.]+$/, '')
  if (t.length <= max) return t
  // Safari 13 WebKit (old macOS) cannot parse lookbehind, so the separator is captured instead.
  const parts = t.replace(/([,:;—–])\s+/g, '$1\n').split('\n')
  let out = ''
  for (const p of parts) {
    const next = out ? out + ' ' + p : p
    if (next.length > max) break
    out = next
  }
  out = out.replace(/[,:;—–\s]+$/, '')
  if (out && out.length >= max * 0.45) return out
  const cut = t.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,:;—–\s]+$/, '') + '…'
}

/** Имя сборки для карточки: без подзаголовка и номера версии. «DeceasedCraft - Urban Zombie Apocalypse» → «DeceasedCraft». */
export function shortTitle(title: string): string {
  const head = title.split(/\s[-–—|]\s|:\s|\s\[|\s\(/)[0]!.trim()
  const name = head.replace(/\s+v?\d+(?:\.\d+)+[a-z]?$/i, '').trim()
  return name.length >= 3 ? name : title
}

/** Жанры сборок студии — по словам названия и сути: тегов каталог не отдаёт. */
export const GENRES: { id: string; label: string; re: RegExp }[] = [
  { id: 'horror', label: 'Хоррор', re: /хоррор|ужас|зомби|апокалип|страх|horror|zombie|dread/i },
  { id: 'rpg', label: 'RPG', re: /\brpg\b|рпг|фэнтез|маги|подземел|dungeon|dragon/i },
  { id: 'tech', label: 'Техника', re: /техн|create|завод|автомат|mekani|индустр|industr/i },
  { id: 'survival', label: 'Выживание', re: /выжив|хардкор|survival|terrafirma|stranded/i },
]

export const genresOf = (title: string, summary: string): string[] =>
  GENRES.filter((g) => g.re.test(title + ' ' + summary)).map((g) => g.id)
