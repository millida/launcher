/// A picture that failed to load (no network, 502 from the image host) shows the browser's
/// broken-file icon with a frame. Mark it so the CSS hides the icon and the tile keeps a calm
/// placeholder colour instead; when the network is back, the marked pictures are retried once.
export function installBrokenImageGuard(): void {
  if (typeof document === 'undefined') return
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target
      if (el instanceof HTMLImageElement) el.classList.add('img-broken')
    },
    true,
  )
  document.addEventListener(
    'load',
    (e) => {
      const el = e.target
      if (el instanceof HTMLImageElement && el.classList.contains('img-broken')) el.classList.remove('img-broken')
    },
    true,
  )
  window.addEventListener('online', () => {
    document.querySelectorAll<HTMLImageElement>('img.img-broken').forEach((img) => {
      const src = img.src
      img.removeAttribute('src')
      img.src = src
    })
  })
}
