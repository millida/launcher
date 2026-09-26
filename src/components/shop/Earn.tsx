import { useState, type CSSProperties } from 'react'
import { Icon } from '../Icon'
import { Rays } from '../reward/RewardReveal'
import { Ruby } from '../Ruby'
import { RARITY_NAMES, type EconomyProgress, type FragmentCard, type ItemRef, type WeeklyParcel, type Workshop } from '../../lib/rubies'
import { gridCols, Head, ItemArt, Shard, Timer, toneStyle } from './parts'
import { FragBar, RarityFx, RarityPlate } from './rarityUi'
import type { WeeklyPath } from './weekly'

const num = (n: number) => n.toLocaleString('ru-RU')
/** Часы с одной цифрой после запятой: «1,6». */
const hrs = (n: number) => (Math.floor(n * 10) / 10).toLocaleString('ru-RU')

/** Прокрутить ленту к блоку по id. */
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** Откуда берутся осколки — значком и словом, клик ведёт к источнику. */
const SOURCES: { icon: string; label: string; to: string }[] = [
  { icon: 'i-clock', label: 'За игру', to: 'shop-weekly' },
  { icon: 'i-star', label: 'Задания недели', to: 'shop-weekly' },
  { icon: 'i-gift', label: 'Бонус дня', to: 'shop-today' },
]

/**
 * Обмен осколков (бывшая «Мастерская»; правка владельца 24.09.2026: «непонятно,
 * как работает, откуда осколки, в чём суть»). Суть — без абзацев, картинкой:
 * осколок → стрелка → вещь, полоса до ближайшей вещи и строка источников
 * значками. Ниже — ровная сетка вещей. 12 вещей за осколки (модель
 * предметов v2: до редкой, эпических и выше нет), ротация 1-го числа;
 * потолок копилки 1 500, дневной лимит из сундуков и подарка — 100.
 * Под сеткой — начатые вещи: фрагменты из сундуков, «7/20».
 */
