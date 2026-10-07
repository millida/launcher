// Модели косметики для демо (только `vite` dev-сервер, в сборку не попадает).
//
// На проде геометрия вещей лежит за `GET /v2/cosmetics/models/:id`, и без сессии
// он отвечает 401: в ?preview 3D-персонаж стоял голым. Здесь Vite отдаёт те же
// файлы прямо из репозитория мода — `cosmetics/bundled_<имя>.json` для модели
// `geometry.<имя>` (форма та же, что у ответа сервера: geometry, geometrySlim,
// animations). Эмоции лежат там же: у вещи-эмоции клипы внутри её файла.
//
// Папка — `MILLIDA_COSMETICS_DIR`, по умолчанию соседний клон мода.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEV_MODELS_PATH = '/__dev/cosmetic-models/'

const DEFAULT_DIR = join(
  homedir(),
  'dev/millida-mod-telemetry/bridges/assets-common/src/main/resources/assets/millida/cosmetics',
)

/**
 * Кандидаты файла: каталог прода зовёт модель `geometry.dragon_wings`, а мод
 * хранит её как `bundled_dragon_wings.json`; встроенные вещи мода уже с
 * приставкой. Чужие символы (путь наружу) — пусто.
 */
export function modelFiles(id) {
  const name = String(id || '').replace(/^geometry\./, '')
  if (!/^[a-z0-9_][a-z0-9_.-]{0,120}$/i.test(name) || name.includes('..')) return []
  return name.startsWith('bundled_') ? [name + '.json'] : ['bundled_' + name + '.json', name + '.json']
}

export function devCosmeticModels() {
  const dir = process.env.MILLIDA_COSMETICS_DIR || DEFAULT_DIR
  return {
    name: 'millida-dev-cosmetic-models',
    apply: 'serve',
    configureServer(server) {
      if (!existsSync(dir)) {
        server.config.logger.warn('[dev-models] нет папки моделей: ' + dir + ' (MILLIDA_COSMETICS_DIR)')
      }
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (req.method !== 'GET' || !url.startsWith(DEV_MODELS_PATH)) return next()
        const files = modelFiles(decodeURIComponent(url.slice(DEV_MODELS_PATH.length).split('?')[0]))
        const path = files.map((f) => join(dir, f)).find((p) => existsSync(p))
        if (!path) {
          res.statusCode = 404
          res.end('{}')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'max-age=3600')
        res.end(readFileSync(path))
      })
    },
  }
}
