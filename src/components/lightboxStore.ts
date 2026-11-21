// Which picture the viewer shows. It lives apart from the viewer (ImageLightbox.tsx), which is a lazy chunk:
// any screen may open a picture, but the viewer's code is needed only once one is opened.
import { create } from 'zustand'
import type { PictureRef } from '../ipc/commands'

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
