import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { fmtSize } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { copyText } from '../lib/clipboard'
import { backdropClose } from '../lib/dismiss'
import { showToast } from '../state/ui'
import { myPacks, shareProfile, unshareProfile, type SharedPack } from '../ipc/commands'

interface Props {
  profile: string
  onClose: () => void
}

/// Publishing a build: the code and the link are the whole point, so they are
/// the first thing on screen once it lands.
export function SharePackModal({ profile, onClose }: Props) {
  const [summary, setSummary] = useState('')
  const [pack, setPack] = useState<SharedPack | null>(null)
  const [busy, setBusy] = useState(false)
  const [revoked, setRevoked] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // A build has one code and it lives until revoked: if it was already issued,
  // show it right away instead of republishing for the same value.
  useEffect(() => {
    if (!hasTauri()) return
    let cancelled = false
    void myPacks()
      .then((list) => {
        const mine = list.find((x) => x.name === profile)
        if (!mine || cancelled) return
        setPack({
          code: mine.code,
          url: 'https://millida.net/p/' + mine.code,
          files: mine.files,
          skipped: [],
          sizeBytes: 0,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [profile])

  const publish = () => {
    if (!hasTauri()) return
    setBusy(true)
    shareProfile(profile, summary.trim() || undefined)
      .then((fresh) => {
        setRevoked(false)
        setPack(fresh)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-bg open vis" style={{ zIndex: 215 }} {...backdropClose(onClose)}>
      <div className="modal mw-sm">
        <div className="crash-head">
          <span className="crash-ic ok">
            <Icon id="i-link" />
          </span>
          <div>
            <h3>Поделиться сборкой</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              «{profile}»
            </div>
          </div>
        </div>

        {pack ? (
          <>
            <div className="share-code">{pack.code.slice(0, 4) + '-' + pack.code.slice(4)}</div>
            <p className="faint-note" style={{ textAlign: 'center' }}>
              Друг вводит этот код в лаунчере — и получает ту же сборку: {pack.files} файлов
              {pack.sizeBytes ? ', ' + fmtSize(pack.sizeBytes) + ' описания вместо гигабайтов' : ''}.
            </p>
            <div className="wm-row" style={{ marginTop: '12px' }}>
              <div className="input sm" style={{ flex: 1 }}>
                <input readOnly value={pack.url} />
              </div>
              <button
                className="btn sm secondary"
                onClick={() => {
                  void copyText(pack.url)
                  showToast('Ссылка скопирована', 'ok')
                }}
              >
                <Icon id="i-copy" /> Ссылка
              </button>
            </div>
            {pack.skipped.length ? (
              <p className="faint-note" style={{ marginTop: '10px' }}>
                Не поедут файлы, которых нет в каталогах ({pack.skipped.length}):{' '}
                {pack.skipped.slice(0, 4).join(', ')}
                {pack.skipped.length > 4 ? ' и другие' : ''}. Их придётся передать отдельно.
              </p>
            ) : null}
            {/* Код живёт, пока автор его не отозвал: без этой кнопки сборку,
                которой поделились по ошибке, нельзя было убрать из доступа. */}
            <button
              className="btn sm ghost"
              style={{ marginTop: '10px' }}
              disabled={busy || revoked}
              onClick={() => {
                setBusy(true)
                unshareProfile(pack.code)
                  .then(() => {
                    setRevoked(true)
                    setPack(null)
                    showToast('Код отозван — по нему сборка больше не ставится', 'ok')
                  })
                  .catch((e) => showToast('' + e, 'error'))
                  .finally(() => setBusy(false))
              }}
            >
              {revoked ? 'Код отозван' : 'Убрать из общего доступа'}
            </button>
          </>
        ) : (
          <>
            <p className="faint-note">
              Уедет только описание сборки: версия, ядро и список модов из Modrinth и CurseForge с их
              хешами. Сами файлы друг скачает из каталогов — так сборка занимает килобайты и остаётся
              проверяемой.
            </p>
            <div className="input sm" style={{ marginTop: '12px' }}>
              <input
                placeholder="Короткое описание (необязательно)"
                maxLength={300}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          {pack ? (
            <button
              className="btn md primary"
              style={{ flex: 1 }}
              onClick={() => {
                void copyText(pack.code)
                showToast('Код скопирован', 'ok')
              }}
            >
              <Icon id="i-copy" /> Скопировать код
            </button>
          ) : (
            <button className="btn md primary" style={{ flex: 1 }} disabled={busy} onClick={publish}>
              {busy ? 'Готовим…' : 'Получить код'}
            </button>
          )}
          <button className="btn md secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
