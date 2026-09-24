import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { openImage } from '../ImageLightbox'
import { openExt } from '../../lib/api'
import { PremiumHero } from './PremiumHero'
import { BuyBlock, CancelLine } from './PremiumBuy'
import {
  loadPremiumPack,
  planPrice,
  untilText,
  type PremiumPack,
  type PremiumPackDetail,
  type PremiumPlan,
  type PremiumSubscription,
  viaCatalog,
} from '../../lib/premium'

interface Props {
  pack: PremiumPack
  plan?: PremiumPlan | null
  sub?: PremiumSubscription | null
  /// Пусто — возвращаться некуда: сборка одна и витрина ею и является.
  onBack?: () => void
}

interface Tile {
  label: string
  value: string
}

function tilesOf(p: PremiumPackDetail): Tile[] {
  const out: Tile[] = []
  if (typeof p.modsCount === 'number' && p.modsCount > 0)
    out.push({ label: 'Модов', value: p.modsCount.toLocaleString('ru-RU') })
  if (p.mcVersion) out.push({ label: 'Версия', value: p.mcVersion })
  if (p.loader) out.push({ label: 'Загрузчик', value: p.loader })
  if (typeof p.online === 'number') out.push({ label: 'Сейчас играют', value: p.online.toLocaleString('ru-RU') })
  if (typeof p.downloads === 'number' && p.downloads > 0)
    out.push({ label: 'Скачиваний', value: p.downloads.toLocaleString('ru-RU') })
  if (p.author) out.push({ label: 'Собрал', value: p.author })
  if (p.updatedAt && untilText(p.updatedAt)) out.push({ label: 'Обновлено', value: untilText(p.updatedAt) })
  return out
}

/// Страница сборки: арт, кадры, числа, состав подписки и блок цены — второй раз
/// внизу, чтобы не возвращаться наверх (ui-refs.md §3.4).
export function PremiumPage({ pack, plan, sub, onBack }: Props) {
  const [detail, setDetail] = useState<PremiumPackDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // У сборки каталога своей страницы на сервере нет: всё, что о ней известно,
    // пришло вместе с витриной.
    if (viaCatalog(pack)) return
    let alive = true
    setFailed(false)
    loadPremiumPack(pack.id)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [pack.id, tick])

  const full: PremiumPackDetail = detail ? { ...pack, ...detail } : pack
  const tiles = tilesOf(full)
  // Сервер сборки — единственное, что каталог говорит о составе.
  const includes = full.includes && full.includes.length ? full.includes : full.hasServer ? ['Сервер сборки'] : []
  const plans = full.plans && full.plans.length ? full.plans : plan ? [plan] : []
  const shots = full.screenshots || []
  // Повтор блока цены нужен там, где до него пришлось прокручивать. На короткой
  // странице он был бы второй такой же кнопкой в полуметре от первой.
  const long = shots.length > 0 || (full.patches || []).length > 0

  return (
    <div className="pm-page">
      {onBack ? (
        <div className="pm-back">
          <button className="btn sm ghost" onClick={onBack}>
            <Icon id="i-chev-l" /> Назад
          </button>
        </div>
      ) : null}

      <PremiumHero pack={full} plan={plans[0] || plan} sub={sub} />

      {full.videoUrl || shots.length ? (
        <div className="pm-media">
          {full.videoUrl ? (
            <button className="pm-shot pm-video" onClick={() => openExt(full.videoUrl as string)}>
              <Icon id="i-play" />
            </button>
          ) : null}
          {shots.map((s) => (
            <button key={s} className="pm-shot" onClick={() => openImage(s)}>
              <img src={s} alt="" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}

      {tiles.length ? (
        <div className="pm-tiles">
          {tiles.map((t) => (
            <div className="pm-tile" key={t.label}>
              <span>{t.label}</span>
              <b>{t.value}</b>
            </div>
          ))}
        </div>
      ) : null}

      {includes.length ? (
        <div className="pm-block">
          <h3>Что входит</h3>
          <ul className="pm-list">
            {includes.map((i) => (
              <li key={i}>
                <Icon id="i-check" />
                {i}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plans.length ? (
        <div className="pm-block">
          <h3>Подписка</h3>
          <div className="pm-plans">
            {plans.map((p) => (
              <div className="pm-plan-card" key={p.id}>
                <div className="pm-row">
                  <b>{p.title}</b>
                  <span className="pm-plan-price">{planPrice(p)}</span>
                </div>
                {p.items && p.items.length ? (
                  <ul className="pm-list">
                    {p.items.map((i) => (
                      <li key={i}>
                        <Icon id="i-check" />
                        {i}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {full.patches && full.patches.length ? (
        <div className="pm-block">
          <h3>Обновления</h3>
          <ul className="pm-patches">
            {full.patches.map((p, i) => (
              <li key={i}>
                {p.date && untilText(p.date) ? <span>{untilText(p.date)}</span> : null}
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {long || includes.length || plans.length ? (
        <BuyBlock pack={full} plan={plans[0] || plan} sub={sub} />
      ) : null}
      <CancelLine sub={sub} />

      {failed && !detail ? (
        <div className="pm-note">
          <Icon id="i-alert" />
          <span>Страница не догрузилась</span>
          <button className="btn sm ghost" onClick={() => setTick(tick + 1)}>
            <Icon id="i-restart" /> Повторить
          </button>
        </div>
      ) : null}

      <p className="pm-legal">
        Доступ к сборке: моды скачиваются при установке. Не продукт Mojang.
        {full.ageRating ? ' ' + full.ageRating : ''}
      </p>
    </div>
  )
}
