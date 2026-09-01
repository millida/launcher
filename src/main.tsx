import { createRoot } from 'react-dom/client'
import './styles/01-base.css'
import './styles/02-kit.css'
import './styles/03-mods.css'
import './styles/04-hosting.css'
import './styles/05-media.css'
import './styles/06-onboarding.css'
import './styles/07-density.css'
import './styles/08-themes.css'
import './styles/09-wide.css'
import './styles/10-call.css'
import './styles/11-rooms.css'
import { App } from './App'
import { dropBootSplash } from './lib/boot'
import { initAccent } from './lib/accent'
import { initTheme } from './lib/theme'
import { Overlay } from './screens/Overlay'

if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
  })
}

// The overlay is the same bundle under a hash route: a second entry point
// would double the build and drift from the main one.
const isOverlay = location.hash.replace('#', '').split('?')[0] === 'overlay'
if (isOverlay) {
  document.documentElement.classList.add('overlay-root')
  dropBootSplash(document)
  // The overlay is a window of the same launcher, so it wears the same palette:
  // without this it painted its own dark grey while the launcher stood in the
  // user's theme and accent.
  initTheme()
  void initAccent()
}

createRoot(document.getElementById('root')!).render(isOverlay ? <Overlay /> : <App />)
