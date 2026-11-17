import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useServerMods } from '../state/serverMods'
import { backdropClose } from '../lib/dismiss'
import { fmtSize } from '../lib/format'
import { mirrorAsset } from '../lib/api'
import { loaderName, type ServerMod } from '../lib/serverModsPlan'
import { blockArt } from './playhub/data'
import { useT } from '../i18n'
import '../styles/pixel/server-mods.css'

const SOURCE: Record<ServerMod['source'], string> = { modrinth: 'Modrinth', curseforge: 'CurseForge', custom: '' }

function Check({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={'smd-chk' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-label={label} onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}>
      {on ? <Icon id="i-check" /> : null}
    </button>
  )
}

function ModRow({ m, on, onToggle }: { m: ServerMod; on?: boolean; onToggle?: () => void }) {
  const t = useT()
  const scan =
    m.scan === 'clean'
      ? { cls: 'ok', text: t('Антивирус: чисто') }
      : m.scan === 'flagged'
        ? { cls: 'bad', text: t('Антивирус: подозрение') }
        : m.scan === 'unchecked'
          ? { cls: '', text: t('Не проверен') }
          : null
  return (
    <div className={'smd-row' + (m.source === 'custom' ? ' own' : '') + (onToggle ? ' pick' : '') + (onToggle && !on ? ' off' : '')} onClick={onToggle}>
      {onToggle ? <Check on={!!on} onToggle={onToggle} label={m.name} /> : null}
      <span className="smd-art">{m.iconUrl ? <img src={mirrorAsset(m.iconUrl)} alt="" loading="lazy" draggable={false} /> : <Icon id="i-chest" />}</span>
      <span className="smd-txt">
        <b>{m.name}</b>
        <span>{[m.source === 'custom' ? m.file : '', fmtSize(m.size)].filter(Boolean).join(' · ')}</span>
      </span>
      {scan ? <span className={'smd-tag ' + scan.cls}>{scan.text}</span> : <span className="smd-tag src">{SOURCE[m.source]}</span>}
    </div>
  )
}

