import { useEffect, useState, type CSSProperties } from 'react'
import { Icon } from '../Icon'
import { loadCapeCatalog, loadMojangCapes, type CapeCatalogItem, type MojangCape } from '../../lib/gameProfile'
import { installFromCatalog } from '../../lib/catalogInstall'
import { setScreen } from '../../state/ui'

/**
 * Раздел «Плащи» в каталоге (владелец 12.10.2026: «там нет плащей, там просто
 * какая-то плашка»). Раньше здесь стояли две кнопки «Гардероб» и «На сайте».
 * Теперь — сами плащи: каталог Millida (открытые надеваются сразу, у закрытых
 * видно условие и сколько до него осталось) и плащи Mojang, которые носят те,
 * у кого они есть на лицензии.
 */

const RARITY: Record<string, string> = { legendary: '#b8862b', epic: '#7a3fb8', rare: '#2b63c4', common: '#4a5560' }

/** Условие одной строкой: у сервера оно идёт с пояснением через тире. */
const shortNeed = (text?: string) => (text || '').split(' — ')[0]!.trim()

/** Лицевая сторона плаща — участок (1,1) 10×16 на текстуре 64×32; у HD-плащей пропорции те же. */
function CapeArt({ url }: { url: string }) {
  return <span className="cp-art" style={{ backgroundImage: "url('" + url + "')" }} />
}

function MillidaCape({ c }: { c: CapeCatalogItem }) {
  const [busy, setBusy] = useState(false)
  const open = c.unlocked !== false
  const need = shortNeed(c.requirement)
  const wear = async () => {
    if (busy) return
    setBusy(true)
    await installFromCatalog('capes', c.id)
    setBusy(false)
  }
  return (
    <article className={'cp-card' + (open ? '' : ' locked')} style={{ '--cp': RARITY[c.rarity || 'common'] || RARITY.common } as CSSProperties} data-track="cape_card" data-id={c.id}>
      <button className="cp-face" aria-label={c.name} onClick={() => setScreen('skins')}>
        <CapeArt url={c.url} />
        {open ? null : (
          <span className="cp-lock">
            <Icon id="i-lock" />
          </span>
        )}
      </button>
      <b className="cp-name">{c.name}</b>
      {open ? (
        <button className="btn sm primary cp-act" data-track="cape_wear" data-id={c.id} disabled={busy} onClick={() => void wear()}>
          Надеть
        </button>
      ) : (
        <>
          <span className="cp-need">{need}</span>
          {typeof c.progress === 'number' && c.progress > 0 ? (
            <span className="cp-bar" aria-label={'Выполнено ' + Math.round(c.progress) + '%'}>
              <span style={{ width: Math.min(100, Math.round(c.progress)) + '%' }} />
            </span>
          ) : null}
        </>
      )}
    </article>
  )
}

function Skeleton() {
  return (
    <div className="cp-grid" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div className="cp-card" key={i}>
          <span className="cp-face skel" />
          <span className="skel cp-skel-line" />
        </div>
      ))}
    </div>
  )
}

export function CapesPane() {
  const [own, setOwn] = useState<CapeCatalogItem[] | null>(null)
  const [mojang, setMojang] = useState<MojangCape[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [turn, setTurn] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    void loadCapeCatalog()
      .then((l) => alive && setOwn(Array.isArray(l) ? l : []))
      .catch(() => alive && setFailed(true))
    void loadMojangCapes()
      .then((r) => alive && setMojang(Array.isArray(r?.items) ? r.items : []))
      .catch(() => alive && setMojang([]))
    return () => {
      alive = false
    }
  }, [turn])

  // Открытые — первыми: их можно надеть прямо сейчас.
  const mine = own ? [...own].sort((a, b) => Number(b.unlocked !== false) - Number(a.unlocked !== false)) : null

  return (
    <div className="mr-main cp" data-section="capes">
      <header className="mr-head">
        <h1 className="mr-h1">Плащи для Minecraft</h1>
      </header>
      {failed ? (
        <div className="card cp-fail">
          <b>Плащи не загрузились</b>
          <button className="btn sm primary" onClick={() => setTurn((n) => n + 1)}>
            Повторить
          </button>
        </div>
      ) : (
        <>
          <h2 className="cp-cap">
            Millida{mine ? <span>{mine.length}</span> : null}
          </h2>
          {mine ? (
            <div className="cp-grid">
              {mine.map((c) => (
                <MillidaCape key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <Skeleton />
          )}
          {mojang && mojang.length ? (
            <>
              <h2 className="cp-cap">
                Mojang<span>{mojang.length}</span>
              </h2>
              <div className="cp-grid">
                {mojang.map((c) => (
                  <article className="cp-card mojang" key={c.id} data-track="cape_card" data-id={c.id}>
                    <button className="cp-face" aria-label={c.name} onClick={() => setScreen('skins')}>
                      <CapeArt url={c.url} />
                    </button>
                    <b className="cp-name">{c.name}</b>
                    <span className="cp-need">На лицензии</span>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
