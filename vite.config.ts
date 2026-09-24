import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A checkout without the media files must still build: these flags let the frontend
// drop what is missing instead of hitting 404s.
const publicFile = (p: string) => fileURLToPath(new URL('public/' + p, import.meta.url))
const bundledVideos = ['bg1', 'bg2', 'bg3', 'bg4'].filter((id) => existsSync(publicFile('bg/' + id + '.mp4')))
const hasBundledMusic = existsSync(publicFile('music/01-starlight-city.mp3'))

export default defineConfig({
  plugins: [react()],
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
  build: { target: 'es2021' },
})
