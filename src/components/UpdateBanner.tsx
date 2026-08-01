import { Icon } from './Icon'
import { useUpdate } from '../state/update'
import { applyUpdate } from '../lib/updater'

export function UpdateBanner() {
  const version = useUpdate((s) => s.version)
  const staged = useUpdate((s) => s.staged)
  const busy = useUpdate((s) => s.busy)
  const manual = useUpdate((s) => s.manual)
  const failed = useUpdate((s) => s.failed)
  if (!version) return null

  const label = failed
    ? 'Обновление ' + version + ' — скачай с сайта'
    : staged
      ? 'Обновление ' + version + (manual ? ' готово — поставим при выходе' : ' встанет при выходе')
      : 'Качаем обновление ' + version + '…'

  return (
    <div
      style={{
        position: 'fixed',
        top: '62px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '10px 12px 10px 18px',
        borderRadius: '999px',
        background: 'var(--m-accent)',
        color: '#fff',
        boxShadow: '0 10px 30px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.12) inset',
        maxWidth: 'calc(100% - 40px)',
        animation: 'updDrop .4s cubic-bezier(.2,.9,.3,1)',
      }}
    >
      <style>{'@keyframes updDrop{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}'}</style>
      <span style={{ display: 'grid', placeItems: 'center', width: '26px', height: '26px', flex: 'none' }}>
        <Icon id="i-download" />
      </span>
      <span style={{ fontSize: '13.5px', fontWeight: 650, whiteSpace: 'nowrap' }}>{label}</span>
      <button
        onClick={() => void applyUpdate()}
        disabled={busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '7px',
          height: '34px',
          padding: '0 16px',
          borderRadius: '999px',
          background: '#fff',
          color: 'var(--m-accent)',
          fontSize: '13px',
          fontWeight: 700,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.75 : 1,
          flex: 'none',
        }}
      >
        {busy ? (
          <>
            <span className="spin" style={{ width: '14px', height: '14px' }}></span>
            Обновляем…
          </>
        ) : (
          <>
            <Icon id={failed ? 'i-download' : 'i-restart'} />
            {failed ? 'Скачать с сайта' : 'Обновить сейчас'}
          </>
        )}
      </button>
    </div>
  )
}
