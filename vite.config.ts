import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { oldWebKitCss } from './scripts/old-webkit-css.mjs'
import { devCosmeticModels } from './scripts/dev-cosmetic-models.mjs'

// A checkout without the media files must still build: these flags let the frontend
// drop what is missing instead of hitting 404s.
// Where the big media (music, wallpaper clips, the Arcania page) comes from is one switch, MEDIA_REMOTE:
//  - unset (default): media/ rides inside the build under /media/, as the files rode in public/ before. The
//    player loses nothing while the objects are not on the CDN yet;
//  - MEDIA_REMOTE=1 (the release build, once `bun scripts/check-media-remote.mjs` has passed): media/ stays out
//    of the build, and the core downloads each file once, by hash (media/manifest.json, scripts/media.mjs,
//    src-tauri/src/engine/core/media.rs). The same variable switches the core: docs/MEDIA.md.
// The dev server serves media/ under /media/ for the browser preview in both cases.
const mediaRemote = process.env.MEDIA_REMOTE === '1'
const mediaFile = (p: string) => fileURLToPath(new URL('media/' + p, import.meta.url))
const bundledVideos = ['bg1', 'bg2', 'bg3', 'bg4'].filter((id) => existsSync(mediaFile('bg/' + id + '.mp4')))
const hasBundledMusic = existsSync(mediaFile('music/01-starlight-city.mp3'))

/// Build only: media/ goes into the build under /media/ (not the manifest: the core has it compiled in). Skipped
/// for a MEDIA_REMOTE build, where the whole point is that the installer does not carry these files.
function bundledMedia(): Plugin {
  let out = ''
  return {
    name: 'bundled-media',
    apply: 'build',
    configResolved(config) {
      out = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      if (mediaRemote || !existsSync(mediaFile(''))) return
      cpSync(mediaFile(''), join(out, 'media'), {
        recursive: true,
        filter: (src) => !/[\\/](manifest\.json|\.[^\\/]*)$/.test(src),
      })
    },
  }
}

/// Dev only: /media/<path> from the media/ folder, the same names the core resolves through the manifest.
function devMedia(): Plugin {
  return {
    name: 'dev-media',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/media', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]!).replace(/^\/+/, '')
        const file = mediaFile(rel)
        if (!rel || rel.includes('..') || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
        res.setHeader('Content-Length', statSync(file).size)
        createReadStream(file).pipe(res)
      })
    },
  }
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

export default defineConfig(({ mode }) => {
  // Тестовая Милли (milli-server): адрес и токен только из .env.local, в сборку не попадают.
  const env = loadEnv(mode, process.cwd(), 'MILLI_TEST_')
  return {
  plugins: [react(), oldWebKitCss(), devCosmeticModels(), devMedia(), bundledMedia()],
  clearScreen: false,
  define: {
    __BUNDLED_VIDEOS__: JSON.stringify(bundledVideos),
    __HAS_BUNDLED_MUSIC__: JSON.stringify(hasBundledMusic),
    __MEDIA_REMOTE__: JSON.stringify(mediaRemote),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**'] },
    // Фронт в обычном браузере против прод-API (без Rust, без Docker).
    // Прод не отдаёт CORS для localhost, поэтому ходим через этот прокси:
    // в консоли страницы один раз localStorage.setItem('m-api', '/papi/v2').
    // Телеметрию и heartbeat глушим — локальный запуск не должен попадать
    // в онлайн лаунчера в админке. Подробно — docs/LOCAL-DEV.md.
    proxy: {
      ...(env.MILLI_TEST_URL
        ? {
            '/milli-test': {
              target: env.MILLI_TEST_URL,
              changeOrigin: true,
              rewrite: (p: string) => p.replace(/^\/milli-test/, ''),
              headers: { 'X-Milli-Token': env.MILLI_TEST_TOKEN ?? '' },
            },
          }
        : {}),
      // Website screens (src/lib/remoteUi.ts) from a local millida-web dev server; set m-ui-base to change.
      '/mlu-site': {
        target: process.env.MLU_SITE || 'http://127.0.0.1:3037',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/mlu-site/, ''),
      },
      '/papi': {
        target: 'https://api.millida.net',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/papi/, ''),
        bypass: (req, res) => {
          if (/\/launcher\/(telemetry|heartbeat)/.test(req.url || '') && res) {
            res.statusCode = 204
            res.end()
            return false
          }
          return undefined
        },
      },
    },
  },
  // The x64 bundle starts on macOS 10.13, whose WKWebView can be as old as Safari 13:
  // newer syntax there is a parse error and the window stays blank.
  build: { target: ['es2020', 'safari13'] },
  }
})
