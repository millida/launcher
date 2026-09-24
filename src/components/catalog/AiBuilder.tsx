import { useEffect, useMemo, useRef, useState } from 'react'
import { PxIcon } from '../PxIcon'
import { createProfile, installDepItems } from '../../ipc/commands'
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
  buildPlan,
} from '../../lib/aiBuilder'
import type { AiMod, AiPlan, AiQuota } from '../../lib/aiBuilder'
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

/** Сборка из плана: профиль под версию и загрузчик, затем моды одним заданием ядра. */
async function createAiBuild(
  plan: AiPlan,
  title: string,
  mods: AiMod[],
  onDone: (name: string) => void,
  onFail: () => void,
): Promise<string | null> {
  const name = (title.trim() || plan.title).slice(0, 24)
  if (!hasTauri()) {
    if (import.meta.env.DEV && DEMO_USER) return demoInstall(name, mods.length, onDone)
    showToast('Сборки создаются в приложении')
    return null
  }
  let created = ''
  try {
    const p = await createProfile(name, plan.mcVersion, plan.loader === 'fabric', plan.loader, null)
    created = p.name
  } catch (e) {
    showToast('Не удалось создать сборку: ' + e, 'error')
    return null
  }
  track('build_create', { mc: plan.mcVersion, loader: plan.loader, from: 'ai', mods: mods.length })
  await useProfiles.getState().refresh()
  useProfiles.getState().setSelected(created)
  useMods.getState().scopeTo(created)
  // Базовые первыми: Fabric API встаёт до модов, которые его требуют, и
  // ядро не качает его второй раз как зависимость.
  const items: PlanItem[] = [...mods].sort((a, b) => Number(b.base) - Number(a.base)).map((m) => ({ source: 'modrinth', project_id: m.projectId }))
  const key = keyContent('mr', created, 'mod', 'millida:deps')
  const started = runInstall<DepReport>({
    key,
    title: created,
    running: 'Ставим моды…',
    run: () => installDepItems(created, 'mod', items),
    onDone: (r) => {
      void useMods.getState().refreshInstalled()
      void useMods.getState().load()
      if (r.failed.length) showToast('Не встало: ' + r.failed.slice(0, 3).join('; '), 'error')
      onDone(created)
    },
    onError: (e) => {
      showToast('' + e, 'error')
      onFail()
    },
  })
  return started ? key : null
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

function ModLine({ m, on, locked, onToggle }: { m: AiMod; on: boolean; locked: boolean; onToggle?: () => void }) {
  return (
    <li
      className={'aib-mod' + (on ? ' on' : '') + (locked ? ' locked' : '')}
      role="checkbox"
      aria-checked={on}
      aria-disabled={!onToggle || undefined}
      tabIndex={onToggle ? 0 : -1}
      data-track="ai_mod_toggle"
      data-kind="mod"
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
          {m.base ? <span className="mod-ver">база</span> : null}
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

export function AiBuilder() {
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
  const task = useInstalls((s) => (key ? s.tasks[key] : undefined))

  useEffect(() => {
    void aiQuota().then(setQuota)
  }, [])

  const chosen = useMemo(() => (plan ? plan.mods.filter((m) => !off.has(m.projectId)) : []), [plan, off])
  const ready = prompt.trim().length >= PROMPT_MIN
  const soon = quota ? !quota.enabled : false

  const submit = async () => {
    if (!ready || phase === 'busy' || phase === 'install') return
    setPhase('busy')
    setError('')
    setPlan(null)
    // Только длина запроса — сам текст не уходит.
    track('catalog_search', { section: 'ai', len: prompt.trim().length })
    try {
      const p = await buildPlan(prompt)
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
    if (!plan || !chosen.length) return
    setPhase('install')
    const k = await createAiBuild(plan, title, chosen, (name) => {
      setBuilt(name)
      setPhase('done')
      showToast('Сборка готова', 'ok', 'install', { label: 'Играть', run: () => play(name) })
    }, () => setPhase('plan'))
    if (!k) setPhase('plan')
    else setKey(k)
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
            placeholder="Опиши сборку: хоррор с зомби на 1.20.1…"
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
              {chosen.length} из {plan.mods.length}
            </span>
          </div>
          {plan.notes ? <p className="aib-note">{plan.notes}</p> : null}
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
          </ul>
          <div className="aib-foot">
            {phase === 'plan' ? (
              <>
                <button type="button" className="btn md primary" data-track="ai_create" disabled={!chosen.length} onClick={() => void create()}>
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
