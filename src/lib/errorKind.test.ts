import { expect, test } from 'bun:test'
import { classifyError, earlyExitSummary } from './errorKind'

// Тексты — из прод-телеметрии 22–25.09.2026 (error where=launch).
const CASES: Array<[string, string]> = [
  ['Отказано в доступе. (os error 5)', 'access_denied'],
  ['Запуск Java: Access is denied. (os error 5)', 'access_denied'],
  ['Недостаточно места на диске. (os error 112)', 'disk_full'],
  ['No space left on device (os error 28)', 'disk_full'],
  ['Не удалось установить Java: Папка не пуста. (os error 145)', 'java_install'],
  ['Directory not empty (os error 66)', 'java_install'],
  ['Не удалось скачать Java 17 — Adoptium: нет связи (operation timed out — сервер не ответил вовремя)', 'java_download'],
  ['Не удалось скачать Java 8 — Adoptium: нет сборки JRE для этой системы; Azul: https://cdn.azul.com/zulu/bin/x', 'java_download'],
  ['Игра не запустилась (код Some(2)).\nError: could not find java.dll', 'java_start'],
  ['NeoForge для этой версии не найден', 'loader_not_found'],
  ['Forge для этой версии не найден', 'loader_not_found'],
  ['Версия Fabric 26.1.2 не найдена', 'loader_not_found'],
  ['Версия neoforge-21.1.250 не найдена', 'loader_not_found'],
  ['Инсталлер отработал, но профиль 1.12.2-forge-14.23.5.2864 не появился', 'loader_not_found'],
  ['neoforge-47.1.101: такого билда нет в репозитории загрузчика', 'loader_not_found'],
  ['Версия <build> не найдена', 'version_not_found'],
  ['Игра не запустилась (код Some(1)).\nError opening zip file or JAR manifest missing : <user>/AppData/x', 'jvm_early_exit'],
  ['Игра не запустилась (код Some(1)).\nUnrecognized option: --sun-misc-unsafe-memory-access=allow', 'jvm_early_exit'],
  ['нет связи (Этот хост неизвестен. (os error 11001) — соединение не установилось) — https://meta.fabricmc.net', 'network_dns'],
  ['нет связи (operation timed out — сервер не ответил вовремя: проверь интернет и VPN) — https://piston-meta.mojang.com/v1/', 'network_timeout'],
  ['нет связи (Удаленный хост принудительно разорвал существующее подключение. (os error 10054))', 'network_reset'],
  ['https://piston-data.mojang.com/v1/objects/x/client.jar: обрыв загрузки (error decoding response body)', 'network_reset'],
  ['502 Bad Gateway от https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fmeta.fabricmc.net', 'http_5xx'],
  ['http 503', 'http_5xx'],
  ['http 404', 'http_4xx'],
  ['1.20.1-forge-47.4.23: не дошли до maven за контрольной суммой инсталлера (error sending request for url (https://maven.m', 'network_other'],
  ['Запуск отменён', 'cancelled'],
  ['Cannot read properties of undefined', 'other'],
  ['', 'other'],
]

test('classifyError раскладывает прод-ошибки по классам', () => {
  for (const [text, kind] of CASES) expect([text, classifyError(text)]).toEqual([text, kind])
})

test('earlyExitSummary убирает шум authlib-injector', () => {
  const raw =
    'Игра не запустилась (код Some(1)).\n[authlib-injector] [INFO] Logging file: C:\\Users\\a\\x.log\n[authlib-injector] [INFO] Version: 1.2.5\nError: Could not create the Java Virtual Machine.\nUnrecognized option: -p'
  const s = earlyExitSummary(raw)
  expect(s).not.toContain('authlib')
  expect(s).toBe('Игра не запустилась (код Some(1)). | Error: Could not create the Java Virtual Machine. | Unrecognized option: -p')
  expect(earlyExitSummary('x'.repeat(1000)).length).toBe(300)
})
