let pending: Promise<any> | null = null

export function loadSkinview(): Promise<any> {
  if (window.skinview3d) return Promise.resolve(window.skinview3d)
  if (pending) return pending
  pending = new Promise<any>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = '/skinview3d.bundle.js'
    el.async = true
    el.onload = () => {
      if (window.skinview3d) resolve(window.skinview3d)
      else reject(new Error('skinview3d недоступен'))
    }
    el.onerror = () => reject(new Error('не удалось загрузить skinview3d'))
    document.head.appendChild(el)
  }).catch((e) => {
    pending = null
    throw e
  })
  return pending
}
