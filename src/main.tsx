// Первым: до модулей, которые читают адрес API при импорте.
import './preview'
import { createRoot } from 'react-dom/client'
import './styles/01-base.css'
import './styles/02-kit.css'
import './styles/03-mods.css'
import './styles/04-hosting.css'
import './styles/05-media.css'
import './styles/06-onboarding.css'
import './styles/07-density.css'
import './styles/09-wide.css'
import './styles/10-call.css'
import './styles/11-rooms.css'
import './styles/12-pixel.css'
// Экранные дополнения пиксельного языка: по файлу на зону (docs/PIXEL-LANGUAGE.md).
// Импорты явные, а не glob: glob-импорты Vite поднимает НАД остальными,
// и кит перебивал эти правила (22.09.2026).
import './styles/pixel/builds.css'
import './styles/pixel/catalog.css'
import './styles/pixel/hosting-settings.css'
import './styles/pixel/premium.css'
import './styles/pixel/rail.css'
import './styles/pixel/shop.css'
import './styles/pixel/settings.css'
import './styles/pixel/shell.css'
import './styles/pixel/social.css'
import { App } from './App'
import { dropBootSplash } from './lib/boot'
import { initAccent } from './lib/accent'
import { Overlay } from './screens/Overlay'
import { openExt } from './lib/api'

if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
  })
}

// Любая внешняя ссылка, которую не перехватил сам компонент, открывается в
// браузере: иначе окно лаунчера уходит на чужой сайт (аудит 24.09.2026).
document.addEventListener('click', (e) => {
  if (e.defaultPrevented) return
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || !/^https?:/i.test(a.getAttribute('href') || '')) return
  e.preventDefault()
  openExt(a.href)
})

// The overlay is the same bundle under a hash route: a second entry point
// would double the build and drift from the main one.
const isOverlay = location.hash.replace('#', '').split('?')[0] === 'overlay'
if (isOverlay) {
  document.documentElement.classList.add('overlay-root')
  dropBootSplash(document)
  // The overlay is a window of the same launcher, so it wears the same palette:
  // without this it painted its own dark grey while the launcher stood in the
  // user's accent.
  void initAccent()
}

createRoot(document.getElementById('root')!).render(isOverlay ? <Overlay /> : <App />)
