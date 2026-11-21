import { useEffect, type ReactNode } from 'react'
import { Icon } from '../Icon'
import type { CloudBackupItem } from '../../ipc/worldBackups'
import { fmtSize } from '../../lib/format'
import { uiConfirm } from '../../state/confirm'
import {
  cancelCloudTransfer,
  cloudRestoreKey,
  deleteFromCloud,
  refreshCloudBackups,
  restoreFromCloud,
  useCloudBackups,
  type CloudTransfer,
} from '../../state/cloudBackups'
import { setScreen } from '../../state/ui'
import { intlTag, useT } from '../../i18n'
import './worldBackups.css'

const GB = 1024 * 1024 * 1024

interface Props {
  /** The build a copy is restored into, as a new world. */
  profile: string
  /** A copy became a world here: the world list reads the disk again. */
  onRestored?: () => void
  /** Where «PLUS» leads; by default the PLUS screen. */
  onOpenPlus?: () => void
}

/** «Облако»: world copies on the Millida account (PLUS). Visible without PLUS too, with the way to get it. */
export function CloudWorldBackups({ profile, onRestored, onOpenPlus }: Props) {
  const t = useT()
  const status = useCloudBackups((s) => s.status)
  const loading = useCloudBackups((s) => s.loading)
  const error = useCloudBackups((s) => s.error)
  const transfers = useCloudBackups((s) => s.transfers)

  useEffect(() => {
    void refreshCloudBackups()
  }, [])

  const size = (b: number) => (b >= GB ? t('{n} ГБ', { n: Number((b / GB).toFixed(1)) }) : fmtSize(b))
  const day = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(intlTag(), { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  const phaseText: Record<CloudTransfer['phase'], string> = {
    pack: t('Готовим архив'),
    hash: t('Проверяем файл'),
    upload: t('Загружаем'),
    download: t('Скачиваем'),
    restore: t('Распаковываем'),
  }
  const openPlus = onOpenPlus ?? (() => setScreen('plus'))

  const restore = (item: CloudBackupItem) => {
    void restoreFromCloud(profile, item).then((w) => {
      if (w) onRestored?.()
    })
  }

  const remove = (item: CloudBackupItem) => {
    void uiConfirm(t('Удалить копию мира «{name}» из облака? На этом ПК ничего не изменится.', { name: item.world }), {
      title: t('Удаление копии'),
      confirmLabel: t('Удалить'),
    }).then((ok) => {
      if (ok) void deleteFromCloud(item)
    })
  }

  const active = Object.entries(transfers)

  let body: ReactNode
  if (!status && loading) {
    body = (
      <div className="bx-skel-list" aria-busy="true">
        <span className="skel" />
      </div>
    )
  } else if (!status) {
    body = error ? (
      <div className="wcb-gate">
        <span>{error}</span>
        <button type="button" className="btn sm secondary" onClick={() => void refreshCloudBackups()}>
          {t('Повторить')}
        </button>
      </div>
    ) : (
      <p className="faint-note">{t('Доступно в приложении')}</p>
    )
  } else if (!status.signedIn) {
    body = (
      <div className="wcb-gate">
        <span>{t('Войди в аккаунт Millida, чтобы хранить миры в облаке')}</span>
      </div>
    )
  } else if (!status.plus) {
    body = (
      <div className="wcb-gate" id="bsCloudPlus">
        <span>{t('Копии миров в облаке — с PLUS: {size} на все сборки, до {n} копий каждого мира', { size: size(status.quotaBytes), n: status.maxPerWorld })}</span>
        <button type="button" className="btn sm secondary" data-track="cloud_backups_plus" onClick={openPlus}>
          <Icon id="i-crown" /> {t('Подключить PLUS')}
        </button>
      </div>
    )
  } else {
    const share = status.quotaBytes > 0 ? Math.min(100, (status.usedBytes / status.quotaBytes) * 100) : 0
    const items = [...status.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    body = (
      <>
        <div className="wcb-head">
          <span className="wcb-used">
            <span className="wcb-used-txt">{t('Занято {used} из {quota}', { used: size(status.usedBytes), quota: size(status.quotaBytes) })}</span>
            <span
              className={'wcb-meter' + (share >= 95 ? ' full' : '')}
              role="progressbar"
              aria-label={t('Место в облаке')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share)}
            >
              <span style={{ width: share + '%' }} />
            </span>
          </span>
          <button type="button" className="btn sm ghost" disabled={loading} onClick={() => void refreshCloudBackups()}>
            <Icon id="i-restart" /> {t('Обновить')}
          </button>
        </div>
        {error ? <p className="faint-note">{error}</p> : null}
        {items.length ? (
          <div className="wcb-list" id="bsCloudList">
            {items.map((item) => {
              const restoring = !!transfers[cloudRestoreKey(item.id)]
              return (
                <div className="wcb-row" key={item.id}>
                  <span className="wcb-row-body">
                    <b>{item.world}</b>
                    <span className="wcb-row-meta">{[item.build, day(item.createdAt), size(item.bytes)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button type="button" className="btn sm secondary" disabled={restoring} onClick={() => restore(item)}>
                    {t('Восстановить на этот ПК')}
                  </button>
                  <button type="button" className="icon-btn del" aria-label={t('Удалить из облака')} disabled={restoring} onClick={() => remove(item)}>
                    <Icon id="i-trash" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="faint-note">{t('В облаке пока нет копий — нажми «В облако» у мира')}</p>
        )}
      </>
    )
  }

  return (
    <section className="bpg-sec" id="bsCloudBackups">
      <h3 className="bpg-sec-h">{t('Облако')}</h3>
      {body}
      {active.map(([key, p]) => {
        const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
        return (
          <div className="wcb-progress" key={key}>
            <span className="wcb-progress-txt">
              {phaseText[p.phase]} · {p.world}
            </span>
            <span className="wcb-meter" role="progressbar" aria-label={phaseText[p.phase]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: pct + '%' }} />
            </span>
            <span className="wcb-progress-txt">{p.total > 0 ? pct + '%' : ''}</span>
            <button type="button" className="btn sm ghost" onClick={() => cancelCloudTransfer(key)}>
              {t('Отмена')}
            </button>
          </div>
        )
      })}
    </section>
  )
}
