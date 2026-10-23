// The only door between a website screen (src/lib/remoteUi.ts) and the launcher. The screen gets plain
// functions: API calls go through the launcher's own api() (the token stays in the Rust core), links open
// in the browser, installs ask the player first. No IPC, file paths or tokens are handed out.
import { SESSION_EXPIRED_EVENT, api, openExt } from './api'
import { getLocale } from '../i18n'
import { showToast } from '../state/ui'
import { installFromCatalog } from './catalogInstall'
import { installContentFlow } from './install'
import { keyCfModpack, keyMrModpack } from './installKeys'
import { cfInstallModpack, installModpack, loadProfileSettings, millidaUploadRaw } from '../ipc/commands'
import { hasTauri, tauri } from '../ipc/tauri'
import { runInstall } from '../state/installs'
import { useProfiles } from '../state/profiles'
import { t } from '../i18n'
import { REMOTE_UI_SITE, RemoteApiError, remoteApiAllowed, remoteApiError, remoteUploadAllowed, sitePath, uploadParts, type RemoteJoinServer, type RemoteUiBridge } from './remoteUiRules'

export type { RemoteUiBridge }

export function makeRemoteBridge(host: {
  navigate?: (path: string) => boolean
  join: (server: RemoteJoinServer) => Promise<void> | void
}): RemoteUiBridge {
  return {
    v: 1,
    locale: getLocale(),
    // Phrase tables come from here; in dev the local site behind the Vite proxy has the same build.
    siteOrigin: import.meta.env.DEV ? location.origin + '/mlu-site' : REMOTE_UI_SITE,
    api: async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      const method = (init?.method || 'GET').toUpperCase()
      if (!remoteApiAllowed(path, method)) throw new RemoteApiError(403, null, 'not allowed for website screens')
      const t0 = performance.now()
      try {
        return await api<T>(path, {
          method,
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        })
      } catch (e) {
        throw remoteApiError(e)
      } finally {
        // Журнал для замеров (window.__mluApi): когда ушёл запрос экрана и сколько ждали ответ.
        const log = ((window as unknown as { __mluApi?: unknown[] }).__mluApi ??= [])
        if (log.length < 300) log.push({ path, method, at: Math.round(t0), ms: Math.round(performance.now() - t0) })
      }
    },
    upload: async (path, file, opts) => {
      const method = (opts?.method || 'POST').toUpperCase()
      if (!remoteUploadAllowed(path, method)) throw new RemoteApiError(403, null, 'not allowed for website screens')
      const T = tauri()
      if (!T) throw new RemoteApiError(0, null, 'upload works in the app only')
      const parts = uploadParts(path, method, file.size)
      let done = 0
      let last: unknown = null
      for (const part of parts) {
        const id = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        const base = done
        // The core reports how many bytes of this piece have left; the screen sees the sum over the pieces.
        const unlisten = opts?.onProgress
          ? await T.event.listen<{ id: string; sent: number }>('remote-upload-progress', (e) => {
              if (e.payload?.id === id) opts.onProgress?.(base + e.payload.sent)
            })
          : null
        try {
          last = await millidaUploadRaw(part.path, method, id, new Uint8Array(await file.slice(part.start, part.end).arrayBuffer()))
        } catch (e) {
          if (String(e).includes('unauthorized')) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
          throw remoteApiError(e)
        } finally {
          unlisten?.()
        }
        done += part.end - part.start
        opts?.onProgress?.(done)
      }
      return last
    },
    navigate: (path) => {
      if (host.navigate?.(path)) return
      const url = sitePath(path)
      if (url) openExt(url)
    },
    install: async (item, target) => {
      if (target?.kind === 'server') throw new RemoteApiError(400, null, 'server installs go through the hosting API')
      const profile = target?.kind === 'build' ? target.id : undefined
      if (item.source === 'modrinth' || item.source === 'curseforge') {
        installForeign(item, profile)
        return
      }
      await installFromCatalog(item.section, item.slug, { fromLink: true, name: item.name, profile })
    },
    profiles: async () => {
      const { profiles, selected } = useProfiles.getState()
      // The catalog slug of a build installed from the catalog lets a site screen offer «a server with this build».
      const slugs = hasTauri()
        ? await Promise.all(profiles.map((p) => loadProfileSettings(p.name).then((st) => st?.catalogPackSlug || null, () => null)))
        : profiles.map(() => null)
      return {
        list: profiles.map((p, i) => ({ name: p.name, version: p.version, loader: p.loader || (p.fabric ? 'fabric' : null), slug: slugs[i] ?? null })),
        selected: selected || null,
      }
    },
    join: async (server) => {
      await host.join(server)
    },
    openExternal: (url) => {
      if (/^https:\/\//.test(url)) openExt(url)
    },
    toast: (message, kind) => showToast(String(message).slice(0, 300), kind === 'error' ? 'error' : 'ok'),
  }
}

const FOREIGN_KIND: Record<string, string> = { mods: 'mod', 'texture-packs': 'resourcepack', shaders: 'shader', 'data-packs': 'datapack' }

// Modrinth and CurseForge rows of the website catalog: the same installs the launcher's own rows run.
function installForeign(item: { section: string; slug: string; name?: string; source?: string; cfid?: number }, profile?: string): void {
  const title = item.name || item.slug
  if (item.section === 'modpacks') {
    if (!hasTauri()) return showToast(t('Установка доступна в приложении'))
    const cf = item.source === 'curseforge' && item.cfid
    runInstall({
      key: cf ? keyCfModpack(item.cfid!) : keyMrModpack(item.slug),
      title,
      running: t('Скачивание…'),
      run: () => (cf ? cfInstallModpack(item.cfid!) : installModpack(item.slug)),
      onDone: (p) => {
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast(t('Сборка «{name}» готова к запуску', { name: p.name }), 'ok', 'achievement')
      },
    })
    return
  }
  const kind = FOREIGN_KIND[item.section]
  if (!kind) return showToast(t('Этот раздел лаунчер не ставит'))
  const src = item.source === 'curseforge' ? { source: 'curseforge' as const, cfid: item.cfid } : { source: 'modrinth' as const, slug: item.slug }
  void installContentFlow(src, kind, title, profile)
}