export function WorkshopBlock({
  data,
  busy,
  onCraft,
  onTopUp,
  weekly = true,
}: {
  data: Workshop
  busy: string
  onCraft: (w: { item: ItemRef; cost: number }) => void
  /** «Докупить фрагменты» у начатой вещи. */
  onTopUp: (f: FragmentCard & { topUp: number }) => void
  /** Блок «Задания недели» на экране: без него кнопки-источники к нему не ведут. */
  weekly?: boolean
}) {
  const full = data.shards >= data.cap
  const open = data.workshop.items.filter((w) => !w.owned)
  // Цель — самая дешёвая вещь, на которую ещё не хватает; хватает на всё — самая дорогая.
  const goal =
    [...open].filter((w) => w.cost > data.shards).sort((a, b) => a.cost - b.cost)[0] ??
    [...open].sort((a, b) => b.cost - a.cost)[0] ??
    null
  const items = data.workshop.items
  return (
    <div className="card sh-block sh-work" id="shop-work" data-section="workshop">
      <Head title="Обмен осколков">
        <Timer to={data.workshop.rotatesAt} label="Новые через" />
      </Head>
      <div className="sh-work-how">
        <span className="sh-work-eq" aria-label="Осколки меняются на фрагменты вещей">
          <span className="sh-work-coin">
            <Shard size={42} />
          </span>
          <Icon id="i-arrow-r" />
          {goal ? <ItemArt item={goal.item} size="sm" /> : <Icon id="i-shirt" />}
        </span>
        <span className="sh-work-bal">
          <span className="sh-work-num" data-tip={full ? 'Потолок ' + num(data.cap) + ': трать, чтобы копить дальше' : undefined}>
            <Shard size={20} />
            <b>{num(data.shards)}</b>
            {goal && goal.cost > data.shards ? <span>/ {num(goal.cost)}</span> : null}
            {full ? <span className="sh-meter-cap full">потолок</span> : null}
          </span>
          <span className="sh-meter-bar">
            <i style={{ width: Math.min(100, goal ? (data.shards / goal.cost) * 100 : 100) + '%' }} />
          </span>
          {goal ? <span className="sh-work-goal">{goal.item.name}</span> : null}
          {data.today ? (
            <span
              className={'sh-work-today' + (data.today.earned >= data.today.limit ? ' full' : '')}
              data-tip="Из сундуков, подарка и фрагментов — не больше в сутки"
            >
              Сегодня <b>{num(Math.min(data.today.earned, data.today.limit))}</b>/{num(data.today.limit)}
            </span>
          ) : null}
        </span>
        <span className="sh-work-src">
          {SOURCES.filter((s) => weekly || s.to !== 'shop-weekly').map((s) => (
            <button key={s.label} className="sh-src" data-track={'workshop_src_' + s.to} onClick={() => scrollTo(s.to)}>
              <Icon id={s.icon} />
              {s.label}
            </button>
          ))}
        </span>
      </div>
      <div className="sh-grid is-fit" style={gridCols(items.length)}>
        {items.map((w) => {
          const short = w.cost - data.shards
          return (
            <div key={w.item.code} className={'sh-card' + (w.owned ? ' is-owned' : '')} style={toneStyle(w.item)} data-rar={w.item.rarity}>
              <RarityFx />
              <ItemArt item={w.item} />
              <b className="sh-card-name">{w.item.name}</b>
              <span className="sh-card-meta">
                <RarityPlate rarity={w.item.rarity} small />
              </span>
              <span className="sh-card-foot">
                <span className="sh-pr">
                  <Shard size={15} />
                  <b>{num(w.cost)}</b>
                </span>
                {w.owned ? (
                  <span className="sh-owned sm">
                    <Icon id="i-check" />
                    Есть
                  </span>
                ) : (
                  <button
                    className={'btn sm ' + (short > 0 ? 'secondary' : 'primary')}
                    disabled={short > 0 || busy === w.item.code}
                    data-track="craft"
                    data-kind="item"
                    data-id={w.item.code}
                    onClick={() => onCraft(w)}
                  >
                    {short > 0 ? 'Ещё ' + num(short) : 'Обменять'}
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      {data.fragments && data.fragments.length ? <Collecting list={data.fragments} busy={busy} onTopUp={onTopUp} /> : null}
    </div>
  )
}

/**
 * Начатые вещи: фрагменты из сундуков, посылки, обмена и наград копятся в
 * вещь («7/20»), но бесплатно не собирают её — последний шаг «Докупить».
 */
function Collecting({
  list,
  busy,
  onTopUp,
}: {
  list: FragmentCard[]
  busy: string
  onTopUp: (f: FragmentCard & { topUp: number }) => void
}) {
  return (
    <div className="sh-collect" data-section="fragments">
      <h3 className="sh-collect-h">Собираются</h3>
      <div className="sh-grid is-fit" style={gridCols(list.length)}>
        {list.map((f) => (
          <div key={f.item.code} className="sh-card is-show" style={toneStyle(f.item)} data-rar={f.item.rarity}>
            <RarityFx />
            <ItemArt item={f.item} />
            <b className="sh-card-name">{f.item.name}</b>
            <span className="sh-card-meta">
              <FragBar have={f.have} need={f.need} rarity={f.item.rarity} />
            </span>
            {f.topUp ? (
              <span className="sh-card-foot">
                <button
                  className="btn sm primary"
                  disabled={busy === f.item.code}
                  data-track="fragments_topup"
                  data-kind="item"
                  data-id={f.item.code}
                  onClick={() => onTopUp({ ...f, topUp: f.topUp as number })}
                >
                  Докупить
                  <span className="sh-pr">
                    <Ruby size={15} />
                    <b>{num(f.topUp)}</b>
                  </span>
                </button>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Посылка недели (как в CS2): три часа игры за неделю открывают фрагменты одной
 * вещи на выбор из трёх (не выше редкой) — половину нужного, остаток докупается.
 * Часы — только подтверждённые сервером. Забрал — «Забрана» и таймер до новой.
 */
export function ParcelBlock({ data, busy, onClaim }: { data: WeeklyParcel; busy: string; onClaim: (item: ItemRef) => void }) {
  const [pick, setPick] = useState('')
  const claimed = !!data.claimedAt
  const choices = data.ready && !claimed && data.choices?.length ? data.choices : null
  const have = Math.min(data.hours, data.need)
  const pct = Math.min(100, (have / data.need) * 100)
  const left = Math.max(0, data.need - data.hours)
  const chosen = choices?.find((c) => c.code === pick) ?? null
  return (
    <div className={'card sh-block sh-weekly' + (choices ? ' is-ready' : '') + (claimed ? ' is-claimed' : '')} id="shop-weekly" data-section="weekly">
      <Head title="Посылка недели">
        <Timer to={data.resetsAt} label={claimed ? 'Новая через' : 'Сгорит через'} />
      </Head>
      <div className="sh-meter sh-parcel-meter">
        <Icon id="i-clock" />
        <b>
          {hrs(have)}/{data.need} ч
        </b>
        <span className="sh-meter-bar">
          <i style={{ width: pct + '%' }} />
        </span>
        {claimed ? (
          <span className="sh-owned">
            <Icon id="i-check" />
            Забрана
          </span>
        ) : choices ? null : (
          <span className="sh-meter-cap">Ещё {hrs(left)} ч в игре</span>
        )}
      </div>
      {choices ? (
        <>
          <div className="sh-pick3" role="radiogroup" aria-label="Фрагменты какой вещи забрать">
            {choices.map((it) => (
              <button
                key={it.code}
                className={'sh-pick' + (pick === it.code ? ' on' : '')}
                style={toneStyle(it)}
                role="radio"
                aria-checked={pick === it.code}
                data-track="weekly_pick"
                data-kind="item"
                data-id={it.code}
                onClick={() => setPick(it.code)}
              >
                <ItemArt item={it} size="lg" />
                <b className="sh-card-name">{it.name}</b>
                <span className="sh-card-meta">
                  <RarityPlate rarity={it.rarity} small />
                </span>
                <span className="sh-pick-mark">
                  <Icon id="i-check" />
                </span>
              </button>
            ))}
          </div>
          <div className="sh-pick-foot">
            <button
              className="btn md primary"
              disabled={!chosen || busy === 'weekly'}
              data-track="weekly_claim"
              onClick={() => chosen && onClaim(chosen)}
            >
              {chosen ? 'Забрать фрагменты' : 'Выбери одну'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * Задания недели (недельный путь). Правки владельца 24.09.2026:
 * «вещь недели выглядит скромно — не хочется собрать» и «задания — непонятно,
 * за что даём». Теперь: вещь недели — герой-карточка во всю ширину (лучи,
 * покачивание, свечение редкости, звёзды «7/10 ★»); строка-суть
 * «Задания → ★ → награды»; над каждой отметкой дорожки — что она даёт
 * (осколки, последняя — вещь недели); у задания — сколько звёзд за него.
 * Ступени 3 и 6 — осколки. С 7 звёзд недостающее можно докупить рубинами.
 */
export function WeeklyPathBlock({
  data,
  busy,
  onClaim,
  onBoost,
}: {
  data: WeeklyPath
  busy: string
  onClaim: (at: number) => void
  onBoost: (stars: number) => void
}) {
  const prizeStep = data.steps.find((s) => s.reward.kind === 'ITEM')
  const done = data.stars >= data.need
  const owned = !!prizeStep?.claimed
  const stepAt = new Map(data.steps.map((s) => [s.at, s]))
  const pct = Math.min(100, (data.stars / data.need) * 100)
  return (
    <div className={'card sh-block sh-wp' + (done && !owned ? ' is-ready' : '')} id="shop-weekly">
      <Head title="Задания недели">
        <Timer to={data.resetsAt} label="Новые через" />
      </Head>

      <div
        className={'sh-wp-hero' + (done && !owned ? ' is-ready' : '') + (owned ? ' is-owned' : '')}
        style={{ ...toneStyle(data.prize), ['--rw-tone' as string]: 'var(--sh-tone)' } as CSSProperties}
        data-rar={data.prize.rarity}
      >
        <span className="sh-wp-stage">
          {!owned ? <Rays className="sh-wp-rays" /> : null}
          <span className="sh-wp-float">
            <ItemArt item={data.prize} size="lg" />
          </span>
        </span>
        <span className="sh-wp-info">
          <span className="sh-kicker">Вещь недели</span>
          <b className="sh-feat-name">{data.prize.name}</b>
          <span className="sh-card-meta">
            <i>{RARITY_NAMES[data.prize.rarity]}</i>
            <span>
              в магазине <s>{num(data.prizePrice)}</s>
            </span>
          </span>
          <span className="sh-wp-goal">
            <span className="sh-wp-bar">
              <i style={{ width: pct + '%' }} />
            </span>
            <b className="sh-wp-count">
              {data.stars}/{data.need}
              <Icon id="i-star" />
              <span>— твоя</span>
            </b>
          </span>
          {owned ? (
            <span className="sh-owned md">
              <Icon id="i-check" />
              Твоя
            </span>
          ) : done ? (
            <button className="btn md primary" disabled={busy === 'weekly'} data-track="weekly_claim" onClick={() => prizeStep && onClaim(prizeStep.at)}>
              Забрать
            </button>
          ) : data.boost?.available ? (
            <button className="btn md secondary sh-wp-boost" disabled={busy === 'weekly-boost'} data-track="weekly_boost" onClick={() => onBoost(data.boost!.missing)}>
              Докупить {data.boost.missing}
              <Icon id="i-star" />
              <span className="sh-pr">
                <Ruby size={15} />
                <b>{num(data.boost.price)}</b>
              </span>
            </button>
          ) : null}
        </span>
      </div>

      <div className="sh-wp-sum" aria-label="Задания дают звёзды, звёзды открывают награды">
        <span>
          <Icon id="i-check" />
          Задания
        </span>
        <Icon id="i-arrow-r" />
        <span className="star">
          <Icon id="i-star" />
        </span>
        <Icon id="i-arrow-r" />
        <span>
          <Shard size={16} />
          <ItemArt item={data.prize} size="sm" />
          Награды
        </span>
      </div>

      <div className="sh-wp-track" role="img" aria-label={'Звёзд: ' + data.stars + ' из ' + data.need}>
        {Array.from({ length: data.need }, (_, i) => {
          const n = i + 1
          const step = stepAt.get(n)
          const got = n <= data.stars
          const rw = step?.reward
          return (
            <span key={n} className={'sh-wp-cell' + (got ? ' got' : '') + (step ? ' step' : '')}>
              <span className="sh-wp-over">
                {!rw ? null : rw.kind === 'ITEM' ? (
                  <span className={'sh-wp-prizemini' + (step!.claimed ? ' done' : '')} style={toneStyle(rw.item)}>
                    <ItemArt item={rw.item} size="sm" />
                  </span>
                ) : step!.claimed ? (
                  <span className="sh-wp-gift done" data-tip="Забрано">
                    <Shard size={16} />+{rw.amount}
                    <Icon id="i-check" />
                  </span>
                ) : got ? (
                  <button className="sh-wp-gift ready" disabled={busy === 'weekly'} data-track="weekly_claim_step" onClick={() => onClaim(step!.at)}>
                    <Shard size={16} />+{rw.amount}
                  </button>
                ) : (
                  <span className="sh-wp-gift">
                    <Shard size={16} />+{rw.amount}
                  </span>
                )}
              </span>
              <Icon id="i-star" />
              <small>{n}</small>
            </span>
          )
        })}
      </div>

      <div className="sh-wp-tasks">
        {data.tasks.map((t) => {
          const full = t.earned >= t.stars
          return (
            <div key={t.code} className={'sh-ach-row' + (full ? ' done' : '')}>
              <span className="sh-ach-mark">
                <Icon id={full ? 'i-check' : 'i-star'} />
              </span>
              <span className="sh-ach-body">
                <b>{t.title}</b>
                {!full ? (
                  <span className="sh-ach-bar">
                    <i style={{ width: Math.min(100, (t.progress / t.target) * 100) + '%' }} />
                  </span>
                ) : null}
              </span>
              <span className="sh-ach-n">{full ? '' : hrs(t.progress) + '/' + t.target + (t.unit ? ' ' + t.unit : '')}</span>
              <span className={'sh-wp-stars' + (full ? ' done' : '')} data-tip={t.earned > 0 && !full ? 'Уже ' + t.earned : undefined}>
                +{t.stars}
                <Icon id="i-star" />
              </span>
            </div>
          )
        })}
      </div>
      <div className="sh-wp-foot">
        <span className={'sh-tag' + (data.plus ? ' on' : '')}>
          <Icon id="i-crown" />
          {data.plus ? 'PLUS: часы ×' + data.plusHoursBoost : 'С PLUS часы ×' + data.plusHoursBoost}
        </span>
      </div>
    </div>
  )
}

/** Позиция на шкале часов: логарифм, иначе 10 и 25 ч слиплись бы у левого края. */
const at = (h: number, max: number) => (Math.log10(Math.max(1, h)) / Math.log10(max)) * 100

/**
 * «Плащи за часы» (8 плащей, как Starr Road): порог часов даёт половину
 * фрагментов плаща, остаток докупается в «Собираются» (26.09.2026).
 */
export function PathBlock({ data }: { data: EconomyProgress }) {
  const steps = data.hourItems
  const max = steps[steps.length - 1]?.hours ?? 2000
  const min = steps[0]?.hours ?? 10
  // Шкала от первой ступени: всё, что меньше, — у левого края.
  const pos = (h: number) => Math.max(0, ((at(h, max) - at(min, max)) / (100 - at(min, max))) * 100)
  const nextHours = steps.find((s) => !s.owned)

  return (
    <>
      <div className="card sh-block sh-path" id="shop-hours" data-section="hours_path">
        <Head title="Плащи за часы">
          <span className="sh-tag">
            <Icon id="i-clock" />
            Половина — за часы
          </span>
        </Head>
        <div className="sh-meter">
          <Icon id="i-clock" />
          <b>{num(Math.floor(data.hours))} ч в игре</b>
          {nextHours ? <span className="sh-meter-cap">До следующего {num(Math.ceil(nextHours.hours - data.hours))} ч</span> : null}
        </div>
        <div className="sh-road">
          <span className="sh-road-line">
            <i style={{ width: pos(data.hours) + '%' }} />
          </span>
          {steps.map((s) => (
            <span
              key={s.hours}
              className={'sh-road-step' + (s.owned ? ' got' : '') + (s === nextHours ? ' next' : '')}
              style={{ left: pos(s.hours) + '%', ...toneStyle(s.item) } as CSSProperties}
              data-tip={s.fragments ? s.item.name + ' · ' + s.fragments.have + '/' + s.fragments.need : s.item.name}
            >
              <ItemArt item={s.item} size="sm" />
              <b>{num(s.hours)} ч</b>
              {s.owned ? (
                <span className="sh-road-mark">
                  <Icon id="i-check" />
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </div>

    </>
  )
}
