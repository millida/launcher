import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { BuildIcon } from './BuildIcon'
import { buildIconOf, parseIcon } from '../../lib/buildIcon'
import { fmtN, LOADER_NAME } from '../../lib/format'
import type { Profile } from '../../ipc/commands'
import { usePlayStats } from '../../state/playStats'
import { setScreen } from '../../state/ui'
import { AnarchyArt, anarchyOnlineShown } from './AnarchyTile'
import { ONEBLOCK_ART } from './modeIcon'
import { hoursText } from './Hours'
import type { HubPack } from './data'
import '../../styles/pixel/hub-hero.css'

/*
 * Первый экран библиотеки (07.10.2026, «как Fortnite и Brawl Stars»): слева
 * большой баннер «В центре внимания» — наши серверы и премиум по очереди, живой
 * онлайн, одна кнопка; справа — «Продолжить» (своя последняя сборка, сразу в
 * игру) и «Играть с другом» (хостинг). Внизу баннера — превью остальных слайдов:
 * видно, что их несколько, и можно перейти сразу.
 */

export type HeroSlide = {
  key: string
  tag: string
  title: string
  line: string
  online?: number | null
  art: ReactNode
  cta: string
  gold?: boolean
  /** «Новое» на плитке — первые 14 дней сервера (ресёрч 07.10.2026: бейдж вместо ряда «Новое»). */
  isNew?: boolean
  onClick: () => void
}

export function heroSlides(o: {
  prison: HubPack | null
  pixelmon?: HubPack | null
  anarchyOnline: number | null
  oneblockOnline: number | null
  anarchyName: string
  anarchyLine: string
  onAnarchy: () => void
  onOneBlock: () => void
  onPack: (p: HubPack) => void
}): HeroSlide[] {
  const out: HeroSlide[] = []
  out.push({ key: 'anarchy', tag: 'Наш сервер', title: o.anarchyName, line: o.anarchyLine, online: o.anarchyOnline, art: <AnarchyArt className="hh-an" />, cta: 'Играть', onClick: o.onAnarchy })
  out.push({
    key: 'oneblock',
    tag: 'Наш сервер',
    title: 'OneBlock',
    line: 'Выживи на одном блоке',
    online: o.oneblockOnline,
    art: (
      <span className="hh-ob">
        <img src={ONEBLOCK_ART.bg} alt="" draggable={false} />
        <img className="hh-ob-logo" src={ONEBLOCK_ART.logo} alt="" draggable={false} />
      </span>
    ),
    cta: 'Играть',
    onClick: o.onOneBlock,
  })
  if (o.prison) {
    const p = o.prison
    out.push({ key: 'prison', tag: 'Наш сервер', title: p.title, line: p.tagline || 'Прокопайся до ранга SSS+', online: p.online, art: <img src={p.coverUrl || ''} alt="" draggable={false} />, cta: 'Играть', onClick: () => o.onPack(p) })
  }
  if (o.pixelmon) {
    const p = o.pixelmon
    // Pixelmon — новый сервер: «Новое» две недели с запуска (ресёрч 07.10.2026).
    out.push({ key: 'pixelmon', tag: 'Наш сервер', title: 'Pixelmon', line: p.tagline || 'Покемоны в Minecraft', online: p.online, art: <img src={p.coverUrl || ''} alt="" draggable={false} />, cta: 'Играть', isNew: Date.now() < Date.parse('2026-10-21T00:00:00+03:00'), onClick: () => o.onPack(p) })
  }
  return out
}

/**
 * Полка «Серверы Millida» (07.10.2026, второй заход: баннер-карусель занимал
 * пол-экрана и прятал два предложения из трёх). Все наши предложения видны
 * сразу, как слоты событий в Brawl Stars: картинка, метка, живой онлайн и
 * «Играть». Стоит первым рядом раздела «Режимы».
 */
export function HubSpotlight({ slides }: { slides: HeroSlide[] }) {
  return (
    <div className="hs-row" data-section="hub_spotlight">
      {slides.map((s, k) => (
        <button key={s.key} className={'hs-tile' + (s.gold ? ' gold' : '')} data-sound="open" data-track={'hub_spot_' + s.key} data-pos={k} onClick={s.onClick}>
          <span className="hs-art">{s.art}</span>
          {s.isNew ? <span className="hs-new">Новое</span> : null}
          <span className="hs-copy">
            <b className="hs-t">{s.title}</b>
            <span className="hs-m">
              {anarchyOnlineShown(s.online) ? (
                <>
                  <span className="ph-dot" aria-hidden="true" />
                  {fmtN(s.online) + ' играют'}
                </>
              ) : (
                s.line
              )}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** «Свой сервер» — хостинг, первой клеткой «Играть вдвоём». */
export function HostTile() {
  // Двойная, яркая, со своей кнопкой (08.10.2026: «должна прям выделяться, чтобы хотелось нажать»).
  return (
    <button className="hs-host2" data-sound="open" data-track="hub_spot_hosting" onClick={() => setScreen('hosting')}>
      <img className="hs-host2-img" src="/lobby/duo@2x.webp" alt="" draggable={false} />
      <span className="hs-host2-copy">
        <b>Свой сервер</b>
        <span>Играй с друзьями — запуск за минуту</span>
        <span className="btn md primary hs-host2-btn">
          <Icon id="i-plus" /> Создать
        </span>
      </span>
    </button>
  )
}

/** Первая карточка полки «Мои сборки»: последняя сборка, шире остальных, сразу «Играть». */
export function ContinueCard({ p, onPlay }: { p: Profile; onPlay: () => void }) {
  const seconds = usePlayStats((s) => s.stats.builds.find((b) => b.key === p.name)?.seconds || 0)
  return (
    <button className="ph-card hh-cont2" data-sound="open" data-track="hub_continue" data-private onClick={onPlay}>
      <span className="hh-cont2-ic" style={{ background: parseIcon(buildIconOf(p)).bg }}>
        <BuildIcon icon={p.icon} name={p.name} size={88} />
      </span>
      <span className="hh-cont2-body">
        <span className="hh-cont-cap">Продолжить</span>
        <b className="hh-cont-t">{p.name}</b>
        <span className="hh-cont-m">
          {LOADER_NAME(p) + ' · ' + p.version}
          {seconds >= 60 ? ' · ' + hoursText(seconds) : ''}
        </span>
        <span className="btn md primary hh-cont-play">
          <Icon id="i-play" /> Играть
        </span>
      </span>
    </button>
  )
}

/** Свой сервер в сетке «Режимов» — того же размера, что жанры: обложка, название, онлайн. */
export function OwnModeTile({ slide, index }: { slide: HeroSlide; index: number }) {
  return (
    <button className="ph-card ph-mt ph-mt-own" data-sound="open" data-kind="own_server" data-id={slide.key} data-pos={index} data-src="mode" onClick={slide.onClick}>
      <span className="hs-art">{slide.art}</span>
      {slide.isNew ? <span className="hs-new">Новое</span> : null}
      <span className="ph-mt-foot">
        <b>{slide.title}</b>
        <span className="ph-mt-on">
          {anarchyOnlineShown(slide.online) ? (
            <>
              <span className="ph-dot" aria-hidden="true" />
              {fmtN(slide.online) + ' играют'}
            </>
          ) : (
            slide.line
          )}
        </span>
      </span>
    </button>
  )
}
