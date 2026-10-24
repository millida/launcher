import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { fmtSize } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { backdropClose } from '../lib/dismiss'
import { showToast } from '../state/ui'
import { quarantineMods, quarantinePacks, scanModSafety, scanPackSafety, type ModVerdict, type SafetyReport } from '../ipc/commands'
import { t, tx, useT } from '../i18n'

const VERDICTS: Record<ModVerdict['verdict'], { label: string; tone: string; help: string }> = {
  blocked: {
    get label() {
      return t('Опасный')
    },
    tone: 'danger',
    get help() {
      return t('В списке вредоносных — убери из сборки')
    },
  },
  suspicious: {
    get label() {
      return t('Подозрительный')
    },
    tone: 'warn',
    get help() {
      return t('Внутри лишнее — проверь, откуда файл')
    },
  },
  unknown: {
    get label() {
      return t('Неизвестный')
    },
    tone: '',
    get help() {
      return t('Нет в каталогах')
    },
  },
  ok: {
    get label() {
      return t('Из каталога')
    },
    tone: 'ok',
    get help() {
      return t('Совпадает с Modrinth или CurseForge')
    },
  },
}

interface Props {
  profile: string
  onClose: () => void
  onChanged: () => void
  /** packs: resource packs, shader packs, data packs and worlds instead of mods. */
  scope?: 'mods' | 'packs'
}

const CLEAN = {
  get label() {
    return t('Чисто')
  },
  tone: 'ok',
  get help() {
    return t('Внутри нет исполняемых файлов')
  },
}

export function SafetyModal({ profile, onClose, onChanged, scope = 'mods' }: Props) {
  const packs = scope === 'packs'
  const scanFn = packs ? scanPackSafety : scanModSafety
  const t = useT()
  const [report, setReport] = useState<SafetyReport | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const scan = () => {
    if (!hasTauri()) return
    setBusy(true)
    setError('')
    scanFn(profile)
      .then(setReport)
      .catch((e) => {
        console.error('scanModSafety', e)
        setError(tx(e))
      })
      .finally(() => setBusy(false))
  }

  useEffect(scan, [profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const risky = (report?.items ?? []).filter(
    (i) => (i.verdict === 'blocked' || i.verdict === 'suspicious') && i.enabled,
  )

  const disableRisky = () => {
    setBusy(true)
    ;(packs ? quarantinePacks : quarantineMods)(
      profile,
      risky.map((i) => i.file),
    )
      .then((n) => {
        showToast(t('{n} файлов отключено', { n }), 'ok')
        onChanged()
        return scanFn(profile).then(setReport)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-bg open vis" style={{ zIndex: 215 }} {...backdropClose(onClose)}>
      <div className="modal mw-md safety-modal">
        <div className="crash-head">
          <span className="crash-ic ok">
            <Icon id="i-shield" />
          </span>
          <div>
            <h3>{packs ? t('Проверка паков и карт') : t('Проверка модов')}</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              {profile}
            </div>
          </div>
        </div>

        {busy && !report ? (
          <div className="bx-skel-list" aria-busy="true">
            <span className="skel" />
            <span className="skel" />
            <span className="skel" />
          </div>
        ) : error ? (
          <div className="bx-mini-empty">
            <Icon id="i-alert" />
            <b>{t('Проверка не удалась')}</b>
            <button className="btn sm secondary" onClick={scan}>
              <Icon id="i-restart" /> {t('Повторить')}
            </button>
          </div>
        ) : report ? (
          <>
            <div className="safety-sum">
              <span className="safety-pill ok">{packs ? t('{n} чистых', { n: report.ok }) : t('{n} из каталога', { n: report.ok })}</span>
              {packs ? null : <span className="safety-pill">{t('{n} неизвестных', { n: report.unknown })}</span>}
              {report.suspicious ? (
                <span className="safety-pill warn">{t('{n} подозрительных', { n: report.suspicious })}</span>
              ) : null}
              {report.blocked ? <span className="safety-pill danger">{t('{n} опасных', { n: report.blocked })}</span> : null}
            </div>
            {report.note ? <p className="faint-note">{tx(report.note)}</p> : null}
            {report.checked === 0 ? <p className="faint-note">{packs ? t('Паков и карт нет') : t('Модов нет')}</p> : null}

            <div className="safety-list">
              {report.items.map((item) => {
                const v = (item.verdict as string) === 'clean' ? CLEAN : VERDICTS[item.verdict]
                return (
                  <div className={'safety-row ' + (v.tone || 'plain')} key={item.file}>
                    <span className="safety-mark">{v.label}</span>
                    <span className="safety-body">
                      <b>
                        {item.title}
                        {item.enabled ? null : <span className="wm-tag">{t('выключён')}</span>}
                      </b>
                      <span className="safety-meta">
                        {[item.file, fmtSize(item.size), item.source].filter(Boolean).join(' · ')}
                      </span>
                      {item.reasons.length ? (
                        <span className="safety-why">{item.reasons.join('. ')}</span>
                      ) : (
                        <span className="safety-why">{v.help}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          {risky.length ? (
            <button className="btn md danger" style={{ flex: 1 }} disabled={busy} onClick={disableRisky}>
              <Icon id="i-ban" /> {t('Отключить ({n})', { n: risky.length })}
            </button>
          ) : null}
          <button className="btn md secondary" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
