import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { api, openExt } from '../../lib/api'
import { cachedCatalog } from '../../lib/catalogCache'
import { installFromCatalog } from '../../lib/catalogInstall'
import { loadMine3d } from '../../lib/mine3d'
import type { Mine3dModule } from '../../lib/mine3d'
import { MILLIDA_LIGHT, releaseEngine } from '../../lib/characterStage'
import { textureSource } from '../../lib/textureSource'
import { capFirst, fmtNum, plural } from './site'
import type { SkinTile } from './site'
import { Back } from './ItemPage'
import { dropItem, openItem } from './itemStore'
import { useSkinTag } from './skinTag'

/*
 * Страница скина (владелец 10.10.2026: «внутри просто полная хуйня»): фигура в 3D —
 * крутится мышкой и сама поворачивается, рядом — метки (клик — такие же скины),
 * сколько носят и скачали, на каких серверах в нём ходят, «Надеть», PNG и похожие.
 */

interface SkinDetail {
  tags?: { slug: string; label: string }[]
  views?: number
  downloads?: number
  textureUrl?: string
  downloadUrl?: string
  servers?: { slug: string; name: string; wearers: number }[]
  related?: SkinTile[]
}

const loadSkin = (id: string) => cachedCatalog('site:/skins/' + id, () => api<SkinDetail>('/skins/' + encodeURIComponent(id)), { persist: true })

/** Имя скина без «Скин:» и с заглавной. */
export const skinName = (title: string) => capFirst(title.replace(/^Скин:\s*/i, ''))

function SkinStage({ texture, slim, fallback }: { texture: string | null; slim: boolean; fallback: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [m3d, setM3d] = useState<Mine3dModule | null>(null)
  const [ready, setReady] = useState(false)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    let alive = true
    void loadMine3d()
      .then((m) => alive && setM3d(m))
      .catch(() => alive && setBroken(true))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    const c = canvas.current
    if (!m3d || !c || !texture) return
    let engine: InstanceType<Mine3dModule['SkinViewEngine']>
    try {
      engine = new m3d.SkinViewEngine(c, { autoResize: true, autoDetectModel: false, transparent: true, enableControls: true, idleAnimation: true })
    } catch {
      setBroken(true)
      return
    }
    let alive = true
    engine.applyLightSettings(MILLIDA_LIGHT)
    engine.setContactShadowVisible(true)
    engine.setModelType(slim ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
    engine.setAutoRotate(true)
    engine.start()
    void textureSource(texture)
      .then((src) => engine.setSkin(src))
      .then(() => {
        if (!alive) return
        engine.fitPlayerToFrame()
        setReady(true)
      })
      .catch(() => alive && setBroken(true))
    return () => {
      alive = false
      setReady(false)
      releaseEngine(engine)
    }
  }, [m3d, texture, slim])
  return (
    <div className={'card sk-stage' + (ready && !broken ? ' is-3d' : '')}>
      {/* Пока 3D собирается (или не вышло) — та же фигура картинкой, без пустого окна. */}
      <img className="sk-flat" src={fallback} alt="" draggable={false} />
      {broken ? null : <canvas ref={canvas} className="sk-canvas" aria-label="Скин в 3D: потяни, чтобы повернуть" />}
      {ready && !broken ? (
        <span className="sk-hint">
          <Icon id="i-restart" /> Потяни, чтобы повернуть
        </span>
      ) : null}
    </div>
  )
}

