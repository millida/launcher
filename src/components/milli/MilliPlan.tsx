import { useState, type CSSProperties } from 'react'
import { PxIcon } from '../PxIcon'
import { mirrorAsset } from '../../lib/api'
import { LOADER_LABEL, type MilliPlanCard } from '../../lib/milli'
import { prefillMilli, sendMilli, useMilli } from '../../state/milli'
import { MilliSafe } from './MilliStage'
import { Art } from './MilliModTip'
import '../../styles/pixel/milli-pack.css'
import '../../styles/pixel/milli-plan.css'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strs = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, n) : [])

function ModIcon({ icon }: { icon: string | null }) {
  const [bad, setBad] = useState(false)
  return icon && !bad ? (
    <img src={mirrorAsset(icon)} alt="" loading="lazy" width={28} height={28} onError={() => setBad(true)} />
  ) : (
    <Art px="chest" size={24}>
      <PxIcon name="plus" size={12} />
    </Art>
  )
}

/** Название без «…» посреди слова: режем по границе слова, ≤2 строки карточки. */
function shortTitle(t: string, max = 52): string {
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 20 ? cut.slice(0, sp) : t.slice(0, max)).replace(/[\s,·:;—-]+$/, '') + '…'
}

function PlanBody({ plan, active }: { plan: MilliPlanCard; active: boolean }) {
  const pending = useMilli((s) => s.pending)
  const themes = strs(plan.themes, 5)
  const avoid = strs(plan.avoid, 5)
  const mods = (Array.isArray(plan.mods) ? plan.mods : []).filter((m) => m && str(m.title)).slice(0, 6)
  const size = Number.isFinite(plan.size) && plan.size > 0 ? Math.round(plan.size) : null
  const mc = str(plan.mc) || str(plan.mcPick)
  const loader = str(plan.loader) || str(plan.loaderPick)
  const shaders = str(plan.shaders)
  const rp = str(plan.rp)
  const title = str(plan.title) || 'Сборка'
  const more = size ? Math.max(0, size - mods.length) : 0
  const ver = [mc, loader ? LOADER_LABEL[loader] ?? loader : ''].filter(Boolean).join(' · ')
  return (
    <div className="mpl" role="group" aria-label="План сборки">
      <div className="mpl-head">
        <span className="mpc-badge" aria-hidden="true">
          <Art px="book_quill" size={24}>
            <PxIcon name="book" size={16} />
          </Art>
        </span>
        <span className="mpl-id">
          <span className="mpl-kicker">План сборки</span>
          <b className="mpl-title" title={title}>
            {shortTitle(title)}
          </b>
        </span>
      </div>
      {mods.length ? (
        <div className="mpl-mods" aria-label="Главные моды">
          {mods.map((m, i) => (
            <span key={m.projectId ?? i} className="mpl-mod" data-name={str(m.title)} title={str(m.title)} style={{ '--i': i } as CSSProperties}>
              <span className="mpc-slot" aria-hidden="true">
                <ModIcon icon={typeof m.icon === 'string' && m.icon ? m.icon : null} />
              </span>
            </span>
          ))}
          {more ? (
            <span className="mpl-more" title={'Ещё ' + more + ' модов'} style={{ '--i': mods.length } as CSSProperties}>
              +{more}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mpl-chips">
        {ver ? (
          <span className="mpl-chip meta" title="Версия и загрузчик">
            <Art px="compass" size={12}>
              <PxIcon name="map" size={12} />
            </Art>
            {ver}
          </span>
        ) : null}
        {size ? (
          <span className="mpl-chip meta" title="Модов в сборке">
            <Art px="chest" size={12}>
              <PxIcon name="plus" size={12} />
            </Art>
            ≈{size} модов
          </span>
        ) : null}
        {shaders ? (
          <span className="mpl-chip meta" title="Шейдеры">
            <Art px="steve_glow" size={12}>
              <PxIcon name="crown" size={12} />
            </Art>
            {shaders}
          </span>
        ) : null}
        {rp ? (
          <span className="mpl-chip meta" title="Ресурспак">
            <Art px="grass_dandelion" size={12}>
              <PxIcon name="crown" size={12} />
            </Art>
            {rp}
          </span>
        ) : null}
        {themes.map((t) => (
          <span key={'t' + t} className="mpl-chip">
            {t}
          </span>
        ))}
        {avoid.map((t) => (
          <span key={'a' + t} className="mpl-chip no" title={'Без: ' + t}>
            {t}
          </span>
        ))}
      </div>
      {active ? (
        <div className="mpl-act">
          <button type="button" className="btn primary mpl-go" data-track="milli_plan_accept" disabled={pending} onClick={() => void sendMilli('Принять')}>
            <PxIcon name="play" size={12} />
            Принять
          </button>
          <button type="button" className="btn sm secondary" data-track="milli_plan_more" disabled={pending} onClick={() => prefillMilli('Ещё хочу ')}>
            <PxIcon name="plus" size={10} />
            Дополнить
          </button>
          <button type="button" className="btn sm secondary" data-track="milli_plan_edit" disabled={pending} onClick={() => prefillMilli('Поменяй ')}>
            <PxIcon name="restart" size={10} />
            Изменить
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Карточка «план сборки»: кнопки только у последнего ответа; кривой план не роняет панель. */
export function MilliPlan({ plan, active }: { plan: MilliPlanCard; active: boolean }) {
  if (!plan || typeof plan !== 'object') return null
  return (
    <MilliSafe>
      <PlanBody plan={plan} active={active} />
    </MilliSafe>
  )
}
