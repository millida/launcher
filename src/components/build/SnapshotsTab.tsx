import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorText } from '../../lib/apiError'
import { deleteSnapshot, listSnapshots, restoreSnapshot, takeSnapshot, type MilliSnap } from '../../lib/buildSnapshots'
import { plural } from '../../lib/format'
import { sizeText } from '../../lib/milliLocal'
import { uiConfirm } from '../../state/confirm'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { formatRelative, tx, useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

const LABEL_MAX = 60

export function SnapshotsTab({ profile, active, running, onRestored }: { profile: string; active: boolean; running: boolean; onRestored: () => void }) {
  const t = useT()
  const [list, setList] = useState<MilliSnap[] | null>(null)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState('')
  const seq = useRef(0)

  const load = useCallback(() => {
    const mine = ++seq.current
    setError('')
    listSnapshots(profile)
      .then((rows) => mine === seq.current && setList(rows))
      .catch((e) => {
        if (mine !== seq.current) return
        setList([])
        setError(apiErrorText(e, t('Не удалось открыть снимки')))
      })
  }, [profile])

  useEffect(() => {
    setList(null)
    setLabel('')
  }, [profile])
  useEffect(() => {
    if (active) load()
  }, [active, load])

  const take = () => {
    setBusy('take')
    takeSnapshot(profile, label.trim().slice(0, LABEL_MAX), false)
      .then(() => {
        setLabel('')
        showToast(t('Снимок сохранён'), 'ok')
        load()
      })
      .catch((e) => showToast(t('Не удалось сделать снимок: {error}', { error: tx(e) }), 'error'))
      .finally(() => setBusy(''))
  }

  const restore = async (s: MilliSnap) => {
    const ok = await uiConfirm(
      t('Сборка вернётся к снимку «{label}». Текущее состояние сохраним снимком «Перед откатом» — к нему тоже можно вернуться.', { label: tx(s.label) }),
      { title: t('Восстановить снимок?'), confirmLabel: t('Восстановить'), danger: false },
    )
    if (!ok) return
    setBusy(s.id)
    restoreSnapshot(profile, s.id)
      .then(() => {
        showToast(t('Сборка вернулась к снимку «{label}»', { label: tx(s.label) }), 'ok')
        onRestored()
        load()
      })
      .catch((e) => showToast(t('Не удалось откатить: {error}', { error: tx(e) }), 'error'))
      .finally(() => setBusy(''))
  }

  const remove = async (s: MilliSnap) => {
    if (!(await uiConfirm(t('Удалить снимок «{label}»?', { label: tx(s.label) }), { confirmLabel: t('Удалить') }))) return
    setBusy(s.id)
    deleteSnapshot(profile, s.id)
      .then(load)
      .catch((e) => showToast(apiErrorText(e, t('Не удалось удалить')), 'error'))
      .finally(() => setBusy(''))
  }

  return (
    <div className="bx-snaps">
      <div className="bx-snap-new">
        <div className="input sm">
          <input
            value={label}
            maxLength={LABEL_MAX}
            placeholder={t('Подпись, если нужна')}
            spellCheck={false}
            disabled={!!busy}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) take()
            }}
          />
        </div>
        <button type="button" className="btn sm primary" disabled={!!busy} onClick={take}>
          <Icon id="i-plus" /> {busy === 'take' ? t('Сохраняем…') : t('Сделать снимок')}
        </button>
      </div>
      {running && list && list.length ? <p className="faint-note bx-running">{t('Игра запущена — откатить сборку можно после выхода из игры')}</p> : null}
      {error ? <p className="faint-note">{error}</p> : null}
      {list === null ? (
        <div className="bx-files-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div className="bx-file skel" key={i} />
          ))}
        </div>
      ) : !list.length && !error ? (
        <div className="bx-mini-empty">
          <Icon id="i-clock" />
          <b>{t('Снимков пока нет')}</b>
          <span>{t('Сделай снимок перед тем, как менять моды — вернуть всё можно в один клик')}</span>
        </div>
      ) : (
        <div className="bx-files-list">
          {list.map((s) => (
            <div className="bx-snap" key={s.id}>
              <Icon id="i-clock" />
              <span className="bx-snap-t">
                <b>
                  {tx(s.label)}
                  <span className="bpg-tag">{s.auto ? t('авто') : t('вручную')}</span>
                </b>
                <small>
                  {[
                    formatRelative(s.at * 1000),
                    s.mods + ' ' + plural(s.mods, t('мод'), t('мода'), t('модов')),
                    t('занимает {size}', { size: sizeText(s.disk) }),
                  ].join(' · ')}
                </small>
              </span>
              <button
                type="button"
                className="btn sm secondary"
                disabled={!!busy || running}
                data-tip={running ? t('Закрой игру, чтобы откатить сборку') : undefined}
                onClick={() => void restore(s)}
              >
                <Icon id="i-restart" /> {busy === s.id ? t('Восстанавливаем…') : t('Восстановить')}
              </button>
              <button type="button" className="icon-btn del" disabled={!!busy} aria-label={t('Удалить')} onClick={() => void remove(s)}>
                <Icon id="i-trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
