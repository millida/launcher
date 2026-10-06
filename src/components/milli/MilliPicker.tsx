import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { mirrorAsset } from '../../lib/api'
import type { MilliLooks } from '../../lib/milli'
import { closePicker, pickLook, useMilliPicker } from '../../state/milliPicker'
import { LookPic } from './bench/BenchShaders'
import '../../styles/pixel/milli-picker.css'

const fmt = (n?: number) => (!n ? '' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс.' : String(n))

/** Варианты ресурс-пака / шейдера в сообщении Милли: навёл — ожил, нажал — улетел в сборку. */
export function MilliPicker({ msgId, looks, active }: { msgId: string; looks: MilliLooks; active: boolean }) {
  const done = useMilliPicker((s) => s.done[msgId])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => box.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 120)
    return () => window.clearTimeout(t)
  }, [active])
  // Выбрал — карточки доигрывают анимацию и сворачиваются.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setGone(true), 650)
    return () => window.clearTimeout(t)
  }, [done])
  // Выбор сделан / закрыт / ушли дальше по разговору — варианты больше не висят.
  if (gone || done === '' || (!active && done === undefined)) return null
  const p = { kind: looks.kind, picked: done ?? null }
  const items = looks.items
  return (
    <div className={'mpk-pick' + (p.picked ? ' is-leaving' : '')} ref={box}>
        <div className="mpk-pick-grid" role="list">
          {items.map((it, i) => (
                <button
                  key={it.projectId}
                  type="button"
                  role="listitem"
                  className={'mpk-pick-card' + (p.picked === it.projectId ? ' is-picked' : p.picked ? ' is-out' : '')}
                  style={{ '--i': i } as CSSProperties}
                  title={it.descriptionRu || it.description || it.title}
                  data-track="milli_pick_look"
                  onClick={() => pickLook(msgId, looks.kind, it)}
                >
                  <LookPic
                    src={it.preview ? mirrorAsset(it.preview) ?? null : null}
                    icon={it.icon ? mirrorAsset(it.icon) ?? null : null}
                    px={p.kind === 'rp' ? 'painting' : 'glowstone_bright'}
                    className="mpk-pick-pic"
                    eager
                  />
                  <span className="mpk-pick-t">
                    <b>{it.title}</b>
                    {it.downloads ? <i>{fmt(it.downloads)}</i> : null}
                  </span>
                  <span className="mpk-pick-go" aria-hidden="true">
                    Взять
                  </span>
                </button>
              ))}
        </div>
        {!p.picked ? (
          <button type="button" className="mpk-pick-x" onClick={() => closePicker(msgId)}>
            Не надо
          </button>
        ) : null}
    </div>
  )
}
