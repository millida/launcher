// Копия скина и плаща на этом компьютере (ядро: skins/csl.rs set_local_skin). Её читает игра, когда
// скин-сервера Millida в запуске нет: офлайн- и Microsoft-аккаунты, откат на офлайн. Раньше она
// обновлялась только с открытого экрана «Скины» и без плаща: скин с сайта, из каталога или из заказа
// и любой плащ в игру не попадали (обращения 13.11.2026). Теперь её сверяют экран скинов, установка
// из каталога и каждый запуск игры.
import { setLocalSkin } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { t } from '../i18n'
import { hasMillidaAccount } from './api'
import { loadWardrobe } from './gameProfile'
import { loadImg } from './skinArms'
import { textureSource } from './textureSource'

const PNG_DATA_PREFIX = 'data:image/png;base64,'

/// Remote textures are CORS-restricted, so re-encode through canvas.
export async function toPngBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return url.replace(/^data:image\/png;base64,/, '')
  // Байты уходят на сервер как есть: пережатие через canvas меняет их, а каталог
  // аккаунта схлопывает повторы по хешу PNG — с новым хешем та же текстура
  // ложится в него ещё одной записью.
  const src = await textureSource(url)
  if (src.startsWith(PNG_DATA_PREFIX)) return src.slice(PNG_DATA_PREFIX.length)
  const img = await loadImg(url)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('canvas недоступен'))
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

let written = ''
const markOf = (skin: string, cape: string | null | undefined, slim: boolean) => [skin, cape ?? '', slim ? 'slim' : 'classic'].join('|')

/** Копия уже записана этими байтами (экран скинов залил их сам): повторно не качать. */
export function markLocalLook(skin: string, cape: string | null | undefined, slim: boolean) {
  written = markOf(skin, cape, slim)
}

export function forgetLocalLook() {
  written = ''
}

/**
 * Записать вид аккаунта в копию для игры. Плаща на аккаунте нет — локальный не трогаем: на этом
 * компьютере может быть надет плащ лицензии, которого на аккаунте Millida нет (снимает его «Снять плащ»).
 */
export async function syncLocalLook(skin: string | null, cape: string | null | undefined, slim: boolean): Promise<void> {
  if (!hasTauri() || !skin) return
  const mark = markOf(skin, cape, slim)
  if (written === mark) return
  const skinPng = await toPngBase64(skin)
  const capePng = cape ? await toPngBase64(cape) : null
  await setLocalSkin(skinPng, capePng, slim)
  written = mark
}

/** Вид с аккаунта Millida — в копию для игры. Перед запуском и после надевания вне экрана скинов. */
export async function syncLocalLookFromAccount(): Promise<void> {
  if (!hasTauri() || !hasMillidaAccount()) return
  const w = await loadWardrobe()
  await syncLocalLook(w.active.skinUrl, w.active.capeUrl, w.active.model === 'slim')
}
