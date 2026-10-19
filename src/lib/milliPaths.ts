/*
 * Какие файлы сборки Милли вообще может писать: options.txt и текстовые
 * конфиги внутри config/. Те же правила держит ядро (milli_file_path в
 * milli_local.rs); здесь та же проверка до вызова ядра — чтобы шаг с
 * чужим путём не дошёл даже до IPC.
 */
const CONFIG_EXTS = ['toml', 'json', 'json5', 'properties', 'cfg', 'txt', 'yaml', 'yml', 'snbt', 'conf', 'ini']

export function milliPathOk(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw || raw.length > 260 || /[\0\r\n]/.test(raw)) return false
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  // Абсолютные пути и диски (C:/, //сервер).
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false
  if (p === 'options.txt') return true
  if (!p.startsWith('config/')) return false
  const parts = p.split('/')
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return false
  const file = parts[parts.length - 1]
  const dot = file.lastIndexOf('.')
  return dot > 0 && CONFIG_EXTS.includes(file.slice(dot + 1).toLowerCase())
}
