import { useEffect, useState } from 'react'
import { Block, Group, Segs } from '../SetKit'
import { Head } from '../Head'
import { PxIcon } from '../PxIcon'
import { hasMillidaAccount } from '../../lib/api'
import type { GiftPerson, ReceivedGift, SentGift } from '../../lib/gifts'
import type { ItemRef } from '../../lib/rubies'
import { setScreen } from '../../state/ui'
import { showGift, useGifts } from '../../state/gifts'
import { intlTag, useT } from '../../i18n'
import './gifts-block.css'

type Side = 'received' | 'sent'

const KEYS = 'подарки история подарков подарил получил отправил открыть подарок от друга'

const dayOf = (iso: string) => new Date(iso).toLocaleDateString(intlTag(), { day: 'numeric', month: 'long' })

function Thumb({ item, closed }: { item: ItemRef | null; closed: boolean }) {
  const [broken, setBroken] = useState(false)
  if (closed || !item?.preview || broken)
    return (
      <span className={'gh-thumb' + (closed ? ' closed' : '')}>
        <PxIcon name="gift" size={28} />
      </span>
    )
  return (
    <span className="gh-thumb">
      <img src={item.preview} alt="" draggable={false} onError={() => setBroken(true)} />
    </span>
  )
}

function Who({ person }: { person: GiftPerson | null }) {
  const t = useT()
  return (
    <span className="gh-who">
      <Head nick={person?.nickname} size={16} />
      {person?.nickname || t('Игрок')}
    </span>
  )
}

function ReceivedRow({ gift }: { gift: ReceivedGift }) {
  const t = useT()
  const closed = !gift.opened
  return (
    <div className={'s2-row gh-row' + (closed ? ' closed' : '')}>
      <Thumb item={gift.item} closed={closed} />
      <span className="s2-lab">
        <b>{closed ? t('Подарок ждёт') : gift.item?.name || t('Подарок')}</b>
        <small>
          <span className="gh-meta">
            {t('от')} <Who person={gift.from} /> · {dayOf(gift.at)}
          </span>
          {gift.message && !closed ? <span className="gh-note">«{gift.message}»</span> : null}
        </small>
      </span>
      {closed ? (
        <span className="s2-ctl">
          <button className="btn sm primary" data-track="gift_history_open" onClick={() => showGift(gift.id)}>
            {t('Открыть')}
          </button>
        </span>
      ) : null}
    </div>
  )
}

function SentRow({ gift }: { gift: SentGift }) {
  const t = useT()
  return (
    <div className="s2-row gh-row">
      <Thumb item={gift.item} closed={false} />
      <span className="s2-lab">
        <b>{gift.item?.name || t('Подарок')}</b>
        <small>
          <span className="gh-meta">
            {t('для')} <Who person={gift.to} /> · {dayOf(gift.at)}
          </span>
          {gift.message ? <span className="gh-note">«{gift.message}»</span> : null}
        </small>
      </span>
    </div>
  )
}

export function GiftsBlock() {
  const t = useT()
  const history = useGifts((s) => s.history)
  const failed = useGifts((s) => s.failed)
  const [side, setSide] = useState<Side>('received')
  const signedIn = hasMillidaAccount()

  useEffect(() => {
    if (signedIn) void useGifts.getState().load()
  }, [signedIn])

  if (!signedIn) return null
  const unopened = history?.unopened ?? 0
  const rows = side === 'received' ? (history?.received ?? []) : (history?.sent ?? [])

  return (
    <Block keys={KEYS}>
      <Group title={t('Подарки')}>
        <div className="s2-row">
          <span className="s2-lab">
            <b>{t('История подарков')}</b>
            {unopened > 0 ? <small>{t('Ждут открытия: {n}', { n: unopened })}</small> : null}
          </span>
          <span className="s2-ctl">
            <Segs<Side>
              value={side}
              options={[
                ['received', t('Полученные')],
                ['sent', t('Отправленные')],
              ]}
              onPick={setSide}
            />
          </span>
        </div>
        {!history ? (
          <div className="s2-row gh-empty">
            {failed ? (
              <span className="s2-lab">
                <b>{t('Не удалось загрузить подарки')}</b>
              </span>
            ) : (
              <span className="skel gh-skel" />
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="s2-row gh-empty">
            <span className="s2-lab">
              <b>{side === 'received' ? t('Подарков пока нет') : t('Ты ещё ничего не дарил')}</b>
              <small>{t('Подарить вещь другу можно в магазине')}</small>
            </span>
            <span className="s2-ctl">
              <button className="btn sm secondary" data-track="gift_history_shop" onClick={() => setScreen('rubies')}>
                {t('В магазин')}
              </button>
            </span>
          </div>
        ) : (
          <div className="gh-list">
            {side === 'received'
              ? (rows as ReceivedGift[]).map((g) => <ReceivedRow key={g.id} gift={g} />)
              : (rows as SentGift[]).map((g) => <SentRow key={g.id} gift={g} />)}
          </div>
        )}
      </Group>
    </Block>
  )
}
