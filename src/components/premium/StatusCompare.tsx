import { useEffect, useState } from 'react'
import { SkinBody } from '../SkinBody'
import { loadWardrobe } from '../../lib/gameProfile'
import { nickSkinUrl } from '../../lib/characterStage'
import { getAccount } from '../../state/accounts'
import { useGameNick } from '../../state/gameNick'
import '../../styles/pixel/nametag.css'
import '../../styles/pixel/status-compare.css'

/**
 * «Как тебя видят в игре» (владелец 06.10.2026): два персонажа с табличкой
 * ника как в Minecraft. Знак — глиф шрифта мода (millida-mod, BadgeMark +
 * textures/font/badge_*.png, 8×8): у игрока с лаунчером зелёный (§a), у
 * подписчика тот же знак с закрытым углом золотом (§6). Знак стоит перед ником
 * и в табличке над головой, и в TAB — его видят все на сервере.
 */

const LAUNCHER = ['#####.##', '#.....##', '#.......', '#..##..#', '#..##..#', '#......#', '#......#', '########']
const PLUS = ['#####.##', '#.....##', '#.....##', '#..##..#', '#..##..#', '#......#', '#......#', '########']

function path(rows: string[], dx = 0, dy = 0) {
  let d = ''
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') d += `M${x + dx} ${y + dy}h1v1h-1z`
  })
  return d
}

/** Знак у ника: цвет и тень как у текста игры (тень = цвет / 4). */
export function BadgeGlyph({ plus, size = 16 }: { plus?: boolean; size?: number }) {
  const rows = plus ? PLUS : LAUNCHER
  return (
    <svg className={'mc-badge' + (plus ? ' is-plus' : '')} viewBox="0 0 9 9" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      <path d={path(rows, 1, 1)} fill={plus ? '#3F2A00' : '#153F15'} />
      <path d={path(rows)} fill={plus ? '#FFAA00' : '#55FF55'} />
    </svg>
  )
}

let skinAsked: Promise<string | null> | null = null
function useOwnSkin(): string {
  const nick = (getAccount() || { nick: '' }).nick || 'MHF_Steve'
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    if (!skinAsked) skinAsked = loadWardrobe().then((w) => w.active.skinUrl || null).catch(() => null)
    void skinAsked.then((u) => alive && setUrl(u || nickSkinUrl(nick)))
    return () => {
      alive = false
    }
  }, [nick])
  return url
}

export function StatusCompare({ compact = false, row = false }: { compact?: boolean; row?: boolean }) {
  const gameName = useGameNick((s) => s.name)
  const nick = gameName || (getAccount() || { nick: '' }).nick || 'Steve'
  const skin = useOwnSkin()
  const h = row ? 80 : compact ? 96 : 132
  const fig = (plus: boolean) => (
    <figure className={'sc-fig' + (plus ? ' is-plus' : '')}>
      <span className="sc-stage">
        <span className="mc-nametag sc-tag">
          <BadgeGlyph plus={plus} size={compact ? 14 : 17} />
          <span>{nick}</span>
        </span>
        {skin ? <SkinBody url={skin} height={h} /> : <span className="skel" style={{ width: h / 2, height: h }} />}
      </span>
      <figcaption>{plus ? 'С PLUS' : 'Обычные игроки'}</figcaption>
    </figure>
  )
  return (
    <div className={'sc' + (compact || row ? ' is-compact' : '') + (row ? ' is-row' : '')}>
      <div className="sc-pair">
        {fig(false)}
        {fig(true)}
      </div>
      <p className="sc-line">Золотой знак у ника в игре</p>
    </div>
  )
}

/**
 * Одна табличка ника для плитки PLUS (владелец 06.10.2026: «компактно, в одну
 * строку»): знак у ника переключается — зелёный «без PLUS» → золотой «с PLUS»
 * и обратно. Знак — тот же глиф мода (BadgeGlyph). Без движения — два чипа рядом.
 */
export function NickFlip() {
  const gameName = useGameNick((s) => s.name)
  const nick = gameName || (getAccount() || { nick: '' }).nick || 'Steve'
  const face = (plus: boolean) => (
    <span className={'nf-face' + (plus ? ' is-plus' : '')}>
      <small>{plus ? 'с PLUS' : 'без PLUS'}</small>
      <span className="mc-nametag nf-tag">
        <BadgeGlyph plus={plus} size={14} />
        <span>{nick}</span>
      </span>
    </span>
  )
  return (
    <span className="nf" aria-label="Золотой знак у ника в игре">
      {face(false)}
      {face(true)}
    </span>
  )
}
