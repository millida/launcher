import { useEffect, useMemo, useRef, useState } from 'react'
import { PxIcon } from '../PxIcon'
import { auditDeps, createProfile, installDepItems } from '../../ipc/commands'
import type { DepReport, PlanItem } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { mirrorAsset } from '../../lib/api'
import {
  AI_EXAMPLES,
  LOCKED_SLUGS,
  PROMPT_MAX,
  PROMPT_MIN,
  aiErrorText,
  aiQuota,
  auditFixItems,
  auditProblems,
  buildPlan,
  excludedLines,
  planRequestKey,
} from '../../lib/aiBuilder'
import type { AiMod, AiPlan, AiPreset, AiQuota } from '../../lib/aiBuilder'
import { DEMO_USER } from '../../lib/demo'
import { keyContent } from '../../lib/installKeys'
import { realLaunch, startPrelaunch } from '../../lib/launch'
import { track } from '../../lib/telemetry'
import { runInstall, useInstalls } from '../../state/installs'
import { useMods } from '../../state/mods'
import { useProfiles } from '../../state/profiles'
import { showToast } from '../../state/ui'
import '../../styles/pixel/catalog2.css'

/*
 * ИИ-сборщик наверху каталога: запрос словами → план из настоящих модов
 * Modrinth → «Создать сборку» ставит всё одним заходом ядра
 * (`install_dep_items` — каждый мод со своими обязательными зависимостями).
 */

type Phase = 'idle' | 'busy' | 'plan' | 'install' | 'done'

const LOADER: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }

const play = (name: string) => (hasTauri() ? realLaunch(name) : startPrelaunch(name))

interface Chosen {
  mods: AiMod[]
  resourcepacks: AiMod[]
  shaders: AiMod[]
}

