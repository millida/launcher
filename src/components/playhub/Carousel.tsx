import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { openImage } from '../ImageLightbox'

/**
 * Кадры сборки: ручная карусель со стрелками по краям и точками-счётчиком —
 * самый удачный вид галереи в замерах Baymard; точки показывают, сколько
 * кадров и где ты (analysis/2026-09-23_premium-pack-page.md). Высота
 * фиксирована пропорцией 16:9 — кадры разной формы не двигают страницу.
 */
export function Carousel({ shots }: { shots: string[] }) {
  const [i, setI] = useState(0)
  const n = shots.length
  useEffect(() => setI(0), [shots.join('|')])
  if (!n) return null
  const go = (d: number) => setI((x) => (x + d + n) % n)
  return (
    <div
      className="ph-car"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1)
        if (e.key === 'ArrowRight') go(1)
      }}
    >
      <div className="ph-car-track" style={{ transform: 'translateX(' + -i * 100 + '%)' }}>
        {shots.map((s, k) => (
          <button key={s} className="ph-car-shot" tabIndex={-1} aria-hidden={k !== i} data-track="shot_open" onClick={() => openImage(s)}>
            <img src={s} alt="" loading={k < 2 ? 'eager' : 'lazy'} draggable={false} />
          </button>
        ))}
      </div>
      {n > 1 ? (
        <>
          <button className="ph-car-arr l" aria-label="Назад" data-track="shot_prev" onClick={() => go(-1)}>
            <Icon id="i-chev-l" />
          </button>
          <button className="ph-car-arr r" aria-label="Дальше" data-track="shot_next" onClick={() => go(1)}>
            <Icon id="i-chev-r" />
          </button>
          {n > 10 ? (
            // Точек больше десяти не различить — счётчик кадров.
            <span className="ph-car-dots ph-car-count">
              {i + 1} / {n}
            </span>
          ) : (
          <span className="ph-car-dots">
            {shots.map((s, k) => (
              <button
                key={s}
                className={'ph-car-dot' + (k === i ? ' on' : '')}
                aria-label={'Кадр ' + (k + 1)}
                data-track="shot_dot"
                onClick={() => setI(k)}
              ></button>
            ))}
          </span>
          )}
        </>
      ) : null}
    </div>
  )
}
