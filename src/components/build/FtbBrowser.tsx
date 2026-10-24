import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ftbInstall, ftbSearch } from '../../ipc/commands'
import type { FtbPack, Profile } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { backdropClose } from '../../lib/dismiss'
import { fmt } from '../../lib/format'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

const SEARCH_DELAY_MS = 350

/** Feed The Beast packs from their public API: search and install as a new build. */
export function FtbBrowser({ onClose, onInstalled }: { onClose: () => void; onInstalled: (p: Profile) => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [list, setList] = useState<FtbPack[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    if (!hasTauri()) {
      setList([])
      setError(t('Доступно в приложении'))
      return
    }
    const mine = ++seq.current
    const timer = setTimeout(() => {
      setList(null)
      setError('')
      ftbSearch(q)
        .then((r) => mine === seq.current && setList(r))
        .catch((e) => {
          if (mine !== seq.current) return
          setList([])
          setError(apiErrorText(e, t('FTB не ответил — попробуй позже')))
        })
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const install = (p: FtbPack) => {
    setBusy(p.id)
    ftbInstall(p.id)
      .then(onInstalled)
      .catch((e) => showToast(apiErrorText(e, t('Не удалось поставить сборку FTB')), 'error'))
      .finally(() => setBusy(0))
  }

  return createPortal(
    <div className="modal-bg open vis" style={{ zIndex: 960 }} {...backdropClose(() => !busy && onClose())}>
      <div className="modal mw-md">
        <h3>Feed The Beast</h3>
        <label className="input bpg-search">
          <Icon id="i-search" />
          <input autoFocus value={q} placeholder={t('Найти сборку')} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        </label>
        {error ? <p className="faint-note">{error}</p> : null}
        <div className="bx-upd-list">
          {list === null
            ? [0, 1, 2].map((i) => <div className="bx-file skel" key={i} />)
            : !list.length && !error
              ? <p className="faint-note">{t('Ничего не нашлось')}</p>
              : list.map((p) => (
                  <div className="bx-ftb" key={p.id}>
                    <span className="bpg-art">{p.icon ? <img src={p.icon} alt="" loading="lazy" /> : <Icon id="i-box" />}</span>
                    <span className="bx-ftb-t">
                      <b>{p.name}</b>
                      <small>{[p.mc, p.loader, p.version, p.installs ? t('{n} установок', { n: fmt(p.installs) }) : ''].filter(Boolean).join(' · ')}</small>
                    </span>
                    <button className="btn sm primary" disabled={!!busy} onClick={() => install(p)}>
                      {busy === p.id ? t('Ставим…') : t('Поставить')}
                    </button>
                  </div>
                ))}
        </div>
        <div className="bx-upd-acts">
          <button className="btn md secondary" disabled={!!busy} onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
