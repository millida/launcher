import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { oldWebKitCss } from './scripts/old-webkit-css.mjs'
import { devCosmeticModels } from './scripts/dev-cosmetic-models.mjs'

// A checkout without the media files must still build: these flags let the frontend
// drop what is missing instead of hitting 404s.
const publicFile = (p: string) => fileURLToPath(new URL('public/' + p, import.meta.url))
const bundledVideos = ['bg1', 'bg2', 'bg3', 'bg4'].filter((id) => existsSync(publicFile('bg/' + id + '.mp4')))
const hasBundledMusic = existsSync(publicFile('music/01-starlight-city.mp3'))

export default defineConfig(({ mode }) => {
  // Тестовая Милли (milli-server): адрес и токен только из .env.local, в сборку не попадают.
  const env = loadEnv(mode, process.cwd(), 'MILLI_TEST_')
  return {
  plugins: [react(), oldWebKitCss(), devCosmeticModels()],
  clearScreen: false,
  define: {
    __BUNDLED_VIDEOS__: JSON.stringify(bundledVideos),
    __HAS_BUNDLED_MUSIC__: JSON.stringify(hasBundledMusic),
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