export function SkinPage({ k }: { k: SkinTile }) {
  const name = skinName(k.title)
  const [d, setD] = useState<SkinDetail | null>(null)
  useEffect(() => {
    let alive = true
    setD(null)
    void loadSkin(k.id)
      .then((x) => alive && setD(x))
      .catch(() => alive && setD({}))
    return () => {
      alive = false
    }
  }, [k.id])
  const tags = (d && d.tags) || k.tags || []
  const slim = k.model === 'slim'
  const texture = (d && d.textureUrl) || k.textureUrl || null
  const related = ((d && d.related) || []).filter((x) => x && x.id !== k.id).slice(0, 12)
  const servers = ((d && d.servers) || []).filter((s) => s && s.name).slice(0, 6)
  const facts: { n: number; label: string }[] = []
  if (k.wearers > 0) facts.push({ n: k.wearers, label: plural(k.wearers, 'носит', 'носят', 'носят') })
  if (d && d.downloads) facts.push({ n: d.downloads, label: plural(d.downloads, 'скачал', 'скачали', 'скачали') })
  if (d && d.views) facts.push({ n: d.views, label: plural(d.views, 'просмотр', 'просмотра', 'просмотров') })
  const wear = () => void installFromCatalog('skins', k.id, { name, slim })
  return (
    <div className="ci sk-page" data-section="item" data-kind="skin" data-id={k.id}>
      <Back label="Скины" />
      <div className="sk-grid">
        <SkinStage texture={texture} slim={slim} fallback={k.renderUrl} />
        <div className="sk-side">
          <h1 className="ci-h1 sk-title">{name}</h1>
          <div className="sk-facts">
            <span className="sk-fact">
              <PxIcon name="shirt" size={12} />
              {slim ? 'Тонкие руки' : 'Классические руки'}
            </span>
            {facts.map((f) => (
              <span key={f.label} className="sk-fact">
                <b>{fmtNum(f.n)}</b> {f.label}
              </span>
            ))}
          </div>
          {tags.length ? (
            <div className="sk-tags" aria-label="Метки">
              {tags.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className="sk-tag"
                  data-track="skin_tag"
                  data-id={t.slug}
                  onClick={() => {
                    useSkinTag.getState().set({ slug: t.slug, label: t.label })
                    // Новая выдача по метке — с верха, а не там, где листали до скина.
                    dropItem()
                    requestAnimationFrame(() => document.querySelector('.content')?.scrollTo({ top: 0 }))
                  }}
                >
                  #{t.label}
                </button>
              ))}
            </div>
          ) : d === null ? (
            <div className="sk-tags">
              {[70, 96, 60].map((w, i) => (
                <span key={i} className="sk-tag skel-text" style={{ width: w }} />
              ))}
            </div>
          ) : null}
          <div className="sk-acts">
            <button className="btn lg primary" data-track="skin_wear" onClick={wear}>
              <PxIcon name="shirt" size={14} />
              Надеть
            </button>
            {d && d.downloadUrl ? (
              <button className="btn lg secondary" data-track="skin_png" onClick={() => openExt(d.downloadUrl!)}>
                <Icon id="i-download" />
                PNG
              </button>
            ) : null}
            <button className="btn lg ghost" data-track="item_site" onClick={() => openExt('https://millida.net/skins/katalog/' + k.id)}>
              <Icon id="i-ext" />
              На сайте
            </button>
          </div>
          <p className="sk-note">«Надеть» — скин сразу появится в гардеробе и на твоём персонаже.</p>
          {servers.length ? (
            <section className="sk-servers" aria-label="Где носят">
              <h2 className="sk-h2">В нём ходят на серверах</h2>
              <div className="sk-srv-list">
                {servers.map((s) => (
                  <span key={s.slug} className="sk-srv">
                    <b>{s.name}</b>
                    <small>{fmtNum(s.wearers)}</small>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {related.length ? (
        <section className="sk-related" aria-label="Похожие скины">
          <h2 className="sk-h2">Похожие скины</h2>
          <div className="mr-skingrid">
            {related.map((r, i) => (
              <article key={r.id} className="card mr-skin" data-track="row_open" data-kind="skin" data-id={r.id} data-pos={i} onClick={() => openItem({ kind: 'skin', skin: r })}>
                <span className="mr-skin-art" aria-hidden="true">
                  <img src={r.renderUrl} alt="" loading="lazy" draggable={false} />
                </span>
                <span className="mr-skin-name">{skinName(r.title)}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