interface Step {
  kind: 'mod' | 'resourcepack' | 'shader'
  label: string
  running: string
  items: PlanItem[]
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

const toItems = (list: AiMod[]): PlanItem[] => list.map((m) => ({ source: 'modrinth', project_id: m.projectId }))

/** Моды плана плюс Iris/Oculus, если отмечен хоть один шейдер: без загрузчика шейдер не заработает. */
function modsToInstall(plan: AiPlan, chosen: Chosen): AiMod[] {
  const loader = plan.shaderLoader
  if (!chosen.shaders.length || !loader || chosen.mods.some((m) => m.projectId === loader.projectId)) return chosen.mods
  return [...chosen.mods, loader]
}

/**
 * Каждый вид — своё задание ядра со своим ключом: ядро закрывает задание по
 * ключу, и ресурспаки под ключом модов показали бы «Установлено» раньше времени.
 */
function installSteps(plan: AiPlan, chosen: Chosen): Step[] {
  // Базовые первыми: Fabric API встаёт до модов, которые его требуют, и
  // ядро не качает его второй раз как зависимость.
  const mods = [...modsToInstall(plan, chosen)].sort((a, b) => Number(b.base) - Number(a.base))
  const steps: Step[] = [
    { kind: 'mod', label: 'Моды', running: 'Ставим моды…', items: toItems(mods) },
    { kind: 'mod', label: 'Зависимости', running: 'Проверяем зависимости…', items: [], audit: mods.length > 0 },
    { kind: 'resourcepack', label: 'Ресурспаки', running: 'Ставим ресурспаки…', items: toItems(chosen.resourcepacks) },
    { kind: 'shader', label: 'Шейдеры', running: 'Ставим шейдеры…', items: toItems(chosen.shaders) },
  ]
  return steps.filter((s) => s.items.length || s.audit)
}

/** Сборка из плана: профиль под версию и загрузчик, затем моды, ресурспаки и шейдеры заданиями ядра. */
async function createAiBuild(
  plan: AiPlan,
  title: string,
  chosen: Chosen,
  onStep: (key: string) => void,
  onDone: (name: string, failed: string[]) => void,
  onFail: () => void,
): Promise<boolean> {
  const name = (title.trim() || plan.title).slice(0, 24)
  const steps = installSteps(plan, chosen)
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
    from: 'ai',
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

type LineKind = 'mod' | 'resourcepack' | 'shader'

const KIND_TAG: Record<LineKind, string> = { mod: 'база', resourcepack: 'ресурспак', shader: 'шейдер' }

function ModLine({
  m,
  on,
  locked,
  kind = 'mod',
  onToggle,
}: {
  m: AiMod
  on: boolean
  locked: boolean
  kind?: LineKind
  onToggle?: () => void
}) {
  const tag = kind === 'mod' ? (m.base ? KIND_TAG.mod : null) : KIND_TAG[kind]
  return (
    <li
      className={'aib-mod' + (on ? ' on' : '') + (locked ? ' locked' : '')}
      role="checkbox"
      aria-checked={on}
      aria-disabled={!onToggle || undefined}
      tabIndex={onToggle ? 0 : -1}
      data-track="ai_mod_toggle"
      data-kind={kind}
      data-id={m.slug}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (onToggle && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      <span className="aib-chk" aria-hidden="true">
        {on ? <PxIcon name="check" size={12} /> : null}
      </span>
      <span className="aib-ic" aria-hidden="true">
        {m.icon ? <img src={mirrorAsset(m.icon)} alt="" loading="lazy" /> : <PxIcon name="box" size={18} />}
      </span>
      <span className="aib-mbody">
        <span className="aib-mtitle">
          <span className="aib-mname">{m.title}</span>
          {tag ? <span className="mod-ver">{tag}</span> : null}
        </span>
        <span className="aib-why">{m.why}</span>
      </span>
    </li>
  )
}

function PlanSkeleton() {
  return (
    <div className="aib-plan aib-skel" aria-busy="true" aria-label="Собираем">
      <div className="aib-plan-head">
        <span className="skel" style={{ width: 180, height: 20 }} />
        <span className="skel" style={{ width: 90, height: 16 }} />
      </div>
      <ul className="aib-mods">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="aib-mod">
            <span className="skel aib-ic" />
            <span className="aib-mbody">
              <span className="skel" style={{ width: '55%', height: 12 }} />
              <span className="skel" style={{ width: '80%', height: 10, marginTop: 6 }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** `preset` — version and loader chosen in «Новая сборка»; the server keeps them as given. */
export function AiBuilder({ preset }: { preset?: AiPreset | null } = {}) {
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<AiPlan | null>(null)
  const [title, setTitle] = useState('')
  const [off, setOff] = useState<Set<string>>(new Set())
  const [quota, setQuota] = useState<AiQuota | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [built, setBuilt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cachedKey = useRef('')
  const task = useInstalls((s) => (key ? s.tasks[key] : undefined))

  useEffect(() => {
    void aiQuota().then(setQuota)
  }, [])

  const packs = plan?.resourcepacks ?? []
  const shaders = plan?.shaders ?? []
  const chosen = useMemo<Chosen>(() => {
    const keep = (list: AiMod[] | undefined) => (list ?? []).filter((m) => !off.has(m.projectId))
    return { mods: keep(plan?.mods), resourcepacks: keep(plan?.resourcepacks), shaders: keep(plan?.shaders) }
  }, [plan, off])
  const chosenCount = chosen.mods.length + chosen.resourcepacks.length + chosen.shaders.length
  const planCount = (plan?.mods.length ?? 0) + packs.length + shaders.length
  const ready = prompt.trim().length >= PROMPT_MIN
  const soon = quota ? !quota.enabled : false

  const submit = async () => {
    if (!ready || phase === 'busy' || phase === 'install') return
    setPhase('busy')
    setError('')
    setPlan(null)
    // Только длина запроса — сам текст не уходит.
    track('catalog_search', { section: 'ai', len: prompt.trim().length })
    const key = planRequestKey(prompt, preset ?? {})
    try {
      const p = await buildPlan(prompt, preset ?? {}, cachedKey.current === key)
      cachedKey.current = p.cached ? key : ''
      setPlan(p)
      setTitle(p.title)
      setOff(new Set())
      setQuota((q) => ({ enabled: true, plus: q ? q.plus : false, limit: p.limit, remaining: p.remaining }))
      setPhase('plan')
    } catch (e) {
      setError(aiErrorText(e))
      setPhase('idle')
    }
  }

  const toggle = (m: AiMod) =>
    setOff((s) => {
      const n = new Set(s)
      if (n.has(m.projectId)) n.delete(m.projectId)
      else n.add(m.projectId)
      return n
    })

  const create = async () => {
    if (!plan || !chosenCount) return
    setPhase('install')
    const started = await createAiBuild(plan, title, chosen, setKey, (name, failed) => {
      setBuilt(name)
      setPhase('done')
      if (!failed.length) showToast('Сборка готова', 'ok', 'install', { label: 'Играть', run: () => play(name) })
    }, () => setPhase('plan'))
    if (!started) setPhase('plan')
  }

  const reset = () => {
    setPhase('idle')
    setPlan(null)
    setKey(null)
    setBuilt('')
    setError('')
    inputRef.current?.focus()
  }

  const pct = phase === 'done' ? 100 : Math.round(task?.pct ?? 0)

  return (
    <section className="card aib" aria-label="ИИ-сборщик" data-section="ai" data-src="catalog">
      <form
        className="aib-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <span className="aib-mark" aria-hidden="true">
          <PxIcon name="sparkle" size={24} />
        </span>
        <label className="input aib-input">
          <input
            aria-label="Опиши сборку"
            ref={inputRef}
            value={prompt}
            maxLength={PROMPT_MAX}
            placeholder={preset?.mcVersion ? 'Опиши сборку: хоррор с зомби…' : 'Опиши сборку: хоррор с зомби на 1.20.1…'}
            disabled={phase === 'busy' || phase === 'install'}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className={'btn md primary aib-go' + (phase === 'busy' ? ' cat-busy' : '')}
          data-track="ai_build"
          disabled={!ready || soon || phase === 'busy' || phase === 'install'}
        >
          <PxIcon name="sparkle" size={18} />
          {phase === 'busy' ? 'Собираем' : 'Собрать'}
        </button>
      </form>

      {phase === 'idle' && !plan ? (
        <div className="aib-sub">
          {preset?.mcVersion ? <span className="mod-ver">{preset.mcVersion}</span> : null}
          {preset?.loader ? <span className="mod-ver">{LOADER[preset.loader]}</span> : null}
          <div className="aib-ex" role="group" aria-label="Примеры">
            {AI_EXAMPLES.map((x, i) => (
              <button key={x} type="button" className="seg aib-chip" data-track="ai_example" data-pos={i} onClick={() => (setPrompt(x), inputRef.current?.focus())}>
                {x}
              </button>
            ))}
          </div>
          {soon ? (
            <span className="aib-left">Скоро</span>
          ) : quota ? (
            <span className="aib-left">
              {quota.remaining} из {quota.limit} сегодня
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="aib-err" role="alert">
          <PxIcon name="alert" size={18} />
          <span>{error}</span>
          {!/Лимит|скоро/.test(error) ? (
            <button type="button" className="btn sm secondary" data-track="ai_retry" onClick={() => void submit()} disabled={!ready}>
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === 'busy' ? <PlanSkeleton /> : null}

      {plan && phase !== 'busy' ? (
        <div className="aib-plan">
          <div className="aib-plan-head">
            <input
              className="aib-title"
              value={title}
              style={{ width: Math.max(8, title.length + 2) + 'ch' }}
              maxLength={24}
              aria-label="Название сборки"
              disabled={phase !== 'plan'}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="mod-ver">{plan.mcVersion}</span>
            <span className="mod-ver">{LOADER[plan.loader] || plan.loader}</span>
            <span className="aib-count">
              {chosenCount} из {planCount}
            </span>
          </div>
          {plan.notes ? <p className="aib-note">{plan.notes}</p> : null}
          {plan.excluded?.length ? <p className="aib-note">Не вошли: {excludedLines(plan.excluded).join('; ')}</p> : null}
          <ul className={'aib-mods' + (phase !== 'plan' ? ' frozen' : '')}>
            {plan.mods.map((m) => (
              <ModLine
                key={m.projectId}
                m={m}
                on={!off.has(m.projectId)}
                locked={LOCKED_SLUGS.has(m.slug)}
                onToggle={phase === 'plan' && !LOCKED_SLUGS.has(m.slug) ? () => toggle(m) : undefined}
              />
            ))}
            {packs.map((m) => (
              <ModLine key={m.projectId} m={m} kind="resourcepack" on={!off.has(m.projectId)} locked={false} onToggle={phase === 'plan' ? () => toggle(m) : undefined} />
            ))}
            {shaders.map((m) => (
              <ModLine key={m.projectId} m={m} kind="shader" on={!off.has(m.projectId)} locked={false} onToggle={phase === 'plan' ? () => toggle(m) : undefined} />
            ))}
          </ul>
          <div className="aib-foot">
            {phase === 'plan' ? (
              <>
                <button type="button" className="btn md primary" data-track="ai_create" disabled={!chosenCount} onClick={() => void create()}>
                  Создать сборку
                </button>
                <button type="button" className="btn md ghost" data-track="ai_reset" onClick={reset}>
                  Заново
                </button>
              </>
            ) : (
              <>
                <div className="aib-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: pct + '%' }} />
                </div>
                {phase === 'done' ? (
                  <>
                    <button type="button" className="btn md primary" data-track="play" data-kind="build" data-id={built} data-private onClick={() => play(built)}>
                      <PxIcon name="play" size={12} />
                      Играть
                    </button>
                    <button type="button" className="btn md ghost" data-track="ai_again" onClick={reset}>
                      Ещё одну
                    </button>
                  </>
                ) : (
                  <span className="aib-pmsg">{task?.msg || task?.label || 'Создаём сборку…'}</span>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
