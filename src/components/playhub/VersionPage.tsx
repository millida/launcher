import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { Toggle } from '../SetKit'
import { fpsMods, loaderTitle, setVersionFps, versionBuildName, versionFps } from '../../lib/versionBuild'
import type { FpsMod } from '../../lib/versionBuild'
import { VERSION_ART } from './data'
import { Hours } from './Hours'

/**
 * Страница версии Minecraft — полная, как страница сборки (приказ владельца
 * 23.09.2026, 19:04): key art обновления, «Minecraft X», загрузчик и Boost FPS,
 * переключатель FPS-мода, из чего Boost FPS состоит под эту версию (живой
 * запрос к Modrinth — ровно то, что поставит ядро), часы в этой версии и
 * «Играть». Переключатель помнится на версию (lib/versionBuild.ts).
 */
export function VersionPage({
  version,
  art,
  busy,
  onBack,
  onPlay,
}: {
  version: string
  art: string
  busy: boolean
  onBack: () => void
  onPlay: (fps: boolean) => void
}) {
  const [fps, setFps] = useState(() => versionFps(version))
  const [mods, setMods] = useState<FpsMod[] | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setMods(undefined)
    setFps(versionFps(version))
    void fpsMods(version).then((l) => alive && setMods(l))
    return () => {
      alive = false
    }
  }, [version])
  // Под версию нет ни одного FPS-мода — тумблера нет, «Boost FPS» не обещаем.
  const none = Array.isArray(mods) && mods.length === 0
  const boost = fps && !none
  const loader = loaderTitle(version)
  const update = VERSION_ART[version]?.update || null
  const flip = () => {
    setFps(!fps)
    setVersionFps(version, !fps)
  }

  return (
    <div className="pp vp" data-section="version_page" data-kind="version" data-id={version}>
      <header className="pp-head">
        <img className="pp-cover" src={art} alt="" draggable={false} />
        <button className="btn sm secondary ph-back pp-back" data-track="back" onClick={onBack}>
          <Icon id="i-chev-l" /> Каталог
        </button>
        <div className="pp-title">
          {update ? <span className="ph-card-tag">{update}</span> : null}
          <h1>Minecraft {version}</h1>
          <span className="pp-line">{loader + (boost ? ' · Boost FPS' : '')}</span>
        </div>
      </header>

      <div className="pp-facts">
        <div className="pp-fact">
          <b>{version}</b>
          <span>версия</span>
        </div>
        <div className="pp-fact">
          <b>{loader}</b>
          <span>загрузчик</span>
        </div>
        {mods && mods.length ? (
          <div className="pp-fact">
            <b>{mods.length}</b>
            <span>FPS-модов</span>
          </div>
        ) : null}
      </div>

      <div className="pp-cols">
        <div className="pp-main">
          {mods === undefined ? (
            <section className="pp-block">
              <h2>Boost FPS</h2>
              <div className="vp-mods">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="skel vp-mod-skel"></span>
                ))}
              </div>
            </section>
          ) : mods && mods.length ? (
            <section className={'pp-block' + (boost ? '' : ' vp-off')}>
              <h2>Boost FPS</h2>
              <div className="vp-mods">
                {mods.map((m) => (
                  <div className="vp-mod" key={m.slug}>
                    <span className="vp-mod-ico">
                      {m.icon ? <img src={m.icon} alt="" loading="lazy" draggable={false} /> : <Icon id="i-zap" />}
                    </span>
                    <span className="vp-mod-main">
                      <b>{m.title}</b>
                      {m.summary ? <span>{m.summary}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="pp-buy">
          <button className="btn lg primary pp-cta" data-sound="open" data-track="play" data-src="pack_page" disabled={busy} onClick={() => onPlay(boost)}>
            <Icon id="i-play" /> {busy ? 'Готовим…' : 'Играть'}
          </button>
          {!none ? (
            <label className="ph-fps vp-fps" data-track="fps_toggle">
              <Icon id="i-zap" />
              <span>FPS-мод</span>
              <Toggle on={fps} onChange={flip} label="FPS-мод" />
            </label>
          ) : null}
          <Hours build={versionBuildName(version)} />
          <span className="pp-legal">Не продукт Mojang</span>
        </aside>
      </div>
    </div>
  )
}
