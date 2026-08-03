import { createRoot } from 'react-dom/client'
import './styles/01-base.css'
import './styles/02-kit.css'
import './styles/03-mods.css'
import './styles/04-hosting.css'
import './styles/05-media.css'
import './styles/06-onboarding.css'
import { App } from './App'

if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
  })
}

createRoot(document.getElementById('root')!).render(<App />)
