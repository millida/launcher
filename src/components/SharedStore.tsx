import { useEffect, useState } from 'react'
import { Row } from './SetKit'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { dedupeGc, dedupeRun, dedupeScan, type DedupReport } from '../ipc/commands'
import { useT } from '../i18n'

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)

/// Shared file store. Eight builds with the same optimisation mods used to weigh
/// eight times as much; the numbers here are what that costs and what sharing
/// gives back.
export function SharedStore() {
  const t = useT()
  const [report, setReport] = useState<DedupReport | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!hasTauri()) return
    setBusy('scan')
    dedupeScan()
      .then(setReport)
      .catch(() => {})
      .finally(() => setBusy(''))
  }, [])

  const run = () => {
    setBusy('run')
    dedupeRun()
      .then((r) => {
        setReport(r)
        showToast(
          r.note || (r.linked ? t('Общими стали {n} файлов — экономия {mb} МБ', { n: r.linked, mb: mb(r.savedBytes) }) : t('Дублей не нашлось')),
          r.note ? 'error' : 'ok',
        )
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  const gc = () => {
    setBusy('gc')
    dedupeGc()
      .then((freed) => {
        showToast(freed ? t('Освобождено {mb} МБ', { mb: mb(freed) }) : t('Лишних файлов в хранилище нет'), 'ok')
        return dedupeScan().then(setReport)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  return (
    <Row
      title={t('Общие моды')}
      keys="общее хранилище моды дубли повторы место объединить"
      hint={
        busy === 'scan' || !report
          ? t('Считаем повторы…')
          : report.savedBytes
            ? t('Повторов на {mb} МБ', { mb: mb(report.savedBytes) })
            : t('Повторов между сборками нет')
      }
    >
      <button className="btn sm secondary" disabled={busy !== ''} onClick={run}>
        {busy === 'run' ? t('Объединяем…') : t('Объединить')}
      </button>
      <button
        className="btn sm ghost"
        disabled={busy !== ''}
        data-tip={t('Убрать файлы, которых больше нет ни в одной сборке')}
        onClick={gc}
      >
        {busy === 'gc' ? t('Чистим…') : t('Подчистить')}
      </button>
    </Row>
  )
}
