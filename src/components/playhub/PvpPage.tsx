import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { Toggle } from '../SetKit'
import { hasTauri } from '../../ipc/tauri'
import { pvpHudDefault, setPvpHudDefault } from '../../ipc/commands'
import { showToast } from '../../state/ui'
import { PVP_VERSIONS, fpsMods, loaderTitle } from '../../lib/versionBuild'
import type { FpsMod } from '../../lib/versionBuild'
import { modeIcon } from './modeIcon'
import { PvpArena } from './PvpArena'
import { t, tx, useT } from '../../i18n'

const FEATURES: { icon: string; title: string; line: string }[] = [
  { icon: 'i-grid', get title() { return t('HUD-модули') }, get line() { return t('FPS, CPS, пинг, броня, эффекты, комбо') } },
  { icon: 'i-edit', get title() { return t('Редактор на Right Shift') }, get line() { return t('Двигай и настраивай модули прямо в игре') } },
  { icon: 'i-arrow-r', get title() { return t('Переключение бега') }, get line() { return t('Бег без зажатой клавиши') } },
  { icon: 'i-search', get title() { return t('Приближение') }, get line() { return t('Зум на клавишу, глубже колесом') } },
  { icon: 'i-flame', get title() { return t('Нажатия клавиш') }, get line() { return t('WASD, кнопки мыши и CPS на экране') } },
  { icon: 'i-shield', get title() { return t('Анимации 1.7') }, get line() { return t('Блок мечом и старый взмах') } },
]

export function PvpPage({ busy, onPlay, arena = true }: { busy: boolean; onPlay: (version: string) => void; arena?: boolean }) {
  const t = useT()
  const [version, setVersion] = useState<string>(PVP_VERSIONS[0])
  const [mods, setMods] = useState<FpsMod[] | null | undefined>(undefined)
  const [hudOn, setHudOn] = useState(true)
  const [saving, setSaving] = useState(false)
  const art = modeIcon('PVP')

  useEffect(() => {
    let alive = true
    setMods(undefined)
    void fpsMods(version).then((l) => alive && setMods(l))
    return () => {
      alive = false
    }
  }, [version])

  useEffect(() => {
    if (!hasTauri()) return
    let alive = true
    pvpHudDefault()
      .then((on) => alive && setHudOn(on))
      .catch((e) => console.error('[pvp] hud default', e))
    return () => {
      alive = false
    }
  }, [])

  const flipHud = () => {
    const next = !hudOn
    if (!hasTauri()) {
      setHudOn(next)
      return
    }
    setSaving(true)
    setPvpHudDefault(next)
      .then(() => setHudOn(next))
      .catch((e) => showToast(t('Настройка не сохранилась: {error}. Попробуй ещё раз.', { error: tx(e) }), 'error'))
      .finally(() => setSaving(false))
  }

  const loader = loaderTitle(version)
  const ready = Array.isArray(mods) ? mods : []
  const boost = ready.length > 0

  return (
    <div className="ph-mode pp" data-section="pvp_page" data-kind="pvp" data-id={version}>
      {/* Сверху — арена Millida SMP; ниже — PvP-клиент для любых серверов.
          В разделе PvP арена — своя вкладка, здесь только сборка. */}
      {arena ? <PvpArena /> : null}
      <header className="ph-mode-hero">
        {art ? (
          <span className="ph-mode-bg" style={{ '--mode-c': art.color } as CSSProperties}>
            <span className={'ph-mode-art is-set' + (art.rig ? ' is-rig' : '')} style={{ backgroundImage: 'url(' + art.bg + ')' }}>
              {art.rig ? (
                <img src={art.rig.url} style={{ width: art.rig.w * (230 / art.rig.h), height: 230 }} alt="" draggable={false} />
              ) : (
                <img src={art.icon} style={{ width: 160, height: 160 }} alt="" draggable={false} />
              )}
            </span>
          </span>
        ) : null}
        <div className="ph-mode-title">
          <h1>{t('PvP-клиент для любых серверов')}</h1>
          <span className="ph-mode-meta">{loader + ' · ' + version + (boost ? ' · Boost FPS' : '')}</span>
        </div>
      </header>

      <div className="pp-facts">
        <div className="pp-fact">
          <b>{version}</b>
          <span>{t('версия')}</span>
        </div>
        <div className="pp-fact">
          <b>{loader}</b>
          <span>{t('загрузчик')}</span>
        </div>
        {boost ? (
          <div className="pp-fact">
            <b>{ready.length}</b>
            <span>{t('FPS-модов')}</span>
          </div>
        ) : null}
      </div>

      <div className="pp-cols">
        <div className="pp-main">
          <section className="pp-block">
            <h2>{t('Что внутри')}</h2>
            <div className="vp-mods">
              {FEATURES.map((f) => (
                <div className="vp-mod" key={f.title}>
                  <span className="vp-mod-ico">
                    <Icon id={f.icon} />
                  </span>
                  <span className="vp-mod-main">
                    <b>{f.title}</b>
                    <span>{f.line}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
          {mods === undefined ? (
            <section className="pp-block">
              <h2>Boost FPS</h2>
              <div className="vp-mods">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="skel vp-mod-skel"></span>
                ))}
              </div>
            </section>
          ) : boost ? (
            <section className="pp-block">
              <h2>Boost FPS</h2>
              <div className="vp-mods">
                {ready.map((m) => (
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
          <div className="segs" role="group" aria-label={t('Версия Minecraft')}>
            {PVP_VERSIONS.map((v) => (
              <button
                key={v}
                type="button"
                className={'seg' + (version === v ? ' on' : '')}
                aria-pressed={version === v}
                data-track="pvp_version"
                data-id={v}
                onClick={() => setVersion(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            className="btn lg primary pp-cta"
            data-sound="open"
            data-track="play"
            data-src="pvp_page"
            disabled={busy}
            onClick={() => onPlay(version)}
          >
            <Icon id="i-play" /> {busy ? t('Готовим…') : t('Играть')}
          </button>
          <label className="ph-fps vp-fps" data-track="pvp_hud_default">
            <Icon id="i-grid" />
            <span>{t('Модули PvP включены по умолчанию')}</span>
            <Toggle on={hudOn} busy={saving} onChange={flipHud} label={t('Модули PvP включены по умолчанию')} />
          </label>
          <span className="pp-legal">{t('Не продукт Mojang')}</span>
        </aside>
      </div>
    </div>
  )
}
