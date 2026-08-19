import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Icon } from './Icon'
import { ContextMenu, type ContextItem } from './ContextMenu'
import { backdropClose } from '../lib/dismiss'
import { copyPicture, savePictureAs, type PictureRef } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { copyText } from '../lib/clipboard'
import { showToast } from '../state/ui'

interface LightboxState {
  src: string
  ref: PictureRef
  open: (src: string, ref?: PictureRef) => void
  close: () => void
}

export const useLightbox = create<LightboxState>((set) => ({
  src: '',
  ref: {},
  open: (src, ref) => set({ src, ref: ref || { url: src } }),
  close: () => set({ src: '', ref: {} }),
}))

export const openImage = (src: string, ref?: PictureRef) => useLightbox.getState().open(src, ref)

const MIN_SCALE = 1
const MAX_SCALE = 6
const STEP = 1.35

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

export async function copyPictureTo(ref: PictureRef) {
  if (!hasTauri()) {
    const ok = ref.url ? await copyText(ref.url) : false
    showToast(ok ? 'Ссылка на картинку скопирована' : 'Не удалось скопировать', ok ? 'ok' : 'error')
    return
  }
  try {
    await copyPicture(ref)
    showToast('Картинка скопирована', 'ok')
  } catch (e) {
    showToast('' + e, 'error')
  }
}

export async function savePictureTo(ref: PictureRef) {
  try {
    const out = await savePictureAs(ref)
    if (out) showToast('Сохранено: ' + out, 'ok')
  } catch (e) {
    showToast('' + e, 'error')
  }
}

/// The same three actions wherever a picture is shown: the viewer's toolbar and
/// its right-click menu must not drift apart.
export function pictureMenuItems(ref: PictureRef): ContextItem[] {
  const items: ContextItem[] = [
    { id: 'copy', label: 'Копировать картинку', icon: 'i-copy', onPick: () => void copyPictureTo(ref) },
  ]
  if (hasTauri()) {
    items.push({
      id: 'save',
      label: 'Сохранить как…',
      icon: 'i-download',
      onPick: () => void savePictureTo(ref),
    })
  }
  if (ref.url) {
    items.push({
      id: 'link',
      label: 'Копировать ссылку',
      icon: 'i-link',
      onPick: () => {
        void copyText(ref.url || '').then((ok) =>
          showToast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать', ok ? 'ok' : 'error'),
        )
      },
    })
  }
  return items
}

export function ImageLightbox() {
  const src = useLightbox((s) => s.src)
  const pic = useLightbox((s) => s.ref)
  const close = useLightbox((s) => s.close)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
    setMenu(null)
  }, [src])

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === '+' || e.key === '=') setScale((s) => clamp(s * STEP))
      if (e.key === '-') setScale((s) => clamp(s / STEP))
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'с')) void copyPictureTo(pic)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'ы')) {
        e.preventDefault()
        void savePictureTo(pic)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, pic, close])

  if (!src) return null

  // Zooming out to the fit size must also drop the pan, otherwise the picture
  // stays parked off-screen with no way to bring it back.
  const zoomTo = (next: number) => {
    const v = clamp(next)
    setScale(v)
    if (v === MIN_SCALE) setPan({ x: 0, y: 0 })
  }

  return (
    <div
      className="lightbox"
      {...backdropClose(close)}
      onWheel={(e) => zoomTo(scale * (e.deltaY < 0 ? STEP : 1 / STEP))}
    >
      <div className="lightbox-top" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <button className="lightbox-btn" title="Отдалить" onClick={() => zoomTo(scale / STEP)}>
            <Icon id="i-minus" />
          </button>
          <span className="lightbox-zoom">{Math.round(scale * 100) + '%'}</span>
          <button className="lightbox-btn" title="Приблизить" onClick={() => zoomTo(scale * STEP)}>
            <Icon id="i-plus" />
          </button>
        </div>
        <div className="lightbox-bar">
          <button
            className="lightbox-btn"
            title="Копировать картинку (Ctrl+C)"
            onClick={() => void copyPictureTo(pic)}
          >
            <Icon id="i-copy" />
          </button>
          {hasTauri() ? (
            <button
              className="lightbox-btn"
              title="Сохранить как… (Ctrl+S)"
              onClick={() => void savePictureTo(pic)}
            >
              <Icon id="i-download" />
            </button>
          ) : null}
        </div>
        <button className="lightbox-close" title="Закрыть (Esc)" data-sound="close" onClick={close}>
          <Icon id="i-x" />
          <span>Закрыть</span>
        </button>
      </div>
      <img
        src={src}
        alt=""
        draggable={false}
        className={'lightbox-img' + (scale > MIN_SCALE ? ' zoomed' : '')}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        onDoubleClick={() => zoomTo(scale > MIN_SCALE ? MIN_SCALE : 2.5)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onPointerDown={(e) => {
          if (scale <= MIN_SCALE) return
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
        }}
        onPointerUp={(e) => {
          drag.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
      />
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={pictureMenuItems(pic)} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  )
}
