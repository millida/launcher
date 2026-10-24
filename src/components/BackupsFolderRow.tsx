import { useEffect, useRef, useState } from 'react'
import { Row } from './SetKit'
import { hasTauri } from '../ipc/tauri'
import { backupsRootDir, pickBackupsRoot, resetBackupsRoot } from '../ipc/commands'
import { coreErrorText } from '../lib/coreErrors'
import { showToast } from '../state/ui'
import { useT } from '../i18n'

export function BackupsFolderRow() {
  const t = useT()
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!hasTauri()) return
    const mine = ++seq.current
    backupsRootDir()
      .then((d) => {
        if (mine === seq.current) setDir(d)
      })
      .catch(() => {})
  }, [])

  const pick = async () => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    setBusy(true)
    try {
      const chosen = await pickBackupsRoot()
      if (chosen) {
        seq.current++
        setDir(chosen)
        showToast(t('Новые бэкапы миров будут в этой папке'))
      }
    } catch (e) {
      showToast(coreErrorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await resetBackupsRoot()
      seq.current++
      setDir(null)
    } catch (e) {
      showToast(coreErrorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Row title={t('Папка бэкапов')} hint={dir ?? t('В папке каждой сборки')} keys="бэкап резервная копия мир снимок папка">
      <button className="btn sm secondary" onClick={() => void pick()} disabled={busy}>
        {t('Сменить')}
      </button>
      {dir ? (
        <button className="btn sm secondary" onClick={() => void reset()} disabled={busy}>
          {t('Сбросить')}
        </button>
      ) : null}
    </Row>
  )
}
