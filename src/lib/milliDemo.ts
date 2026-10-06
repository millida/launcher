import type { MilliItem, MilliMessage, MilliOp, MilliPack, MilliProgressEvent, MilliSession, MilliStatus } from './milli'

/*
 * Демо Милли для ?preview=user (только dev, в релиз не попадает: модуль
 * грузится динамически из ветки import.meta.env.DEV). Проекты Modrinth
 * настоящие — id, slug, иконки из ответа /v2/projects 24.09.2026.
 */

const cdn = (id: string, file: string) => 'https://cdn.modrinth.com/data/' + id + '/' + file

const DEMO_MODS: MilliItem[] = [
  { projectId: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API', icon: cdn('P7dR8mSH', 'icon.png'), why: 'Основа модов Fabric — без неё они не запустятся', source: 'modrinth', base: true },
  { projectId: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon: cdn('AANobbMI', '295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp'), why: 'Больше FPS: быстрая отрисовка мира', source: 'modrinth', base: true },
  { projectId: 'mOgUt4GM', slug: 'modmenu', title: 'Mod Menu', icon: cdn('mOgUt4GM', '5a20ed1450a0e1e79a1fe04e61bb4e5878bf1d20.png'), why: 'Список модов и их настройки прямо в меню', source: 'modrinth', base: true },
  { projectId: 'mMTOWOaA', slug: 'zombie-awareness', title: 'Zombie Awareness', icon: cdn('mMTOWOaA', 'a05ff0c2146142ba350fe458c6a9d0691cdfd0a8_96.webp'), why: 'Зомби идут на шум, свет и запах крови', source: 'modrinth', base: false },
  { projectId: 'iAqn9vit', slug: 'mo-zombies-wave', title: "Mo' Zombies Wave", icon: cdn('iAqn9vit', 'b7e0c1ad55a068448762f370349bb56cc04d249a_96.webp'), why: '13 новых видов зомби со своими повадками', source: 'modrinth', base: false },
  { projectId: 'owDBGfRd', slug: 'zombie-horse-spawn', title: 'Zombie Horse Spawn', icon: cdn('owDBGfRd', 'd78c8cbacb6bde5cfac9d65431b459216ead5071_96.webp'), why: 'Зомби-всадники на мёртвых лошадях', source: 'modrinth', base: false },
  { projectId: 'cChd25Tw', slug: 'cave-dweller-fabric', title: 'Cave Dweller Fabric', icon: cdn('cChd25Tw', '99cc719af9b3dcee0e8fcece688d7d3f6ebd49a8_96.webp'), why: 'Тварь в пещерах, которая охотится молча', source: 'modrinth', base: false },
  { projectId: 'p1WH6sHr', slug: 'from-the-fog', title: 'From The Fog', icon: cdn('p1WH6sHr', 'bb4b839b9cd0f1dc51ee5ac08081fb76df42ebe1_96.webp'), why: 'Херобрин следит из тумана', source: 'modrinth', base: false },
  { projectId: 'Pf8PJBb5', slug: 'true-darkness-refabricated', title: 'True Darkness Refabricated', icon: cdn('Pf8PJBb5', '93a5193f0aedb0d5822caa569df212f6f7360473_96.webp'), why: 'Ночь и пещеры по-настоящему чёрные', source: 'modrinth', base: false },
  { projectId: 'yBW8D80W', slug: 'lambdynamiclights', title: 'LambDynamicLights', icon: cdn('yBW8D80W', 'd4f5c3ff8df7caf024178b04eca6d69f95979cfe_96.webp'), why: 'Факел в руке освещает путь', source: 'modrinth', base: false },
  { projectId: 'qyVF9oeo', slug: 'sound-physics-remastered', title: 'Sound Physics Remastered', icon: cdn('qyVF9oeo', '798fbfae58ec95ad51f3e1d522b43227306c326c.png'), why: 'Эхо в пещерах, звук глохнет за стеной', source: 'modrinth', base: false },
  { projectId: 'fLAIO8XF', slug: 'abandoned-villages', title: '80% Abandoned Villages', icon: cdn('fLAIO8XF', '2b28d7e01921d9c314da85ff0c50ab3f02291a41.jpeg'), why: 'Почти все деревни — заброшенные и зомби', source: 'modrinth', base: false },
  { projectId: 'dxrOAhj5', slug: 'horror-messages', title: 'Horror messages', icon: cdn('dxrOAhj5', '2f352e073728145924cb3be5d33898adef7dda25_96.webp'), why: 'Жуткие сообщения в чате раз в 10–15 минут', source: 'modrinth', base: false },
]

const now = () => new Date().toISOString()
const tomorrow = () => {
  const d = new Date()
  d.setUTCHours(24, 0, 0, 0)
  return d.toISOString()
}

let used = 0
const LIMIT = 5
const sessions = new Map<string, MilliSession>()
let seq = 0

/** `&milliplus=1` — демо как у подписчика PLUS: «Улучшенная сборка» открыта. */
function demoPlus(): boolean {
  try {
    return new URLSearchParams(location.search).get('milliplus') === '1'
  } catch {
    return false
  }
}

function status(): MilliStatus {
  return {
    enabled: true,
    blocked: false,
    plus: demoPlus(),
    day: { used, limit: LIMIT, remaining: Math.max(0, LIMIT - used), resetAt: tomorrow() },
    month: { used, limit: 30, remaining: 30 - used, resetAt: tomorrow() },
    features: { extras: false, server: false, enhanced: true },
  }
}

function pack(mc: string, loader: 'fabric'): MilliPack {
  return {
    buildId: 'demo-' + ++seq,
    title: 'Ночь мертвецов',
    mcVersion: mc,
    loader,
    mods: DEMO_MODS,
    resourcepacks: [],
    shaders: [],
    shaderLoader: null,
    maps: [],
    links: [],
    excluded: [],
    notes: 'Играй ночью и держи факелы под рукой',
    locked: { extras: true },
  }
}

const msg = (role: 'user' | 'assistant', text: string, p: MilliPack | null = null, suggestions: string[] = []): MilliMessage => ({
  id: 'm' + ++seq,
  role,
  text,
  createdAt: now(),
  pack: p,
  suggestions,
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── Верстак в демо: сборка на 300 модов, ревизии и ops без бэкенда ─────────

/** `&milliSize=13` — старая маленькая демо-сборка; по умолчанию синтетика на 300. */
function demoSize(): number {
  try {
    const n = Number(new URLSearchParams(location.search).get('milliSize'))
    return Number.isFinite(n) && n > 0 ? Math.min(600, n) : 300
  } catch {
    return 300
  }
}

/** Все ревизии демо по buildId. */
const packs = new Map<string, MilliPack>()
/** Голова сессии: buildId текущей ревизии. */
const heads = new Map<string, string>()

function keep(p: MilliPack): MilliPack {
  packs.set(p.buildId, p)
  return p
}

/** Графика под ПК — как `pack.setup` сервера. */
const ramGb = (mb: number) => (Math.round((mb / 1024) * 2) / 2).toString().replace('.', ',') + ' ГБ'

function demoSetup(ramMb: number, packRam?: number): NonNullable<MilliPack['setup']> {
  const low = ramMb > 0 && ramMb < 12_000
  return {
    profile: low ? 'low' : 'balanced',
    lines: [
      { key: 'renderDistance', ru: 'Дальность прорисовки', value: low ? '8' : '12' },
      { key: 'shadows', ru: 'Тени', value: low ? 'выкл' : 'средние' },
      { key: 'maxFps', ru: 'Ограничение FPS', value: '120' },
      { key: 'ramMb', ru: 'Память', value: ramGb(packRam ?? (low ? 4096 : 6144)) },
    ],
  }
}

async function bigPack(size?: number): Promise<MilliPack> {
  const n = size && size > 0 ? Math.min(400, size) : demoSize()
  if (n < 20) return pack('1.20.1', 'fabric')
  const { demoPack, DEMO_REMOVED } = await import('../components/milli/bench/demoPack')
  const p = demoPack(n)
  // Две ревизии: r1 — до правки, r2 — с примером диффа (+2 −1 ~1), чтобы «Отменить» было что.
  const added = new Set(p.changes?.added.map((r) => r.projectId) ?? [])
  const id1 = 'demo-' + ++seq
  const r1 = keep({
    ...p,
    buildId: id1,
    chain: id1,
    rev: 1,
    parent: null,
    changes: null,
    userRemoved: [],
    mods: [...p.mods.filter((m) => !added.has(m.projectId)), DEMO_REMOVED],
    ...(p.config ? { config: { ...p.config, ramMb: 8192 } } : {}),
  })
  const RES = ['16x', '32x', '16x', '64x']
  const resourcepacks = p.resourcepacks.map((m, i) => ({ ...m, res: m.res ?? RES[i % RES.length], preview: m.preview ?? m.icon ?? undefined }))
  const shaderChoices = (p.shaderChoices ?? []).map((m) => ({ ...m, preview: m.preview ?? m.icon ?? undefined }))
  return { ...p, resourcepacks, shaderChoices, buildId: 'demo-' + ++seq, chain: id1, rev: 2, parent: r1.buildId, size: n, verified: undefined, compat: undefined, check: demoCheck(n) }
}

/** Проверка сборки по пунктам; на больших сборках иногда находится проблема. */
function demoCheck(n: number): NonNullable<MilliPack['check']> {
  const bad = n >= 200
  // Пункты и подписи — как у сервера (milli-test, 04.10).
  const items = [
    { key: 'versions', ru: 'Версии', ok: true },
    { key: 'deps', ru: 'Зависимости', ok: true },
    { key: 'conflicts', ru: 'Конфликты', ok: true },
    { key: 'duplicates', ru: 'Дубли', ok: !bad, ...(bad ? { note: 'Две мини-карты' } : {}) },
    { key: 'side', ru: 'Сторона', ok: true },
    { key: 'crashes', ru: 'Вылеты', ok: true },
  ]
  return { ok: !bad, issues: items.filter((i) => !i.ok).length, items }
}

/** Стек отмены по цепочке, как на сервере: buildId состояний, куда вернёт «Отменить». */
const undo = new Map<string, string[]>()
const stackOf = (p: MilliPack) => {
  const k = p.chain ?? p.buildId
  let st = undo.get(k)
  if (!st) undo.set(k, (st = p.parent ? [p.parent] : []))
  return st
}

/** Обычный шаг (клик, ход Милли): текущее состояние — в стек отмены. */
function stepRev(cur: MilliPack, next: MilliPack): MilliPack {
  stackOf(cur).push(cur.buildId)
  return nextRev(cur, next)
}

function nextRev(cur: MilliPack, next: MilliPack): MilliPack {
  return keep({ ...next, verified: undefined, compat: undefined, check: next.check ?? demoCheck(next.mods.length), buildId: 'demo-' + ++seq, chain: cur.chain ?? cur.buildId, rev: (cur.rev ?? 1) + 1, parent: cur.buildId, stub: false })
}

/** Шейдер нужного уровня из лестницы: у ops `shader_level` сервер выбирает его сам. */
function withShaderLevel(p: MilliPack, level: MilliPack['shaderLevel']): MilliPack {
  if (!level || level === 'off') return { ...p, shaders: [] }
  const pick = (p.shaderChoices ?? []).find((s) => s.level === level)
  return pick ? { ...p, shaders: [pick], ...(p.config ? { config: { ...p.config, shaderPack: pick.slug } } : {}) } : p
}

async function applyOps(cur: MilliPack, ops: MilliOp[]): Promise<MilliPack> {
  const bench = await import('../state/milliBench')
  bench.rememberPack(cur)
  let next = bench.projectOps(cur, ops)
  for (const o of ops) if (o.op === 'shader_level') next = withShaderLevel(next, o.level)
  if (ops.some((o) => o.op === 'profile')) {
    const prof = ops.find((o) => o.op === 'profile')
    if (prof?.op === 'profile') next = withShaderLevel(next, prof.profile === 'low' ? 'off' : prof.profile === 'high' ? 'heavy' : 'medium')
  }
  return stepRev(cur, { ...next, changes: { ...bench.diffPacks(cur, next, 'Ваши правки', 'user'), config: next.changes?.config } })
}

/** Без `to` — шаг назад по стеку; с `to` — «Вернуть» к ревизии той же цепочки. */
async function revertPack(cur: MilliPack, to?: string): Promise<MilliPack> {
  const st = stackOf(cur)
  const id = to ?? st[st.length - 1]
  const target = id ? packs.get(id) : undefined
  if (!target) throw new Error('http 409 milli_rev')
  if ((target.chain ?? target.buildId) !== (cur.chain ?? cur.buildId)) throw new Error('http 400')
  if (to) st.push(cur.buildId)
  else st.pop()
  const bench = await import('../state/milliBench')
  return nextRev(cur, { ...target, changes: bench.diffPacks(cur, target, to ? 'Вернула версию' : 'Отмена', 'user') })
}

/** Ответ Милли на правку словами: «полегче» — шейдеры на ступень ниже, иначе убрать пару тяжёлых. */
async function milliEdit(cur: MilliPack, text: string): Promise<MilliPack> {
  const bench = await import('../state/milliBench')
  bench.rememberPack(cur)
  let next: MilliPack
  let title: string
  if (/шейдер|полегч|слаб/i.test(text)) {
    const ladder = ['off', 'light', 'medium', 'heavy'] as const
    const i = Math.max(0, ladder.indexOf(cur.shaderLevel ?? 'medium') - 1)
    next = withShaderLevel({ ...cur, shaderLevel: ladder[i] }, ladder[i])
    title = 'Шейдеры полегче'
  } else {
    const heavy = cur.mods.filter((m) => m.heavy).slice(0, 2)
    next = bench.projectOps(cur, heavy.map((m) => ({ op: 'remove' as const, tab: 'mods' as const, ref: m.projectId })))
    next = { ...next, userRemoved: cur.userRemoved ?? [] }
    title = 'Убрала тяжёлое'
  }
  return stepRev(cur, { ...next, changes: bench.diffPacks(cur, next, title, 'milli') })
}

/** Стадии хода для /progress: реальные ключи, время — по таймеру демо. */
const STAGES: { key: MilliProgressEvent['key']; labelRu: string; total: number; at: number }[] = [
  { key: 'plan', labelRu: 'Поняла запрос', total: 0, at: 0 },
  { key: 'candidates', labelRu: 'Ищу моды', total: 0, at: 300 },
  { key: 'select', labelRu: 'Подбираю моды', total: 270, at: 700 },
  { key: 'deps', labelRu: 'Зависимости', total: 30, at: 1400 },
  { key: 'conflicts', labelRu: 'Проверка совместимости', total: 0, at: 1800 },
  { key: 'extras', labelRu: 'Настраиваю графику под твой ПК', total: 0, at: 2000 },
  { key: 'enrich', labelRu: 'Описания', total: 0, at: 2100 },
]
const SAMPLE = ['Create', 'JEI', 'Terralith', 'Iron Chests', 'Waystones', 'Alex\'s Mobs', 'Farmer\'s Delight', 'Supplementaries']
let turnStart = 0

function progressEvents(after: number): { running: boolean; events: MilliProgressEvent[] } {
  if (!turnStart) return { running: false, events: [] }
  const t = Date.now() - turnStart
  const events: MilliProgressEvent[] = []
  STAGES.forEach((st, i) => {
    if (t < st.at) return
    const next = STAGES[i + 1]
    const span = next ? next.at - st.at : 200
    const part = Math.min(1, (t - st.at) / span)
    // seq: стадия × 100 + шаг, чтобы счётчик рос внутри стадии.
    const step = st.total ? Math.floor(part * 10) : 10
    const s = i * 100 + step
    if (s <= after) return
    // Накопительные счётчики, как у сервера: найдено растёт на поиске, проверено — дальше.
    const found = Math.round(Math.min(1, t / 900) * 412)
    const checked = Math.round(Math.max(0, Math.min(1, (t - 700) / 1400)) * 300)
    events.push({
      seq: s,
      key: st.key,
      labelRu: st.labelRu,
      done: Math.round((st.total * step) / 10),
      total: st.total,
      found,
      checked,
      ...(st.key === 'select' || st.key === 'candidates' ? { sample: SAMPLE.slice(Math.floor(step / 3), Math.floor(step / 3) + 5) } : {}),
    })
  })
  return { running: true, events }
}

function stubOf(p: MilliPack): MilliPack {
  return {
    ...p,
    stub: true,
    mods: [],
    resourcepacks: [],
    shaders: [],
    shaderChoices: [],
    counts: { mods: p.mods.length, resourcepacks: p.resourcepacks.length, shaders: p.shaders.length },
  }
}

export async function milliDemoAnswer(path: string, init?: RequestInit): Promise<unknown> {
  const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null
  if (path === '/catalog/milli/status') return status()
  if (path === '/catalog/milli/limits') return { free: { day: 5, month: 30 }, plus: { day: 100, month: 500 }, period: 'utc', plusExtras: [] }
  if (path === '/catalog/milli/sessions') {
    return { items: [...sessions.values()].map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).reverse() }
  }
  if (path.startsWith('/catalog/milli/progress')) {
    const after = Number(/after=(\d+)/.exec(path)?.[1] ?? 0)
    const r = progressEvents(after)
    if (r.running && !r.events.length) await wait(250)
    return r.running && !r.events.length ? progressEvents(after) : r
  }
  if (path === '/catalog/milli/messages/cancel') {
    turnStart = 0
    return { ok: true, cancelled: 'running' }
  }
  const one = /^\/catalog\/milli\/sessions\/(.+)$/.exec(path)
  if (one) {
    const s = sessions.get(decodeURIComponent(one[1]!))
    if (!s) throw new Error('http 404')
    const head = heads.get(s.id)
    // Как сервер: полный пакет только у головы, у старых сообщений — stub.
    return { ...s, head, messages: s.messages.map((m) => (m.pack && m.pack.buildId !== head ? { ...m, pack: stubOf(m.pack) } : m)) }
  }
  const pk = /^\/catalog\/milli\/packs\/([^/]+)(\/ops|\/revert)?$/.exec(path)
  if (pk) {
    const cur = packs.get(decodeURIComponent(pk[1]!))
    if (!cur) throw new Error('http 404')
    if (!pk[2]) return cur
    await wait(120)
    const next = pk[2] === '/ops' ? await applyOps(cur, (body?.ops ?? []) as MilliOp[]) : await revertPack(cur, typeof body?.to === 'string' ? body.to : undefined)
    for (const [sid, h] of heads) if (h === cur.buildId) heads.set(sid, next.buildId)
    return next
  }
  if (path === '/catalog/milli/messages') {
    const text = String(body?.text || '')
    let s = body?.sessionId ? sessions.get(body.sessionId) : undefined
    const base = body?.buildId ? packs.get(body.buildId) : undefined
    // Новая сборка без размера — как сервер: сначала «Сколько модов взять?», без списания.
    const chip = /^≈?\s*(\d{1,3})\b/.exec(text.trim())
    const size = typeof body?.size === 'number' ? body.size : chip ? Number(chip[1]) : null
    if (!base && size === null && !/\d{2,3}\s*мод/i.test(text)) {
      await wait(300)
      if (!s) {
        s = { id: 's' + ++seq, title: text.slice(0, 40) || 'Новый чат', updatedAt: now(), messages: [] }
        sessions.set(s.id, s)
      }
      const user = msg('user', text)
      const reply: MilliMessage = {
        ...msg('assistant', 'Сколько модов взять? Чем больше, тем дольше загрузка и нужнее память.', null, ['≈25 · лёгкая', '≈70 · обычная', '≈150 · большая', '≈250 · огромная']),
        ask: 'size',
      }
      s.messages.push(user, reply)
      return { sessionId: s.id, user, reply, status: status() }
    }
    turnStart = Date.now()
    await wait(2400)
    if (!turnStart) throw new Error('http 409 cancelled')
    turnStart = 0
    if (used >= LIMIT) throw new Error('http 429 milli_limit day')
    used++
    if (!s) {
      s = { id: 's' + ++seq, title: text.slice(0, 40) || 'Новый чат', updatedAt: now(), messages: [] }
      sessions.set(s.id, s)
    }
    const user = msg('user', text)
    const pcRam = typeof body?.pc?.ramMb === 'number' ? body.pc.ramMb : 16_384
    const built = base ? await milliEdit(base, text) : await (async () => { const b = await bigPack(size ?? undefined); return keep({ ...b, setup: demoSetup(pcRam, b.config?.ramMb) }) })()
    const reply = base
      ? msg('assistant', 'Поправила сборку — изменения подсветила.', built, ['Ещё страшнее', 'Для слабого ПК'])
      : msg(
          'assistant',
          'Собрала сборку на ' + built.mods.length + ' модов. Графику настроила под твой ПК: дальность ' + (built.setup?.lines[0]?.value ?? '12') + ', память ' + (built.setup?.lines[3]?.value ?? '6 ГБ') + '.',
          built,
          ['Шейдеры полегче', 'Поменьше модов', 'Для слабого ПК'],
        )
    if (body?.enhanced && reply.pack) {
      reply.pack.review = {
        added: [{ title: 'Iris Shaders' }, { title: 'FerriteCore' }],
        removed: [{ title: 'Horror messages', reason: 'Спамит в чат — мешает игре с друзьями' }],
      }
    }
    heads.set(s.id, built.buildId)
    s.messages.push(user, reply)
    s.updatedAt = now()
    return { sessionId: s.id, user, reply, status: status() }
  }
  if (/\/install$/.test(path)) {
    await wait(600)
    return { code: 'MILLI7', url: 'https://millida.net/p/MILLI7', deeplink: 'millida://pack/MILLI7', files: 13, mcVersion: '1.20.1', loader: 'fabric', skipped: [] }
  }
  if (/\/server$/.test(path)) throw new Error('http 403 milli_plus')
  throw new Error('http 404')
}
