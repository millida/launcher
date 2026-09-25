/// Короткий устойчивый класс ошибки для телеметрии: текст ошибки меняется от
/// версии к версии и от языка Windows, а дашборду нужен ключ, по которому
/// считать (bughunt 25.09.2026).

export type ErrorKind =
  | 'cancelled'
  | 'disk_full'
  | 'access_denied'
  | 'java_start'
  | 'java_download'
  | 'java_install'
  | 'loader_not_found'
  | 'version_not_found'
  | 'jvm_early_exit'
  | 'network_dns'
  | 'network_timeout'
  | 'network_reset'
  | 'network_other'
  | 'http_5xx'
  | 'http_4xx'
  | 'other'

// Порядок важен: сначала то, что игрок чинит сам (место, права), потом
// сценарий (Java, загрузчик, ранний выход JVM), потом сеть.
const RULES: Array<[ErrorKind, RegExp]> = [
  ['cancelled', /отмен[аеиё]н|отменил|cancell?ed|aborted by user/i],
  ['disk_full', /os error (?:112|28)\b|недостаточно места|no space left|not enough space|disk (?:is )?full|ENOSPC/i],
  ['access_denied', /os error (?:5|13|1|32)\)|отказано в доступе|access is denied|permission denied|operation not permitted|EACCES|EPERM|процесс не может получить доступ/i],
  ['java_start', /запуск java|could not find java\.dll|could not find java se runtime|failed to start java|java не запустилась/i],
  ['java_download', /(?:скачать|загрузить|download(?:ing)?) java|adoptium|temurin|azul|zulu/i],
  ['java_install', /установ\S* java|java install|распаков\S* java|os error (?:145|66)\b|папка не пуста|directory not empty/i],
  ['loader_not_found', /(?:neo)?forge[^\n]{0,40}не найден|(?:fabric|quilt|neoforge|forge)[^\n]{0,40}(?:не найден|not found)|версия (?:neo)?forge|такого билда нет|инсталлер отработал, но профиль|loader[^\n]{0,20}not found/i],
  ['version_not_found', /версия [^\n]{1,160} не найдена|version [^\n]{1,80} not found/i],
  ['jvm_early_exit', /игра не запустилась \(код|unrecognized option|could not create the java virtual machine|error opening zip file|must be enabled via -XX|FindException|could not find or load main class|boot layer|0xC0000005|exit code -?\d+/i],
  ['network_dns', /os error (?:11001|11004|-2|8)\b|хост неизвестен|dns error|failed to lookup address|no such host|name or service not known|nodename nor servname|getaddrinfo|не удается разрешить/i],
  ['network_timeout', /timed? ?out|время ожидания|os error (?:10060|60|110)\b|deadline has elapsed|не ответил вовремя/i],
  ['network_reset', /connection reset|os error (?:10054|10053|10061|54|104|111)\b|разорвал|connection (?:refused|closed|aborted)|broken pipe|unexpected eof|обрыв загрузки|error decoding response body|ответ оборвался|\bssl\b|\btls\b|certificate|сертификат/i],
  ['http_5xx', /\b5\d\d (?:bad gateway|service unavailable|internal server error|gateway time-?out)|(?:http|status|статус|код ответа|ответ)\D{0,4}5\d\d\b/i],
  ['http_4xx', /\b4\d\d (?:not found|forbidden|unauthorized|bad request|too many requests|gone)|(?:http|status|статус|код ответа|ответ)\D{0,4}4\d\d\b/i],
  ['network_other', /нет связи|error sending request|не дошли до|network|сеть недоступна|os error 10051|unreachable/i],
]

export function classifyError(text: unknown): ErrorKind {
  const s = String(text ?? '')
  if (!s) return 'other'
  for (const [kind, re] of RULES) if (re.test(s)) return kind
  return 'other'
}

// authlib-injector пишет свои INFO/DEBUG-строки в тот же вывод, и они съедали
// весь бюджет поля до настоящей ошибки (1.0.115).
const NOISE = /^\s*\[authlib-injector\]\s*\[(?:INFO|DEBUG|FINE)\].*$/gim

/// Короткая выжимка раннего выхода JVM: без шума authlib-injector, строки
/// склеены через « | ».
export function earlyExitSummary(text: string, max = 300): string {
  return String(text || '')
    .replace(NOISE, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' | ')
    .slice(0, max)
}
