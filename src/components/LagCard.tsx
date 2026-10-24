import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { backdropClose } from '../lib/dismiss'
import { applyLagFix, askMilliAboutLag, dismissLag, muteLagHelp, useLag } from '../lib/lagHelp'
import { lagText } from '../lib/lagPlan'
import { useT } from '../i18n'

/** «Почему лагало и как исправить»: после выхода из игры или при следующем открытии лаунчера. */
export function LagCard() {
  const t = useT()
  const report = useLag((s) => s.report)
  const [acting, setActing] = useState('')

  useEffect(() => {
    if (!report) return
    setActing('')
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissLag()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [report])

  if (!report) return null
  const { title, why } = lagText(report.cause)
  const [main, ...rest] = report.fixes
  const run = (id: string, go: () => Promise<unknown>) => {
    setActing(id)
    void go().finally(() => setActing(''))
  }
  return (
    <div className="modal-bg open vis" style={{ zIndex: 205 }} {...backdropClose(dismissLag)}>
      <div className="modal mw-sm" role="dialog" aria-labelledby="lag-title">
        <div className="crash-head">
          <span className="crash-ic">
            <Icon id="i-alert" />
          </span>
          <div>
            <h3 id="lag-title">{t('Игра тормозила: {fps} FPS', { fps: report.fps })}</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              {report.profile}
            </div>
          </div>
        </div>
        <p className="crash-reason">
          <b>{title}.</b> {why}
        </p>

        {rest.length ? (
          <div className="crash-fixes">
            {rest.map((f) => (
              <button key={f.id} className="btn sm secondary" disabled={acting !== ''} onClick={() => run(f.id, () => applyLagFix(report, f))}>
                {acting === f.id ? t('Делаем…') : f.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="crash-acts">
          {main ? (
            <button className="btn lg primary" data-track="lag_fix" disabled={acting !== ''} onClick={() => run(main.id, () => applyLagFix(report, main))}>
              <Icon id="i-restart" /> {acting === main.id ? t('Делаем…') : main.label}
            </button>
          ) : null}
          <button className={'btn lg ' + (main ? 'secondary' : 'primary')} data-track="lag_milli" disabled={acting !== ''} onClick={() => run('milli', () => askMilliAboutLag(report))}>
            <Icon id="i-sparkle" /> {t('Спросить Милли')}
          </button>
          <div className="crash-acts-min">
            <button className="btn md ghost" onClick={muteLagHelp}>
              {t('Больше не показывать')}
            </button>
            <button className="btn md ghost" onClick={dismissLag}>
              {t('Закрыть')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
