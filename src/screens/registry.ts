import { lazy } from 'react'
import type { ScreenId } from '../state/ui'

// Imports are shared with lazy() so a prewarmed chunk is reused, not fetched twice.
const loaders = {
  play: () => import('./Play'),
  premium: () => import('./Premium'),
  plus: () => import('./Plus'),
  builds: () => import('./Builds'),
  servers: () => import('./Servers'),
  mods: () => import('./Mods'),
  skins: () => import('./Skins'),
  rubies: () => import('./Rubies'),
  friends: () => import('./Friends'),
  top: () => import('./Top'),
  chat: () => import('./Messages'),
  hosting: () => import('./Hosting'),
  playhub: () => import('./PlayHub'),
  game: () => import('./Game'),
  settings: () => import('../modals/Settings'),
} satisfies Record<ScreenId, () => Promise<unknown>>

export const Play = lazy(() => loaders.play().then((m) => ({ default: m.Play })))
export const Premium = lazy(() => loaders.premium().then((m) => ({ default: m.Premium })))
export const Plus = lazy(() => loaders.plus().then((m) => ({ default: m.Plus })))
export const Builds = lazy(() => loaders.builds().then((m) => ({ default: m.Builds })))
export const Servers = lazy(() => loaders.servers().then((m) => ({ default: m.Servers })))
export const Mods = lazy(() => loaders.mods().then((m) => ({ default: m.Mods })))
export const Skins = lazy(() => loaders.skins().then((m) => ({ default: m.Skins })))
export const Rubies = lazy(() => loaders.rubies().then((m) => ({ default: m.Rubies })))
export const Friends = lazy(() => loaders.friends().then((m) => ({ default: m.Friends })))
export const Top = lazy(() => loaders.top().then((m) => ({ default: m.Top })))
export const Messages = lazy(() => loaders.chat().then((m) => ({ default: m.Messages })))
export const Hosting = lazy(() => loaders.hosting().then((m) => ({ default: m.Hosting })))
export const PlayHub = lazy(() => loaders.playhub().then((m) => ({ default: m.PlayHub })))
export const Game = lazy(() => loaders.game().then((m) => ({ default: m.Game })))
export const Settings = lazy(() => loaders.settings().then((m) => ({ default: m.Settings })))

export function preloadScreen(id: ScreenId) {
  const load = loaders[id]
  if (load) void load().catch(() => {})
}

export function preloadScreens() {
  const run = () => Object.values(loaders).forEach((load) => void load().catch(() => {}))
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (idle) idle(run)
  else setTimeout(run, 1200)
}
