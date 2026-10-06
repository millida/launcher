import { auditDeps, createProfile, deviceSpecs, installDepItems, loadProfileSettings, saveProfileSettings } from '../ipc/commands'
import type { DepReport, MilliOptionsReport } from '../ipc/commands'
import { hasTauri, tauri } from '../ipc/tauri'
import { auditFixItems, auditProblems } from './aiBuilder'
import { DEMO_USER } from './demo'
import { keyContent } from './installKeys'
import { milliItems } from './milli'
import type { MilliChosen, MilliConfig, MilliLoader, MilliPack } from './milli'
import { benchChosen, clampOption, jvmArgsFor, ramGbFor } from '../components/milli/bench/benchTabs'
import { track } from './telemetry'
import { runInstall, useInstalls } from '../state/installs'
import { useMods } from '../state/mods'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'

/*
 * Сборка из плана ИИ: профиль под версию и загрузчик, затем моды, ресурспаки и
 * шейдеры заданиями ядра (`install_dep_items` — каждый мод со своими
 * обязательными). Перенесено из старого одноразового ИИ-сборщика каталога;
 * теперь его зовёт карточка сборки Милли.
 */

interface Step {
  kind: 'mod' | 'resourcepack' | 'shader'
  label: string
  running: string
  items: import('../ipc/commands').PlanItem[]
  /** Installs what the audit of the installed jars found missing instead of `items`. */
  audit?: boolean
}

/**
 * Modrinth pages often omit a library the jar itself requires (YACL, Kotlin,
 * Architectury), and the pack then stops on its first start. The installed jars
 * are the truth, so they are audited once more before the pack is called ready.
 */
async function installAuditFixes(profile: string): Promise<DepReport> {
  const first = await auditDeps(profile)
  const items = auditFixItems(first)
  if (!items.length) return { installed: [], failed: auditProblems(first) }
  const fixed = await installDepItems(profile, 'mod', items)
  return { installed: fixed.installed, failed: [...fixed.failed, ...auditProblems(await auditDeps(profile))] }
}

/**
 * Каждый вид — своё задание ядра со своим ключом: ядро закрывает задание по
 * ключу, и ресурспаки под ключом модов показали бы «Установлено» раньше времени.
 * `chosen.mods` уже с базовыми первыми и загрузчиком шейдеров (`milliChosen`).
 */
function installSteps(chosen: MilliChosen): Step[] {
  const steps: Step[] = [
    { kind: 'mod', label: 'Моды', running: 'Ставим моды…', items: milliItems(chosen.mods) },
    { kind: 'mod', label: 'Зависимости', running: 'Проверяем зависимости…', items: [], audit: chosen.mods.length > 0 },
    { kind: 'resourcepack', label: 'Ресурспаки', running: 'Ставим ресурспаки…', items: milliItems(chosen.resourcepacks) },
    { kind: 'shader', label: 'Шейдеры', running: 'Ставим шейдеры…', items: milliItems(chosen.shaders) },
  ]
  return steps.filter((s) => s.items.length || s.audit)
}

export interface AiBuildTarget {
  title: string
  mcVersion: string
  loader: MilliLoader
  /** Ревизия верстака: убранное игроком не ставим, даже если оно осталось в `chosen`. */
  userRemoved?: string[]
  /** Настройки сборки Милли: ОЗУ и JVM применяются к профилю после создания. */
  config?: MilliConfig
  /** Загрузчик шейдеров сборки: Oculus читает config/oculus.properties, Iris — iris.properties. */
  shaderLoader?: { slug: string } | null
}

/** Ключи options.txt из конфига сборки: белый список, по умолчанию русский язык. */
export function milliOptionsOf(cfg: MilliConfig): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg.options ?? {})) {
    const ok = clampOption(k, String(v))
    if (ok !== null) out[k] = ok
  }
  out.lang ??= 'ru_ru'
  return out
}

