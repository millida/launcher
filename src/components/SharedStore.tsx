import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { dedupeGc, dedupeRun, dedupeScan, type DedupReport } from '../ipc/commands'

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)

/// Shared file store. Eight builds with the same optimisation mods used to weigh
/// eight times as much; the numbers here are what that costs and what sharing
/// gives back.
export function SharedStore() {
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
          r.note || (r.linked ? `Общими стали ${r.linked} файлов — экономия ${mb(r.savedBytes)} МБ` : 'Дублей не нашлось'),
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
        showToast(freed ? `Освобождено ${mb(freed)} МБ` : 'Лишних файлов в хранилище нет', 'ok')
        return dedupeScan().then(setReport)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  return (
    <div className="set-row">
      <span className="lab">
        Общее хранилище модов
        <small>
          {busy === 'scan' || !report
            ? 'Считаем, сколько файлов повторяется в сборках…'
            : report.savedBytes
              ? `${report.files} файлов в сборках, ${report.unique} разных. Общими они занимают на ${mb(report.savedBytes)} МБ меньше`
              : 'Повторяющихся модов между сборками нет'}
        </small>
      </span>
      <button className="btn sm secondary" disabled={busy !== ''} onClick={run}>
        <Icon id="i-zap" /> {busy === 'run' ? 'Объединяем…' : 'Объединить'}
      </button>
      <button
        className="btn sm secondary"
        disabled={busy !== ''}
        title="Убрать из хранилища файлы, которых больше нет ни в одной сборке"
        onClick={gc}
      >
        {busy === 'gc' ? 'Чистим…' : 'Подчистить'}
      </button>
    </div>
  )
}
