import { Icon } from './Icon'
import { PL_STAGES, REPAIR_STAGES, cancelPrelaunch } from '../lib/launch'
import { useUi } from '../state/ui'

export function Prelaunch() {
  const pl = useUi((s) => s.prelaunch)
  const repair = pl.mode === 'repair'
  const stages = repair ? REPAIR_STAGES : PL_STAGES
  return (
    <div className={'prelaunch' + (pl.open ? ' open' : '')} id="prelaunch">
      <div className="pl-title" id="plTitle">
        {repair ? 'Починка сборки' : 'Запуск сборки'}
      </div>
      <div className="pl-sub" id="plSub">
        {pl.sub}
      </div>
      <div id="plStages">
        {stages.map((st, i) => (
          <div key={st} className={'pl-stage ' + (i < pl.stage ? 'done' : i === pl.stage ? 'act' : '')}>
            <span className="st-ic">
              {i < pl.stage ? <Icon id="i-check" /> : i === pl.stage ? <span className="spin"></span> : null}
            </span>
            {i === pl.stage && pl.msg ? pl.msg : st}
          </div>
        ))}
      </div>
      <div className="pl-bar">
        <i id="plBar" style={{ width: pl.pct + '%' }}></i>
      </div>
      <button className="btn sm ghost" style={{ width: '100%' }} id="plCancel" onClick={cancelPrelaunch}>
        Отмена
      </button>
    </div>
  )
}