/**
 * options.txt и включённый шейдер — командой ядра `apply_milli_options`. Ядро
 * без неё (старая сборка лаунчера) отвечает «not found» — тихо пропускаем: те
 * же файлы есть в .mrpack. Зовём ядро напрямую, мимо обёртки commands.ts: её
 * отчёт о сбое команды слал бы «нет такой команды» на каждую установку.
 */
async function applyMilliGraphics(profile: string, cfg: MilliConfig, shader: { loader: 'iris' | 'oculus'; file: string } | null): Promise<void> {
  const T = tauri()
  if (!T) return
  try {
    const r = await T.core.invoke<MilliOptionsReport>('apply_milli_options', { profile, options: milliOptionsOf(cfg), shader })
    if (r.kept.length && import.meta.env.DEV) console.info('[aiInstall] options.txt: игрок менял', r.kept.join(', '))
  } catch (e) {
    if (/not found|unknown command|not allowed/i.test(String(e))) return
    console.warn('[aiInstall] apply_milli_options', e)
  }
}

/**
 * Текст ошибки ядра для тоста: русский (ядро так пишет свои отказы) — как есть,
 * английский сырой текст — короткой русской фразой, а оригинал — в консоль.
 */
function errRu(e: unknown, fallback: string): string {
  const raw = String((e as { message?: unknown })?.message ?? e ?? '').trim()
  if (raw && /[а-яё]/i.test(raw)) return raw.slice(0, 160)
  console.warn('[aiInstall]', fallback, e)
  return fallback
}

/** Убранное игроком в верстаке (`userRemoved`) не ставится — даже из старой карточки. */
function withoutRemoved(chosen: MilliChosen, removed: string[] | undefined): MilliChosen {
  if (!Array.isArray(removed) || !removed.length) return chosen
  const gone = new Set(removed)
  const keep = (l: MilliChosen['mods']) => l.filter((m) => !gone.has(m.projectId))
  return { mods: keep(chosen.mods), resourcepacks: keep(chosen.resourcepacks), shaders: keep(chosen.shaders) }
}

/**
 * Настройки Милли без правки Rust: ОЗУ — ползунком профиля (`m-ram-<имя>`, его
 * читает запуск, `lib/launch.ts ramMbFor`), JVM — `save_profile_settings`
 * (ширину, высоту и путь к Java сохраняем как были). options.txt и
 * iris.properties сюда не пишем: команды ядра для них нет — они едут в
 * overrides серверного .mrpack. Сбой тут не мешает установке модов.
 */
async function applyMilliConfig(profile: string, cfg: MilliConfig): Promise<void> {
  if (Number.isFinite(cfg.ramMb) && cfg.ramMb > 0) {
    const total = await deviceSpecs()
      .then((s) => s.ram_mb || 0)
      .catch(() => 0)
    try {
      localStorage.setItem('m-ram-' + profile, String(ramGbFor(cfg.ramMb, total)))
    } catch {}
  }
  const args = jvmArgsFor(cfg.jvm)
  if (args) {
    const s = await loadProfileSettings(profile).catch(() => null)
    await saveProfileSettings(profile, args, s?.width ?? 0, s?.height ?? 0, s?.javaPath ?? '').catch((e) =>
      showToast('Флаги JVM: ' + errRu(e, 'не сохранились'), 'error'),
    )
  }
}

/** Демо в браузере: тот же прогресс, что даёт ядро, без ядра. */
function demoInstall(name: string, total: number, onDone: (name: string) => void): string {
  const key = 'ai-demo:' + name
  const st = useInstalls.getState()
  st.patch(key, { title: name, label: 'Ставим моды…', pct: 2, msg: '', state: 'run' })
  let i = 0
  const t = setInterval(() => {
    i++
    if (i > total) {
      clearInterval(t)
      useInstalls.getState().patch(key, { label: 'Установлено', pct: 100, msg: '', state: 'done' })
      onDone(name)
      return
    }
    useInstalls.getState().patch(key, { pct: 5 + (90 * i) / total, msg: 'Ставим ' + i + '/' + total + '…' })
  }, 260)
  return key
}

/**
 * Создаёт сборку и запускает установку. `onStep` получает ключ задания ядра
 * (для полосы прогресса), `onDone` — имя созданной сборки и что не встало.
 * false — установка не началась.
 */
