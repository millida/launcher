import { auditDeps, createProfile, installDepItems } from '../ipc/commands'
import type { DepReport } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { auditFixItems, auditProblems } from './aiBuilder'
import { DEMO_USER } from './demo'
import { keyContent } from './installKeys'
import { milliItems } from './milli'
import type { MilliChosen, MilliLoader } from './milli'
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
  const steps = installSteps(chosen)
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
    showToast('Не удалось создать сборку: ' + e, 'error')
    return false
  }
  track('build_create', {
    mc: plan.mcVersion,
    loader: plan.loader,
    from,
    mods: chosen.mods.length,
    resourcepacks: chosen.resourcepacks.length,
    shaders: chosen.shaders.length,
  })
  await useProfiles.getState().refresh()
  useProfiles.getState().setSelected(created)
  useMods.getState().scopeTo(created)

  const finish = (failed: string[]) => {
    void useMods.getState().refreshInstalled()
    void useMods.getState().load()
    if (failed.length) showToast('Не встало: ' + failed.slice(0, 3).join('; '), 'error')
    onDone(created, failed)
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
        const next = [...failed, ...r.failed]
        if (!runStep(i + 1, next)) finish(next)
      },
      onError: (e) => {
        // Моды уже в сборке: сбой ресурспаков или шейдеров — строка в итоге, а не повод собирать заново.
        if (i === 0) {
          showToast('' + e, 'error')
          onFail()
        } else {
          const next = [...failed, step.label + ': ' + e]
          if (!runStep(i + 1, next)) finish(next)
        }
      },
    })
    if (started) onStep(key)
    return started
  }
  return runStep(0, [])
}
