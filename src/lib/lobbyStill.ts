import { getAccount, lookOwner } from '../state/accounts'
import { idbDel, idbGet, idbSet } from './idbCache'
import { lobbyFigureBox } from './lobbyFrame'

/**
 * Снимок персонажа лобби с прошлого раза. Лобби открывается раньше, чем грузится three.js
 * (≈735 КБ) и собирается сцена: пока этого нет, на месте фигуры лежит её же снимок, подогнанный
 * под нынешний размер окна (stillPlacement), и первый кадр уже содержит персонажа. Снимок снимается с
 * готовой живой сцены в простое и лежит в IndexedDB (lib/idbCache) — любой сбой это просто
 * «снимка нет».
 */

// v2: со снимком лежит место сцены (top, scene) — по нему снимок встаёт на окно другого размера.
const KEY = 'lobby-still:v2:'
/** Снимки до v2 никто не читает: удаляем, чтобы не лежали в IndexedDB вечно. */
const OLD_KEYS = ['lobby-still:v1:']
const swept = new Set<string>()
const MAX_AGE_MS = 30 * 86_400_000
/** Во сколько раз снимок можно растянуть или сжать, пока это не видно глазу. */
const MIN_SCALE = 0.6
const MAX_SCALE = 1.6

/** Где стоит сцена персонажа: размер и отступ от верха лобби высотой scene, CSS-пиксели. */
export interface StageGeom {
  w: number
  h: number
  top: number
  scene: number
}

export interface LobbyStill extends StageGeom {
  /** Образ, с которого снят снимок (lookKey): по нему видно, что вещи сменились. */
  look: string
  blob: Blob
}

/** Место сцены на странице; у сцены его считает кадр фигуры (lobbyFrame). */
export function stageGeom(el: HTMLElement): StageGeom {
  const h = el.clientHeight
  return { w: el.clientWidth, h, top: el.offsetTop, scene: (el.offsetParent as HTMLElement | null)?.clientHeight || h }
}

export interface StillPlace {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Куда положить снимок, снятый в сцене `was`, чтобы фигура на нём совпала с той, что встанет
 * в сцене `now`: ноги на ту же линию, рост тот же, по центру. Фигуру ставит lobbyFrame только
 * по высоте сцены, поэтому другая ширина окна снимок не портит. null — растянуть пришлось бы
 * так, что пиксели поплывут: лучше плоская фигурка.
 */
export function stillPlacement(was: StageGeom, now: StageGeom): StillPlace | null {
  const a = lobbyFigureBox(was.h, was.top, was.scene)
  const b = lobbyFigureBox(now.h, now.top, now.scene)
  if (a.tall <= 0 || b.tall <= 0) return null
  const scale = b.tall / a.tall
  if (scale < MIN_SCALE || scale > MAX_SCALE) return null
  return { left: now.w / 2 - (was.w / 2) * scale, top: b.feet - a.feet * scale, width: was.w * scale, height: was.h * scale }
}

const ownerOf = () => lookOwner() || 'guest'

export async function readLobbyStill(): Promise<LobbyStill | null> {
  const owner = ownerOf()
  if (!swept.has(owner)) {
    swept.add(owner)
    // Снимки до v2 лежат по id аккаунта, без ника.
    for (const old of OLD_KEYS) void idbDel(old + (getAccount()?.id || 'guest'))
  }
  try {
    const row = await idbGet<LobbyStill>(KEY + owner)
    if (!row || Date.now() - row.at > MAX_AGE_MS) return null
    const v = row.value
    return v && v.blob instanceof Blob && v.w > 0 && v.h > 0 && v.scene > 0 ? v : null
  } catch {
    return null
  }
}

/** Пустой холст (контекст потерян, кадр не нарисован) в снимок не годится. */
const keepBlob = (blob: Blob | null, key: string, look: string, stage: StageGeom): Promise<boolean> =>
  !blob || blob.size <= 2000
    ? Promise.resolve(false)
    : idbSet<LobbyStill>(key, { ...stage, look, blob }).then(
        () => true,
        () => false,
      )

/**
 * Снять холст сцены сейчас. Зови в той же задаче, что и кадр движка (renderFrame): буфер WebGL
 * живёт до конца задачи, а createImageBitmap / toBlob копируют его сразу. Сжимает картинку worker
 * (lib/shotEncode): WKWebView не кодирует WebP, и PNG кадра Retina на главном потоке подвешивал
 * кнопки (04.11.2026: «при надевании набора кнопки подвисают»). Разрешится `true`, если снимок лёг.
 */
export function saveLobbyStill(canvas: HTMLCanvasElement, look: string, stage: StageGeom): Promise<boolean> {
  if (stage.w < 50 || stage.h < 50) return Promise.resolve(false)
  // Хозяин снимка — тот, чей кадр снят: за время сжатия аккаунт мог смениться.
  const key = KEY + ownerOf()
  if (typeof createImageBitmap === 'function') {
    try {
      const shot = createImageBitmap(canvas)
      return shot
        .then((bitmap) => import('./shotEncode').then((m) => m.encodeBitmap(bitmap)))
        .then((blob) => keepBlob(blob, key, look, stage))
        .catch((e: unknown) => {
          console.warn('[lobby-still] the still frame was not saved', e)
          return false
        })
    } catch {
      // Холст не отдал кадр картинкой — сжимаем по-старому.
    }
  }
  return new Promise((done) => {
    try {
      canvas.toBlob((blob) => void keepBlob(blob, key, look, stage).then(done), 'image/webp', 0.9)
    } catch (e) {
      console.warn('[lobby-still] the still frame was not saved', e)
      done(false)
    }
  })
}
