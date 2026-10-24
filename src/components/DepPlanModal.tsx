import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useDepPlan } from '../state/depPlan'
import { backdropClose } from '../lib/dismiss'
import { autoItems, depSummary, fmtBytes, planItem } from '../lib/deps'
import type { DepNode } from '../ipc/commands'
import { mirrorAsset } from '../lib/api'
import { tx, useT } from '../i18n'

function DepRow({
  node,
  checked,
  onToggle,
}: {
  node: DepNode
  checked?: boolean
  onToggle?: () => void
}) {
  const t = useT()
  const facts = [node.version_number, fmtBytes(node.size), node.source === 'curseforge' ? 'CurseForge' : node.source === 'millida' ? 'Millida' : 'Modrinth']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="mod-card" style={{ marginBottom: '6px' }}>
      <div className="mod-card-row">
        {onToggle ? (
          <span
            className={'chk' + (checked ? ' on' : '')}
            role="checkbox"
            aria-checked={!!checked}
            onClick={onToggle}
          ></span>
        ) : null}
        <span className="mod-art">{node.icon ? <img src={mirrorAsset(node.icon)} alt="" loading="lazy" /> : <Icon id="i-box" />}</span>
        <span className="mod-card-body">
          <span className="mod-card-title">
            {node.title}
            {node.problem ? (
              <span className="mod-upd" style={{ background: 'var(--m-danger-soft)', color: 'var(--m-danger)' }}>
                {t('нет версии')}
              </span>
            ) : null}
          </span>
          <span className="mod-card-sub">
            {node.problem || (node.required_by ? t('нужен для «{name}»', { name: node.required_by }) : '') || facts}
          </span>
        </span>
        {node.problem ? null : <span className="set-val">{facts}</span>}
      </div>
    </div>
  )
}

export function DepPlanModal() {
  const t = useT()
  const { open, plan, decide } = useDepPlan()
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setPicked(new Set())
  }, [open, plan])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && decide({ go: false, extras: [] })
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, decide])

  if (!open || !plan) return null

  const extras = plan.optional.filter((o) => picked.has(o.project_id)).map(planItem)
  const total = autoItems(plan).length + extras.length

  return (
    <div className="modal-bg open vis" style={{ zIndex: 470 }} {...backdropClose(() => decide({ go: false, extras: [] }))}>
      <div className="modal mw-sm">
        <h3>{t('«{title}» — что поставим', { title: plan.title })}</h3>
        {depSummary(plan) ? <div className="sub">{depSummary(plan)}</div> : null}

        <div style={{ maxHeight: '360px', overflowY: 'auto', marginTop: '14px' }}>
          {plan.conflicts.length ? (
            <>
              <div className="set-val" style={{ color: 'var(--m-danger)', margin: '0 0 6px' }}>
                {t('Конфликты')}
              </div>
              {plan.conflicts.map((c) => (
                <p
                  className="faint-note"
                  key={c.title + c.file_name}
                  style={{
                    margin: '0 0 6px',
                    padding: '8px 10px',
                    background: 'var(--m-danger-soft)',
                    color: 'var(--m-danger)',
                    borderRadius: '10px',
                  }}
                >
                  <Icon id="i-alert" /> {t('«{a}» и «{b}» несовместимы: {reason}', { a: c.title, b: c.with, reason: tx(c.reason) })}
                </p>
              ))}
            </>
          ) : null}

          {plan.required.length ? (
            <>
              <div className="set-val" style={{ margin: '10px 0 6px' }}>
                {t('Вместе с модом')}
              </div>
              {plan.required.map((n) => (
                <DepRow node={n} key={n.project_id} />
              ))}
            </>
          ) : null}

          {plan.missing.length ? (
            <>
              <div className="set-val" style={{ color: 'var(--m-danger)', margin: '10px 0 6px' }}>
                {t('Нет под эту версию')}
              </div>
              {plan.missing.map((n) => (
                <DepRow node={n} key={n.project_id} />
              ))}
            </>
          ) : null}

          {plan.optional.length ? (
            <>
              <div className="set-val" style={{ margin: '10px 0 6px' }}>
                {t('По желанию')}
              </div>
              {plan.optional.map((n) => (
                <DepRow
                  node={n}
                  key={n.project_id}
                  checked={picked.has(n.project_id)}
                  onToggle={() => {
                    const next = new Set(picked)
                    if (next.has(n.project_id)) next.delete(n.project_id)
                    else next.add(n.project_id)
                    setPicked(next)
                  }}
                />
              ))}
            </>
          ) : null}
        </div>

        {plan.truncated ? (
          <p className="faint-note">{t('Показаны первые — остальные подтянутся сами')}</p>
        ) : null}
        {plan.missing.length ? (
          <p className="faint-note">{t('Без них мод может не запуститься — лучше взять другую версию мода')}</p>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button className="btn md primary" style={{ flex: 1 }} onClick={() => decide({ go: true, extras })}>
            <Icon id="i-download" /> {t('Установить')}{total ? ' + ' + total : ''}
          </button>
          <button className="btn md ghost" onClick={() => decide({ go: false, extras: [] })}>
            {t('Отмена')}
          </button>
        </div>
      </div>
    </div>
  )
}