export function ServerModsModal() {
  const t = useT()
  const { open, phase, plan, progress, failed, decide, settle } = useServerMods()
  const [optional, setOptional] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState<Set<string>>(new Set())
  const [trust, setTrust] = useState(false)

  useEffect(() => {
    if (!plan) return
    setOptional(new Set(plan.add.filter((m) => !m.required).map((m) => m.sha512)))
    setCustom(new Set())
    setTrust(false)
  }, [plan])

  const cancel = () => (phase === 'failed' ? settle(false) : phase === 'ask' ? decide({ action: 'cancel', optional: [], custom: [] }) : undefined)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!open || !plan) return null

  const flip = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    apply(next)
  }
  const chosen = [...plan.add.filter((m) => m.required || optional.has(m.sha512)), ...plan.custom.filter((m) => custom.has(m.sha512))]
  const bytes = chosen.reduce((sum, m) => sum + m.size, 0)
  const blocked = custom.size > 0 && !trust
  const required = plan.add.filter((m) => m.required)
  const extra = plan.add.filter((m) => !m.required)
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="smd-back" role="dialog" aria-modal="true" aria-label={t('Моды сервера')} {...backdropClose(cancel)}>
      <div className="card smd">
        <header className="smd-head">
          <span className="smd-ic">
            <img src={plan.icon || blockArt(7)} alt="" draggable={false} />
          </span>
          <span className="smd-title">
            <b>{t('Моды сервера')}</b>
            <span>{plan.server}</span>
          </span>
          <span className="smd-for">{loaderName(plan.loader) + ' ' + plan.version}</span>
          {phase !== 'install' ? (
            <button className="btn md ghost smd-x" aria-label={t('Закрыть')} onClick={cancel}>
              <Icon id="i-x" />
            </button>
          ) : null}
        </header>

        {phase === 'ask' ? (
          <>
            <div className="smd-body">
              {plan.have ? (
                <div className="smd-have">
                  <Icon id="i-check" /> {t('Уже стоят: {n}', { n: plan.have })}
                </div>
              ) : null}
              {required.length ? (
                <section className="smd-sec">
                  <h4>
                    {t('Нужны для входа')} <i>{required.length}</i>
                  </h4>
                  {required.map((m) => (
                    <ModRow key={m.sha512} m={m} />
                  ))}
                </section>
              ) : null}
              {extra.length ? (
                <section className="smd-sec">
                  <h4>
                    {t('По желанию')} <i>{extra.length}</i>
                  </h4>
                  {extra.map((m) => (
                    <ModRow key={m.sha512} m={m} on={optional.has(m.sha512)} onToggle={() => flip(optional, m.sha512, setOptional)} />
                  ))}
                </section>
              ) : null}
              {plan.custom.length ? (
                <section className="smd-sec">
                  <h4>
                    {t('Свои моды владельца')} <i>{plan.custom.length}</i>
                  </h4>
                  <div className="smd-warn">
                    <Icon id="i-alert" />
                    <span>{t('Их нет в Modrinth и CurseForge. Такой мод может украсть аккаунт — ставь, только если доверяешь владельцу.')}</span>
                  </div>
                  {plan.custom.map((m) => (
                    <ModRow key={m.sha512} m={m} on={custom.has(m.sha512)} onToggle={() => flip(custom, m.sha512, setCustom)} />
                  ))}
                  {custom.size ? (
                    <div className={'smd-trust' + (trust ? ' on' : ' need')} onClick={() => setTrust(!trust)}>
                      <Check on={trust} onToggle={() => setTrust(!trust)} label={t('Ставлю на свой риск')} />
                      <span>{t('Ставлю на свой риск: Millida не проверяла эти файлы и за них не отвечает')}</span>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {plan.remove.length ? <div className="smd-note">{t('Уберём моды, которых на сервере больше нет: {n}', { n: plan.remove.length })}</div> : null}
              {plan.customHidden ? <div className="smd-note">{t('Ещё своих модов владельца: {n} — он их не открыл', { n: plan.customHidden })}</div> : null}
            </div>
            <footer className="smd-foot">
              <span className="smd-sum">{chosen.length ? t('{n} шт. · {size}', { n: chosen.length, size: fmtSize(bytes) }) : ''}</span>
              <button className="btn md ghost" data-track="server_mods_without" onClick={() => decide({ action: 'without', optional: [], custom: [] })}>
                {t('Без модов')}
              </button>
              <button
                className="btn md primary"
                data-track="server_mods_install"
                disabled={blocked}
                onClick={() => decide({ action: 'install', optional: [...optional], custom: [...custom] })}
              >
                <Icon id="i-download" /> {t('Скачать и зайти')}
              </button>
            </footer>
          </>
        ) : null}

        {phase === 'install' && progress ? (
          <div className="smd-run" aria-live="polite">
            <div className="smd-bar">
              <span style={{ width: pct + '%' }}></span>
            </div>
            <div className="smd-run-txt">
              <b>{progress.current}</b>
              <span>{t('{done} из {total}', { done: progress.done, total: progress.total })}</span>
            </div>
          </div>
        ) : null}

        {phase === 'failed' ? (
          <>
            <div className="smd-body">
              <div className="smd-warn">
                <Icon id="i-alert" />
                <span>{t('Не встали: {n}. Сервер может не пустить без них.', { n: failed.length })}</span>
              </div>
              {failed.map((name) => (
                <div className="smd-row off" key={name}>
                  <span className="smd-art">
                    <Icon id="i-x" />
                  </span>
                  <span className="smd-txt">
                    <b>{name}</b>
                  </span>
                </div>
              ))}
            </div>
            <footer className="smd-foot">
              <span className="smd-sum"></span>
              <button className="btn md ghost" onClick={() => settle(false)}>
                {t('Отмена')}
              </button>
              <button className="btn md primary" onClick={() => settle(true)}>
                {t('Зайти так')}
              </button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  )
}
