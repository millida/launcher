/// Что уходит в телеметрию, не должно выдавать человека: имя пользователя в
/// путях, названия его сборок и серверов (аудит 24.09.2026).

const USER_PATH = /[A-Z]:\\Users\\[^\\]+|\/Users\/[^/]+|\/home\/[^/]+/gi

/// Код ошибки без домашней папки: «C:\Users\Вася\…» → «<user>\…».
export function scrubPaths(s: string): string {
  return s.replace(USER_PATH, '<user>')
}

/// Текст ошибки для события телеметрии.
export const errorCode = (err: unknown, max = 120): string => scrubPaths(String(err)).slice(0, max)

/// Короткий необратимый отпечаток строки (FNV-1a 32 бита): одинаковые сборки
/// склеиваются в отчётах, а имя в них не видно.
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/// Сборка в телеметрии: сборка каталога — по слагу, своя — только отпечаток имени.
export function buildTag(name: string | null | undefined, catalogSlug?: string | null): string | null {
  if (!name) return null
  if (catalogSlug) return 'catalog:' + String(catalogSlug).slice(0, 80)
  return 'custom:' + shortHash(name)
}
