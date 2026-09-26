export type ReportChannel = 'crash' | 'core' | 'install'

// The backend throttles POST /errors at 30 a minute, and the plain UI channel in
// crash.ts already spends up to 10 of them.
export const REPORT_BUDGET: Record<ReportChannel, number> = { crash: 5, core: 8, install: 5 }

export const MESSAGE_MAX = 500
export const STACK_MAX = 12_000
const VERDICT_MAX = 160
const MODS_IN_MESSAGE = 5
const MOD_NAME_MAX = 60
const ARG_MAX = 120
const MASK_MIN = 4

export interface ReportGate {
  admit(channel: ReportChannel, key: string): boolean
}

// Each channel counts on its own, so a storm of one kind cannot spend the
// reports of another; a repeat of the same text costs nothing and goes nowhere.
export function createReportGate(budget: Record<ReportChannel, number> = REPORT_BUDGET): ReportGate {
  const used: Record<ReportChannel, number> = { crash: 0, core: 0, install: 0 }
  const seen = new Set<string>()
  return {
    admit(channel, key) {
      const id = channel + '\n' + key
      if (seen.has(id) || used[channel] >= budget[channel]) return false
      seen.add(id)
      used[channel] += 1
      return true
    },
  }
}

const REDACTED = '<redacted>'