export async function createAiBuild(
  plan: AiBuildTarget,
  title: string,
  chosen: MilliChosen,
  onStep: (key: string) => void,
  onDone: (name: string, failed: string[]) => void,
  onFail: () => void,
  from = 'milli',
): Promise<boolean> {
  const name = (title.trim() || plan.title).slice(0, 24)
  const picked = withoutRemoved(chosen, plan.userRemoved)
  const steps = installSteps(picked)
  if (!steps.length) return false
  if (!hasTauri()) {
    if (import.meta.env.DEV && DEMO_USER) {
      onStep(demoInstall(name, steps.reduce((n, s) => n + s.items.length, 0), (built) => onDone(built, [])))
      return true
    }
    showToast('Сборки создаются в приложении')
    return false
  }
  let created = ''
  try {
    const p = await createProfile(name, plan.mcVersion, plan.loader === 'fabric', plan.loader, null)
    created = p.name
  } catch (e) {
    showToast('Не удалось создать сборку: ' + errRu(e, 'ошибка лаунчера'), 'error')
    return false
  }
  if (plan.config) await applyMilliConfig(created, plan.config)
  track('build_create', {
    mc: plan.mcVersion,
    loader: plan.loader,
    from,
    mods: picked.mods.length,
    resourcepacks: picked.resourcepacks.length,
    shaders: picked.shaders.length,
  })
  await useProfiles.getState().refresh()
  useProfiles.getState().setSelected(created)
  useMods.getState().scopeTo(created)

  // Имя zip шейдера — то, что вернула его установка: оно и пишется в iris.properties.
  let shaderFile = ''
  const cfg = plan.config
  const finish = (failed: string[]) => {
    const loader = plan.shaderLoader?.slug === 'oculus' ? 'oculus' : 'iris'
    const graphics = cfg ? applyMilliGraphics(created, cfg, shaderFile ? { loader, file: shaderFile } : null) : Promise.resolve()
    void graphics.finally(() => {
      void useMods.getState().refreshInstalled()
      void useMods.getState().load()
      if (failed.length) showToast('Не встало: ' + failed.slice(0, 3).join('; '), 'error')
      onDone(created, failed)
    })
  }
  const runStep = (i: number, failed: string[]): boolean => {
    const step = steps[i]
    if (!step) {
      finish(failed)
      return true
    }
    const key = keyContent('mr', created, step.kind, 'millida:deps')
    const started = runInstall<DepReport>({
      key,
      title: created,
      running: step.running,
      run: () => (step.audit ? installAuditFixes(created) : installDepItems(created, step.kind, step.items)),
      onDone: (r) => {
        if (step.kind === 'shader' && r.installed[0]) shaderFile = r.installed[0]
        const next = [...failed, ...r.failed]
        if (!runStep(i + 1, next)) finish(next)
      },
      onError: (e) => {
        // Моды уже в сборке: сбой ресурспаков или шейдеров — строка в итоге, а не повод собирать заново.
        if (i === 0) {
          showToast(errRu(e, 'Моды не встали — попробуй ещё раз'), 'error')
          onFail()
        } else {
          const next = [...failed, step.label + ': ' + errRu(e, 'не встали')]
          if (!runStep(i + 1, next)) finish(next)
        }
      },
    })
    if (started) onStep(key)
    return started
  }
  return runStep(0, [])
}

/**
 * Установка из верстака: ставится ровно head-ревизия (убранное игроком уже
 * вырезано сервером, `benchChosen` страхует), один активный шейдер и его
 * загрузчик, плюс ОЗУ/JVM и графика из `pack.config`. Возвращает то же, что `createAiBuild`.
 */
export function installBench(
  head: MilliPack,
  title: string,
  onStep: (key: string) => void,
  onDone: (name: string, failed: string[]) => void,
  onFail: () => void,
): Promise<boolean> {
  return createAiBuild(head, title, benchChosen(head), onStep, onDone, onFail, 'bench')
}
