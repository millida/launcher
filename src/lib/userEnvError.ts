const PATTERNS: RegExp[] = [
  /os error 112\b/i,
  /\bENOSPC\b/i,
  /недостаточно места на диске/i,
  /не хватает места на диске/i,
  /no space left on device/i,
  /0x80070070/i,
  /disk (is )?full/i,
  /os error 1223\b/i,
  /operation was canceled by the user/i,
  /os error 1450\b/i,
  /insufficient system resources/i,
  /os error 665\b/i,
  /the media is write protected/i,
  /os error 19\b/i,
  /\bEROFS\b/i,
  /read-only file system/i,
  /\bEDQUOT\b/i,
  /disk quota exceeded/i,
  // Файл держит другая программа. Наш собственный путь такого больше не даёт
  // (mods.rs отказывает заранее и объясняет причину), остаётся чужой процесс на
  // машине игрока — антивирус, проводник, вторая копия игры.
  /os error 32\b/i,
  /файл занят другим процессом/i,
  /being used by another process/i,
  // У игрока нет связи с нашими хостами. Доступность хранилища сторожит внешний
  // мониторинг, а не жалобы клиентов с лежащим домашним интернетом: 13.08.2026
  // такие записи составили больше трёх тысяч событий и утопили в себе всё
  // остальное, что лаунчер о себе рассказывал.
  /нет связи \(/i,
  /error sending request for url/i,
  /os error 11001\b/i,
  // macOS открыл .app прямо из смонтированного образа: Gatekeeper запускает его
  // из одноразовой копии (App Translocation), и подменять там нечего. Состояние
  // машины игрока, чинится переносом в «Программы» — человеку об этом говорит
  // тост из updater.ts, алерт дежурному тут не нужен.
  /запущен из образа/i,
]

// Зеркало этого списка живёт на сервере
// (millida-services/apps/trade-api/src/common/error-log/client-environment.ts):
// старые сборки лаунчера продолжают слать сюда всё подряд, и вторым рубежом их
// разбирает бэкенд. Меняешь один — правь оба, иначе шум вернётся с той стороны.

export function isUserEnvironmentError(text: string): boolean {
  return PATTERNS.some((p) => p.test(text))
}
