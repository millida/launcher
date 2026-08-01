import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A checkout without the media files must still build: these flags let the frontend
// drop what is missing instead of hitting 404s.
const publicFile = (p: string) => fileURLToPath(new URL('public/' + p, import.meta.url))
const bundledVideos = ['bg1', 'bg2', 'bg3', 'bg4'].filter((id) => existsSync(publicFile('bg/' + id + '.mp4')))
const hasBundledMusic = existsSync(publicFile('music/ambient.mp3'))

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
  },
  build: { target: 'es2021' },
})