const SECRET_RULES: Array<[RegExp, string]> = [
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, REDACTED],
  [/\b[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}\b/g, REDACTED],
  [/\b(Bearer)\s+[\w.~+/=-]+/gi, '$1 ' + REDACTED],
  [/(--(?:accessToken|clientToken|session|username|uuid|xuid)[\s,=]+)[^\s,\]]+/gi, '$1' + REDACTED],
  [
    /\b([\w-]*?(?:token|passw(?:or)?d|secret|session(?:[_-]?id)?|api[_-]?key|signature)|x-amz-[\w-]+|sig|key-pair-id)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    '$1$2' + REDACTED,
  ],
  [/(Setting user:\s*)\S+/gi, '$1<nick>'],
  [/[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\r\n"'<>|:*?]+(?=[\\/])/gi, '~'],
  [/[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s"'<>|:*?,;)\]]+/gi, '~'],
  [/\/(?:home|Users)\/[^/\s"'<>]+/g, '~'],
]

export function redactSecrets(text: string): string {
  let out = text || ''
  for (const [re, to] of SECRET_RULES) out = out.replace(re, to)
  return out
}

export function maskValues(text: string, pairs: Array<[string | null | undefined, string]>): string {
  let out = text
  const usable = pairs
    .map(([value, placeholder]) => [(value || '').trim(), placeholder] as const)
    .filter(([value]) => value.length >= MASK_MIN)
    .sort((a, b) => b[0].length - a[0].length)
  for (const [value, placeholder] of usable) out = out.split(value).join(placeholder)
  return out
}

export function errorText(err: unknown): string {
  let raw: string
  if (err instanceof Error) raw = err.message
  else if (typeof err === 'string') raw = err
  else {
    try {
      raw = JSON.stringify(err) ?? String(err)
    } catch {
      raw = String(err)
    }
  }
  return raw.replace(/^Error:\s*/, '').trim()
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) || ''
  )
}

// A message is the grouping key on the server: a hash or a signed link in it
// would turn one fault into a new alert per file.
function steady(line: string): string {
  return line
    .replace(/\b(https?:\/\/[^/\s?#"']+)[^\s"']*/gi, '$1/…')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function failureMessage(label: string, text: string, masks: Array<[string | null | undefined, string]>): string {
  return (label + ': ' + steady(firstLine(maskValues(redactSecrets(text), masks)))).slice(0, MESSAGE_MAX)
}

export function failureDetails(text: string): string | undefined {
  const full = redactSecrets(text).trim()
  if (!full.includes('\n') && full.length <= MESSAGE_MAX) return undefined
  return tailForReport(full)
}

export function tailForReport(text: string, max = STACK_MAX): string {
  return text.length > max ? text.slice(text.length - max) : text
}

export function verdictOf(reason: string): string {
  const flat = (reason || '').replace(/\s+/g, ' ').trim()
  const m = /^.*?[.!?…](?=\s|$)/.exec(flat)
  return (m ? m[0] : flat).slice(0, VERDICT_MAX)
}

const JAVA_THROWABLE = /\b(?:[a-zA-Z_$][\w$]*\.)+(?:[A-Z][\w$]*)?(?:Exception|Error|Throwable)\b/
const JVM_SIGNAL = /\b(?:EXCEPTION_[A-Z_]+|SIG(?:SEGV|BUS|ILL|FPE|ABRT))\b/

export function throwableOf(tail: string): string {
  const text = tail || ''
  const java = JAVA_THROWABLE.exec(text)
  if (java) return java[0]
  const signal = JVM_SIGNAL.exec(text)
  return signal ? signal[0] : ''
}

// A jar name carries its version, and a crash of the same mod after an update
// is the same crash.
export function modName(file: string): string {
  const base = (file || '').split(/[\\/]/).pop() || ''
  const bare = base.replace(/(\.disabled)+$/i, '').replace(/\.jar$/i, '')
  const cut = bare.search(/[-_+ ]v?\d/i)
  return (cut > 0 ? bare.slice(0, cut) : bare).toLowerCase().slice(0, MOD_NAME_MAX)
}

export interface CrashFacts {
  reason: string
  catalogPack?: string | null
  culprits?: string[] | null
  tail?: string | null
}

export function gameCrashMessage(f: CrashFacts): string {
  const parts = [verdictOf(f.reason) || 'Игра вылетела']
  if (f.catalogPack) parts.push('сборка ' + f.catalogPack)
  const thrown = throwableOf(f.tail || '')
  if (thrown) parts.push(thrown)
  const mods = [...new Set((f.culprits || []).map(modName).filter(Boolean))].sort().slice(0, MODS_IN_MESSAGE)
  if (mods.length) parts.push('моды: ' + mods.join(', '))
  return parts.join(' | ').slice(0, MESSAGE_MAX)
}

export function javaMajorOf(version: string | null | undefined): number | null {
  const text = version || ''
  const quoted = text.split('"')[1] ?? text
  const m = /(\d+)(?:[._+-](\d+))?/.exec(quoted)
  if (!m) return null
  const head = Number(m[1])
  return head === 1 && m[2] ? Number(m[2]) : head
}

export type RamSource = 'slider' | 'pinned' | 'auto' | 'half-of-machine'

// Same order the core resolves the heap in (engine/game/tuning.rs, tuned_ram_mb).
export function ramChoice(
  requestedMb: number,
  pinnedMb: number,
  autoTune: boolean,
  autoMb: number | null,
): { ramMb: number | null; ramSource: RamSource } {
  if (requestedMb > 0) return { ramMb: requestedMb, ramSource: 'slider' }
  if (pinnedMb > 0) return { ramMb: pinnedMb, ramSource: 'pinned' }
  if (autoTune) return { ramMb: autoMb && autoMb > 0 ? autoMb : null, ramSource: 'auto' }
  return { ramMb: null, ramSource: 'half-of-machine' }
}

export interface InstallTarget {
  kind: string
  profile: string | null
  catalogPack: string | null
}

// Keys come from engine/core/jobs.rs and src/lib/installKeys.ts.
export function installTarget(key: string): InstallTarget {
  const parts = (key || '').split(':')
  const kind = parts[0] || 'install'
  const rest = parts.slice(1)
  if (kind === 'catalog-pack') return { kind, profile: null, catalogPack: rest.join(':') || null }
  if (kind === 'migrate' || kind === 'millida-mod') return { kind, profile: rest.join(':') || null, catalogPack: null }
  if (kind === 'mr-modpack') return { kind, profile: rest.slice(1).join(':') || null, catalogPack: null }
  if (kind === 'cf-modpack') return { kind, profile: null, catalogPack: null }
  if (/^(mr|cf)-[a-z]+$/.test(kind) && rest.length >= 2) return { kind, profile: rest[0] || null, catalogPack: null }
  return { kind, profile: null, catalogPack: null }
}

const SAFE_ARG_KEYS = [
  'profile',
  'name',
  'newName',
  'kind',
  'source',
  'project',
  'versionId',
  'modId',
  'fileId',
  'gameVersion',
  'version',
  'loader',
  'loaderVersion',
  'slug',
  'major',
  'ramMb',
] as const

// Arguments of a command are whatever the webview passed: tokens, codes, file
// contents and paths never leave the machine, only the identifiers below do.
export function safeArgs(args?: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (!args) return out
  for (const key of SAFE_ARG_KEYS) {
    const v = args[key]
    if (typeof v === 'string' && v) out[key] = redactSecrets(v).slice(0, ARG_MAX)
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }
  return out
}

const JOB_REPORTED = 'job-backed install: its failure arrives as InstallFailed from the job progress event'
const API_ANSWER = 'thin proxy to our API: it logs its own 5xx, a 4xx is its answer to the player'
const PLAYER_INPUT = 'probes what the player typed or picked: a refusal is the answer shown to them'

export const EXPECTED_BY_COMMAND: Record<string, { why: string; when?: RegExp }> = {
  millida_api: {
    why: 'transport of every API call and of this report: the API logs its own 5xx, unhandled rejections already arrive as "promise:"',
  },
  app_version: { why: 'read by the reporter itself; a failure would report itself in a loop' },
  update_fallback_check: { why: 'updater.ts reports it as updater-fallback' },
  update_fallback_stage: { why: 'updater.ts reports it as updater-fallback' },
  update_fallback_run: { why: 'updater.ts reports it as updater-fallback' },
  install_catalog_pack: { why: JOB_REPORTED },
  update_catalog_pack: { why: JOB_REPORTED },
  install_content: { why: JOB_REPORTED },
  install_mod: { why: JOB_REPORTED },
  install_version: { why: JOB_REPORTED },
  install_modpack: { why: JOB_REPORTED },
  install_modpack_version: { why: JOB_REPORTED },
  update_modpack: { why: JOB_REPORTED },
  cf_install: { why: JOB_REPORTED },
  cf_install_world: { why: JOB_REPORTED },
  cf_install_modpack: { why: JOB_REPORTED },
  install_dep_items: { why: JOB_REPORTED },
  millida_mod_install: { why: JOB_REPORTED },
  migrate_profile: { why: JOB_REPORTED },
  millida_packs: { why: API_ANSWER },
  pack_buy_url: { why: API_ANSWER },
  my_packs: { why: API_ANSWER },
  unshare_profile: { why: API_ANSWER },
  cloud_status: { why: API_ANSWER },
  cloud_forget: { why: API_ANSWER },
  ping_server: { why: 'an offline or unreachable server is the answer the server list shows' },
  mc_textures: { why: 'looks up an arbitrary nick: "no such player" is the answer' },
  head_avatar: { why: 'head of an arbitrary nick from an outside service; a miss falls back to the placeholder' },
  test_java: { why: PLAYER_INPUT },
  fetch_texture: { why: PLAYER_INPUT },
  pack_preview: { why: PLAYER_INPUT },
  redeem_pack_key: { why: PLAYER_INPUT },
  set_game_dir: { why: 'the folder the player picked is unreachable or read-only', when: /^(Папка недоступна|Нет прав на запись):/ },
}

export const EXPECTED_ANYWHERE: Array<[RegExp, string]> = [
  [/Установка отменена|Запуск отменён/, 'the player cancelled'],
  [/уже идёт — дождись/, 'the same job is already running'],
  [/Сборка сейчас запущена — закрой игру|^Запущенной игры нет$/, 'the game is running, or already gone, when the player acted'],
  [/^(unauthorized|http 401)$|нет токена Millida|вход по лицензии Microsoft устарел/, 'the session ended; the re-login flow takes it from here'],
  [/^(pack-access|off-platform): /, 'a verdict the UI turns into its own window'],
  [
    /Сборка с таким именем уже есть|Папка с таким именем уже занята|Имя не может быть пустым|Название мира не может быть пустым|^пустое имя$|^пустой ник$/,
    'a name the player typed',
  ],
  [/Такого кода не бывает|Некорректный код сборки/, 'a share code the player typed'],
  [/Мод выключен в настройках лаунчера/, "the player's own setting"],
  [/Эта Java нужна одной из сборок/, 'refusing to remove a runtime in use is by design'],
  [
    /Нужен сам файл java|По этому пути файла java нет|Это одиночный файл java|Эту Java лаунчер ещё не проверял/,
    'a Java path the player typed',
  ],
  [
    /это не PNG|По ссылке не PNG|не PNG или слишком большой|PNG больше|PNG слишком большой|скин слишком большой|скин меньше 64 пикселей|Картинка больше \d+ МБ/,
    'a picture the player picked',
  ],
  [
    /Это не файл бэкапа|level\.dat не похож на файл мира|В выбранной папке нет файлов игры|в более новой версии лаунчера — обнови лаунчер|Файл карты не в формате zip|В архиве нет мира/,
    'a file the player brought in is not what the import expects',
  ],
]

export function expectedFailure(text: string, cmd?: string): string | null {
  if (cmd) {
    const rule = EXPECTED_BY_COMMAND[cmd]
    if (rule && (!rule.when || rule.when.test(text))) return rule.why
  }
  for (const [re, why] of EXPECTED_ANYWHERE) if (re.test(text)) return why
  return null
}
