import { useEffect, useRef, type CSSProperties } from 'react'
import { ART, HEAD } from './content'
import './arcania.css'

/*
 * Arcania 2.0 — единственная особенная сборка в лаунчере (владелец 22.10.2026): у неё
 * своя рамка и свои эффекты ВЕЗДЕ, где она показана, — в «Для тебя», в каталоге
 * плиткой и строкой. Всё, что делает её особенной, — здесь, в одном месте:
 * поменял тут — поменялось везде.
 */

export const isArcania = (slugOrTitle: string | null | undefined): boolean => /arcania/i.test(slugOrTitle || '')

/** Название с золотой плашкой «2.0», по которой пробегает блик. */
export function ArcaniaName() {
  return (
    <>
      Arcania <span className="arc2-ver">{HEAD.version}</span>
    </>
  )
}

/** Кадр-заставка живой обложки: его же видно, пока видео не заиграло, и в квадратных значках. */
export const ARCANIA_POSTER = ART + 'cover-poster.webp'
const COVER_VIDEO = ART + 'cover.mp4'

// Обложка грузится первой из всех картинок: кадр-заставка заявлен в index.html с высшим
// приоритетом, а видео начинаем тянуть сразу при загрузке модуля — к первой карточке
// оно уже в кэше. Файлы лежат в самом лаунчере, сеть им не нужна.
// Ссылка держится в модуле: иначе сборщик мусора уберёт элемент и загрузка оборвётся.
export const warmCover: HTMLVideoElement | null = typeof document !== 'undefined' ? document.createElement('video') : null
if (warmCover) {
  warmCover.preload = 'auto'
  warmCover.muted = true
  warmCover.src = COVER_VIDEO
  warmCover.load()
}

/**
 * Живая обложка Арканьи — короткий зацикленный ролик с героями (владелец 23.10.2026).
 * Чуть «выпирает»: стоит крупнее рамки и наклоняется за курсором, как объёмная.
 */
export function ArcaniaCover({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)

  // Наклон за курсором — на всей карточке, а не только над роликом.
  useEffect(() => {
    const card = ref.current?.closest<HTMLElement>('.arc2-skin')
    if (!card) return
    const move = (e: PointerEvent) => {
      const r = card.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      card.style.setProperty('--arc2-ry', (x * 8).toFixed(2) + 'deg')
      card.style.setProperty('--arc2-rx', (-y * 6).toFixed(2) + 'deg')
    }
    const leave = () => {
      card.style.setProperty('--arc2-ry', '0deg')
      card.style.setProperty('--arc2-rx', '0deg')
    }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerleave', leave)
    return () => {
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerleave', leave)
    }
  }, [])

  return (
    <video
      ref={ref}
      className={'arc2-video ' + className}
      src={COVER_VIDEO}
      poster={ARCANIA_POSTER}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
    />
  )
}

/** Маленький тихий ярлык на обложке вместо «Эксклюзив»/«Премиум». */
export const ArcaniaTag = () => <span className="arc2-tag">Новое</span>

// Пиксельные искры: [x, размер px, длительность s, задержка s, цвет].
const SPARKS = [
  ['8%', 3, 3.2, 0, '#b6f09c'],
  ['21%', 4, 3.8, 1.1, '#ffe08a'],
  ['35%', 3, 2.9, 2.0, '#7bd35a'],
  ['50%', 4, 3.5, 0.5, '#b6f09c'],
  ['64%', 3, 3.1, 1.6, '#ffe08a'],
  ['79%', 4, 3.9, 2.6, '#7bd35a'],
  ['92%', 3, 3.3, 0.9, '#b6f09c'],
] as const

/**
 * Слой эффектов поверх любой карточки Арканьи (у корня карточки — класс arc2-skin):
 * зелёное пиксельное кольцо с двумя бегущими навстречу искрами, свечение изнутри
 * кромки, блик по обложке и искры, поднимающиеся с нижнего края.
 */
export function ArcaniaFx() {
  return (
    <span className="arc2-fx" aria-hidden="true">
      <span className="arc2-glow" />
      <span className="arc2-shine" />
      <span className="arc2-sparks">
        {SPARKS.map(([x, s, t, d, c]) => (
          <i key={x} style={{ '--x': x, '--s': s + 'px', '--t': t + 's', '--d': d + 's', '--c': c } as CSSProperties} />
        ))}
      </span>
      <span className="arc2-frame" />
    </span>
  )
}

/** Карточка Арканьи в «Для тебя». */
export function ArcaniaCard({ meta, pos, onClick }: { meta: string; pos: number; onClick: () => void }) {
  return (
    <button className="ph-card fy-card arc2-skin" data-sound="open" data-kind="premium" data-id="arcania" data-pos={pos} data-src="foryou" onClick={onClick}>
      <span className="ph-card-art arc2-art">
        <ArcaniaCover />
        <ArcaniaTag />
      </span>
      <span className="ph-card-body">
        <b>
          <ArcaniaName />
        </b>
        <span className="ph-card-meta">{meta}</span>
      </span>
      <ArcaniaFx />
    </button>
  )
}
