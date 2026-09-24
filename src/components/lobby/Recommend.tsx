import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { loadCatalogPacks } from '../playhub/data'
import { cfSearch } from '../../ipc/commands'
import type { CfHit, MillidaPack } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { useMods } from '../../state/mods'
import { modeScene } from '../iso/modeScenes'
import { useLobby } from '../../state/lobbyMode'
import { setScreen } from '../../state/ui'
import { fmtN } from '../../lib/format'
import { trackImpression } from '../../lib/uiTrack'

/**
 * «Рекомендуем» в лобби (владелец 24.09.2026, 13:23): справа по центру, над
 * «Играть» и под верхними кнопками. Каждый заход в лобби — новое: OneBlock,
 * сборка каталога, режим. Нажатие ведёт прямо в неё в «Во что играем».
 */

type Rec =
  | { kind: 'oneblock' }
  | { kind: 'pack'; pack: MillidaPack }
  | { kind: 'map'; map: CfHit }

const KEY = 'm-lobby-rec'
/** Кооперативная карта: в названии или описании — игра вдвоём/с друзьями. */
const COOP = /co-?op|coop|multiplayer|2\s*players?|2-4|friends|вдвоём|с друзьями/i

export function Recommend({ on }: { on: boolean }) {
  const [packs, setPacks] = useState<MillidaPack[]>([])
  const [n, setN] = useState(0)

  const [maps, setMaps] = useState<CfHit[]>([])
  // Рекомендуем только своё платное, OneBlock и карты на прохождение с
  // друзьями (владелец 24.09.2026, 13:58) — остальное здесь не продвигаем.
  useEffect(() => {
    // Любые сборки каталога вперемешку — привыкнуть к блоку (владелец 24.09, 17:22).
    void loadCatalogPacks().then((l) => setPacks([...l].sort(() => Math.random() - 0.5)))
    if (hasTauri())
      void cfSearch('co-op', 'world', '', '', 0, 248, 2)
        .then((l) => setMaps(l.filter((m) => COOP.test(m.name + ' ' + m.summary)).slice(0, 4)))
        .catch(() => {})
  }, [])

  // Новый показ — следующая рекомендация.
  useEffect(() => {
    if (!on) return
    let next = 0
    try {
      next = (Number(localStorage.getItem(KEY)) || 0) + 1
      localStorage.setItem(KEY, String(next))
    } catch {}
    setN(next)
  }, [on])

  const list = useMemo<Rec[]>(() => {
    // Чередуем: сборки каталога, изредка карта с друзьями.
    // OneBlock пока не выходит — не рекомендуем.
    const out: Rec[] = []
    const n = Math.max(packs.length, maps.length)
    for (let i = 0; i < n; i++) {
      if (packs[i]) out.push({ kind: 'pack', pack: packs[i]! })
      if (i % 2 === 1 && maps[(i - 1) / 2]) out.push({ kind: 'map', map: maps[(i - 1) / 2]! })
    }
    return out.length ? out : [{ kind: 'oneblock' }]
  }, [packs, maps])

  const pos = n % list.length
  const rec = list[pos]!
  const recKind = rec.kind === 'oneblock' ? 'mode' : rec.kind
  const recId = rec.kind === 'pack' ? rec.pack.slug : rec.kind === 'map' ? String(rec.map.id) : 'ONEBLOCK'

  // Показ рекомендации — для CTR блока: одна запись на показанную карточку.
  useEffect(() => {
    if (on) trackImpression('recommend', [recKind + ':' + recId], 'play')
  }, [on, recKind, recId])

  const open = () => {
    if (rec.kind === 'map') {
      // Карта — в каталог карт, сразу поиском по её названию.
      useMods.getState().set({ modTab: 'world', mq: rec.map.name })
      void useMods.getState().load()
      setScreen('mods')
      return
    }
    useLobby.setState({ hubTarget: rec.kind === 'pack' ? { pack: rec.pack.slug } : { mode: 'ONEBLOCK' } })
    setScreen('playhub')
  }

  const art =
    rec.kind === 'pack' ? (
      <img className="lrec-cover" src={rec.pack.cover || undefined} alt="" draggable={false} />
    ) : rec.kind === 'map' ? (
      <img className="lrec-cover" src={rec.map.logo || undefined} alt="" draggable={false} />
    ) : (
      <SceneArt cat="ONEBLOCK" sky />
    )
  const title = rec.kind === 'pack' ? rec.pack.title : rec.kind === 'map' ? rec.map.name : 'OneBlock'
  const sub =
    rec.kind === 'pack'
      ? [rec.pack.loader, rec.pack.game].filter(Boolean).join(' · ')
      : rec.kind === 'map'
        ? 'Карта · пройди с друзьями'
        : 'Выживи на одном блоке'

  return (
    <button
      key={n}
      className="lobby-rec"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind={recKind}
      data-id={recId}
      data-pos={pos}
      onClick={open}
    >
      <span className="lrec-art">{art}</span>
      <span className="lrec-body">
        <span className="lrec-lab">Попробуй сегодня</span>
        <b>{title}</b>
        <i>
          {sub}
          {rec.kind === 'pack' && rec.pack.downloads ? (
            <>
              {' · '}
              <Icon id="i-download" /> {fmtN(rec.pack.downloads)}
            </>
          ) : null}
        </i>
      </span>
      <span className="lrec-go">
        Попробовать <Icon id="i-chev-r" />
      </span>
    </button>
  )
}

function SceneArt({ cat, sky }: { cat: string; sky?: boolean }) {
  const a = useMemo(() => {
    const scene = modeScene(cat)
    const k = Math.max(1, Math.floor(Math.min(84 / scene.w, 84 / scene.h) * 2) / 2)
    return { scene, k, bg: sky ? '' : '' }
  }, [cat, sky])
  return (
    <span
      className={'lrec-scene' + (sky ? ' sky' : '')}
      style={a.bg ? ({ backgroundImage: 'url(' + a.bg + ')' } as CSSProperties) : undefined}
    >
      <img src={a.scene.url} width={a.scene.w * a.k} height={a.scene.h * a.k} alt="" draggable={false} />
    </span>
  )
}
