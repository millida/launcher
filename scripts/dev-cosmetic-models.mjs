// Модели косметики для демо (только `vite` dev-сервер, в сборку не попадает).
//
// На проде геометрия вещей лежит за `GET /v2/cosmetics/models/:id`, и без сессии
// он отвечает 401: в ?preview 3D-персонаж стоял голым. Здесь Vite отдаёт те же
// файлы прямо из репозитория мода — `cosmetics/bundled_<имя>.json` для модели
// `geometry.<имя>` (форма та же, что у ответа сервера: geometry, geometrySlim,
// animations). Эмоции лежат там же: у вещи-эмоции клипы внутри её файла.
//
// Папка — `MILLIDA_COSMETICS_DIR`, по умолчанию соседний клон мода.
//
// Вторая очередь — свои наборы эмоций до загрузки на сервер:
// `docs/emotes/<набор>/` (файлы `<имя>.json`, текстуры, `catalog.json`). Их
// позиции каталога отдаёт `/__dev/emote-catalog`, текстуры —
// `/__dev/emote-files/<файл>`; демо-вход (src/lib/demo.ts) подмешивает их в
// каталог, и новые эмоции видны в гардеробе, магазине и лобби.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEV_MODELS_PATH = '/__dev/cosmetic-models/'
export const DEV_EMOTE_CATALOG_PATH = '/__dev/emote-catalog'
export const DEV_EMOTE_FILES_PATH = '/__dev/emote-files/'

const AUTHORED_ROOT = join(import.meta.dirname, '..', 'docs', 'emotes')

/** Папки наборов: те, где лежит catalog.json. */
export function authoredDirs(root = AUTHORED_ROOT) {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, 'catalog.json')))
}

/** Позиции всех наборов; текстура — адрес dev-сервера, а не имя файла. */
export function authoredCatalog(root = AUTHORED_ROOT) {
  const items = []
  for (const dir of authoredDirs(root)) {
    const file = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'))
    for (const item of file.items ?? []) {
      items.push(item.texture && !/^https?:/.test(item.texture) ? { ...item, texture: DEV_EMOTE_FILES_PATH + item.texture } : item)
    }
  }
  return items
}

const sendJson = (res, body) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

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
        const url = (req.url || '').split('?')[0]
        if (req.method !== 'GET') return next()
        if (url === DEV_EMOTE_CATALOG_PATH) return sendJson(res, JSON.stringify({ items: authoredCatalog() }))
        if (url.startsWith(DEV_EMOTE_FILES_PATH)) {
          const name = decodeURIComponent(url.slice(DEV_EMOTE_FILES_PATH.length))
          const path = /^[a-z0-9_][a-z0-9_.-]{0,120}\.png$/i.test(name) && !name.includes('..')
            ? authoredDirs().map((d) => join(d, name)).find((p) => existsSync(p))
            : undefined
          if (!path) {
            res.statusCode = 404
            return res.end()
          }
          res.setHeader('Content-Type', 'image/png')
          res.setHeader('Cache-Control', 'no-store')
          return res.end(readFileSync(path))
        }
        if (!url.startsWith(DEV_MODELS_PATH)) return next()
        const files = modelFiles(decodeURIComponent(url.slice(DEV_MODELS_PATH.length)))
        const fromMod = files.map((f) => join(dir, f)).find((p) => existsSync(p))
        // Свои эмоции правятся на ходу: их не кэшируем, иначе правка не видна до сброса кэша.
        const path = fromMod ?? authoredDirs().flatMap((d) => files.map((f) => join(d, f))).find((p) => existsSync(p))
        if (!path) {
          res.statusCode = 404
          res.end('{}')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', fromMod ? 'max-age=3600' : 'no-store')
        res.end(readFileSync(path))
      })
    },
  }
}
