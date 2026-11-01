import { getAccount } from '../state/accounts'
import { idbGet, idbSet } from './idbCache'

/**
 * Снимок персонажа лобби с прошлого раза. Лобби открывается раньше, чем грузится three.js
 * (≈735 КБ) и собирается сцена: пока этого нет, на месте фигуры лежит её же снимок с того
 * же места и того же размера, и первый кадр уже содержит персонажа. Снимок снимается с
 * готовой живой сцены в простое и лежит в IndexedDB (lib/idbCache) — любой сбой это просто
 * «снимка нет».
 */

const KEY = 'lobby-still:v1:'
const MAX_AGE_MS = 30 * 86_400_000

export interface LobbyStill {
  /** Размер сцены в момент снимка, CSS-пиксели. */
  w: number
  h: number
  /** Образ, с которого снят снимок (lookKey): по нему видно, что вещи сменились. */
  look: string
  blob: Blob
}

const keyOf = () => {
  const a = getAccount()
  return KEY + (a?.id || a?.nick || 'guest')
}

export async function readLobbyStill(): Promise<LobbyStill | null> {
  try {
    const row = await idbGet<LobbyStill>(keyOf())
    if (!row || Date.now() - row.at > MAX_AGE_MS) return null
    const v = row.value
    return v && v.blob instanceof Blob && v.w > 0 && v.h > 0 ? v : null
  } catch {
    return null
  }
}

/** Снять холст сцены сейчас. Зови сразу после кадра движка: буфер WebGL живёт до конца кадра. */
export function saveLobbyStill(canvas: HTMLCanvasElement, look: string): void {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w < 50 || h < 50) return
  try {
    canvas.toBlob(
      (blob) => {
        // Пустой холст (контекст потерян, кадр не нарисован) в снимок не годится.
        if (blob && blob.size > 2000) void idbSet<LobbyStill>(keyOf(), { w, h, look, blob })
      },
      'image/webp',
      0.9,
    )
  } catch (e) {
    console.warn('[lobby-still] the still frame was not saved', e)
  }
}
