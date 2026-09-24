import '../styles/pixel/emoji.css'
import { Fragment } from 'react'
import type { ReactNode } from 'react'

/**
 * Пиксельные эмодзи набора eltaller47 (Telegram, custom emoji, 55 штук,
 * статичные WebP 100px). Лежат в public/emoji/eltaller/, подписи — в
 * manifest.json рядом.
 *
 * В чат уходят кодом `:elt_07:` — обычным текстом, бэкенд не меняется.
 * Лаунчер рисует код картинкой, другие клиенты (сайт) покажут его текстом.
 */
export const ELT_BASE = '/emoji/eltaller/'
export const ELT_COUNT = 55

export interface EltItem {
  id: string
  emoji: string
  file: string
  animated: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Все id набора по порядку — без ожидания манифеста. */
export const ELT_IDS: string[] = Array.from({ length: ELT_COUNT }, (_, i) => pad(i + 1))

export const eltCode = (id: string) => `:elt_${id}:`
export const eltUrl = (id: string) => `${ELT_BASE}${id}.webp`

const known = (id: string) => {
  const n = Number(id)
  return id.length === 2 && n >= 1 && n <= ELT_COUNT
}

let alias: Record<string, string> = {}
let asked: Promise<Record<string, string>> | null = null

/** Подписи (обычный эмодзи, на который похож пиксельный) — для alt и title. */
export function loadEltAliases(): Promise<Record<string, string>> {
  if (!asked) {
    asked = fetch(ELT_BASE + 'manifest.json')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((m: { items?: EltItem[] }) => {
        alias = Object.fromEntries((m.items || []).map((x) => [x.id, x.emoji]))
        return alias
      })
      .catch(() => {
        asked = null
        return alias
      })
  }
  return asked
}

export const eltAlias = (id: string) => alias[id] || ''

export function randomEltId(except?: string): string {
  let id = ELT_IDS[Math.floor(Math.random() * ELT_IDS.length)]
  if (id === except) id = ELT_IDS[(ELT_IDS.indexOf(id) + 1) % ELT_IDS.length]
  return id
}

const CODE = /:elt_(\d{2}):/g

export const hasElt = (text: string) => {
  CODE.lastIndex = 0
  return CODE.test(text)
}

/**
 * Текст с кодами → куски текста и картинки. Сообщение только из эмодзи
 * (до трёх) рисуется крупно, как в Telegram.
 */
export function EltText({ text }: { text: string }): ReactNode {
  if (!text.includes(':elt_')) return text
  const parts: ReactNode[] = []
  let last = 0
  let pics = 0
  CODE.lastIndex = 0
  for (let m = CODE.exec(text); m; m = CODE.exec(text)) {
    if (!known(m[1])) continue
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <img
        key={m.index}
        className="elt-emoji"
        src={eltUrl(m[1])}
        alt={eltAlias(m[1]) || m[0]}
        title={eltAlias(m[1]) || undefined}
        draggable={false}
      />,
    )
    pics++
    last = m.index + m[0].length
  }
  if (!pics) return text
  if (last < text.length) parts.push(text.slice(last))
  const big = pics <= 3 && parts.every((p) => typeof p !== 'string' || !p.trim())
  return <span className={big ? 'elt-only' : undefined}>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</span>
}
