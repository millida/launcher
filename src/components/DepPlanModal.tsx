import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useDepPlan } from '../state/depPlan'
import { backdropClose } from '../lib/dismiss'
import { autoItems, depSummary, fmtBytes, planItem } from '../lib/deps'
import type { DepNode } from '../ipc/commands'

function DepRow({
  node,
  checked,
  onToggle,
}: {
  node: DepNode
  checked?: boolean
  onToggle?: () => void
}) {
  const facts = [node.version_number, fmtBytes(node.size), node.source === 'curseforge' ? 'CurseForge' : 'Modrinth']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="mod-card" style={{ marginBottom: '6px' }}>
      <div className="mod-card-row">
        {onToggle ? (
          <span
            className={'chk' + (checked ? ' on' : '')}
            title={checked ? 'Не ставить' : 'Поставить вместе с модом'}
            onClick={onToggle}
          ></span>
        ) : null}
        <span className="mod-art">{node.icon ? <img src={node.icon} alt="" loading="lazy" /> : <Icon id="i-box" />}</span>
        <span className="mod-card-body" title={node.file_name}>
          <span className="mod-card-title">
            {node.title}
            {node.problem ? (
              <span className="mod-upd" style={{ background: 'var(--m-danger-soft)', color: 'var(--m-danger)' }}>
                нет версии
              </span>
            ) : null}
          </span>
          <span className="mod-card-sub">
            {node.problem || (node.required_by ? 'нужен для «' + node.required_by + '»' : '') || facts}
          </span>
        </span>
        {node.problem ? null : <span className="set-val">{facts}</span>}
      </div>
    </div>
  )
}

export function DepPlanModal() {
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
        <h3>«{plan.title}» — что поставим</h3>
        <div className="sub">{depSummary(plan) || 'Дополнительных модов не требуется.'}</div>

        <div style={{ maxHeight: '360px', overflowY: 'auto', marginTop: '14px' }}>
          {plan.conflicts.length ? (
            <>
              <div className="set-val" style={{ color: 'var(--m-danger)', margin: '0 0 6px' }}>
                Конфликты
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
                  <Icon id="i-alert" /> «{c.title}» и «{c.with}» вместе не работают — {c.reason}. Оставь что-то одно.
                </p>
              ))}
            </>
          ) : null}

          {plan.required.length ? (
            <>
              <div className="set-val" style={{ margin: '10px 0 6px' }}>
                Поставим вместе с модом
              </div>
              {plan.required.map((n) => (
                <DepRow node={n} key={n.project_id} />
              ))}
            </>
          ) : null}

          {plan.missing.length ? (
            <>
              <div className="set-val" style={{ color: 'var(--m-danger)', margin: '10px 0 6px' }}>
                Не нашлось под эту сборку
              </div>
              {plan.missing.map((n) => (
                <DepRow node={n} key={n.project_id} />
              ))}
            </>
          ) : null}

          {plan.optional.length ? (
            <>
              <div className="set-val" style={{ margin: '10px 0 6px' }}>
                По желанию — отметь, что нужно
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
          <p className="faint-note">Зависимостей слишком много — показали первые. Остальные подтянутся при установке.</p>
        ) : null}
        {plan.missing.length ? (
          <p className="faint-note">
            Без них мод, скорее всего, не запустится: у зависимостей нет файлов под эту версию игры и загрузчик.
            Поставить можно, но лучше выбрать другую версию мода.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button className="btn md" style={{ flex: 1 }} onClick={() => decide({ go: true, extras })}>
            <Icon id="i-download" /> Установить{total ? ' + ' + total : ''}
          </button>
          <button className="btn md ghost" onClick={() => decide({ go: false, extras: [] })}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
