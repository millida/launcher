import { useServerMods } from '../state/serverMods'
import type { ModsPlan, ServerMod } from './serverModsPlan'

let seq = 0

const mod = (name: string, over: Partial<ServerMod>): ServerMod => ({
  file: name.toLowerCase().replace(/\s+/g, '-') + '.jar',
  size: 900_000,
  sha1: '0'.repeat(40),
  sha512: String(++seq).padStart(128, '0'),
  source: 'modrinth',
  projectId: 'demo',
  versionId: 'demo',
  name,
  iconUrl: null,
  required: true,
  scan: null,
  ticket: null,
  ...over,
})

const PLAN: ModsPlan = {
  server: 'Ламповый SMP',
  serverId: 'demo',
  icon: null,
  version: '1.21.1',
  loader: 'fabric',
  profile: null,
  add: [
    mod('Fabric API', { size: 2_310_000, iconUrl: 'https://cdn.modrinth.com/data/P7dR8mSH/icon.png' }),
    mod('Create Fabric', { size: 18_400_000, source: 'modrinth', iconUrl: 'https://cdn.modrinth.com/data/Xbc0uyRg/icon.png' }),
    mod('Simple Voice Chat', { size: 6_200_000, iconUrl: 'https://cdn.modrinth.com/data/9eGKb6K1/icon.png' }),
    mod('Jade', { size: 1_100_000, source: 'curseforge', required: false }),
    mod('Xaeros Minimap', { size: 3_000_000, source: 'curseforge', required: false }),
  ],
  custom: [
    mod('LampCraft Items', { source: 'custom', projectId: null, versionId: null, file: 'lampcraft-items-2.3.jar', size: 412_000, scan: 'unchecked' }),
    mod('Server Emotes', { source: 'custom', projectId: null, versionId: null, file: 'server-emotes.jar', size: 96_000, scan: 'unchecked' }),
  ],
  remove: ['old-hud-1.0.jar'],
  have: 3,
  customHidden: 1,
}

/** `?preview=user&mods=ask|install|failed` shows the server mods window in a plain browser. */
export function showServerModsDemo(phase: string) {
  const store = useServerMods.getState()
  if (phase === 'install') return store.installing(PLAN, { done: 4, total: 9, current: 'Create Fabric' })
  if (phase === 'failed') {
    store.installing(PLAN, { done: 9, total: 9, current: '' })
    return void store.failures(['LampCraft Items', 'Xaeros Minimap'])
  }
  void store.ask(PLAN).then((d) => {
    if (d.action === 'install') store.installing(PLAN, { done: 2, total: 9, current: 'Simple Voice Chat' })
  })
}
