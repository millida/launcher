import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Head } from '../Head'
import { PxIcon } from '../PxIcon'
import { Burst, Rays } from '../reward/RewardFx'
import { showReward } from '../reward/rewardBus'
import { openGiftOnServer, type ReceivedGift } from '../../lib/gifts'
import { playSound } from '../../lib/sound'
import { useGifts } from '../../state/gifts'
import { showToast } from '../../state/ui'
import { useT } from '../../i18n'
import '../../styles/pixel/reward.css'
import './gift-open.css'

type Phase = 'idle' | 'shake' | 'open'

const SHAKE_MIN_MS = 720
const LID_OFF_MS = 560
const BOX_PX = 176

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))

export function GiftOpen() {
  const t = useT()
  const id = useGifts((s) => s.opening)
  const gift = useGifts((s) => s.history?.received.find((g) => g.id === s.opening) ?? null)
  const [phase, setPhase] = useState<Phase>('idle')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    setPhase('idle')
    return () => {
      alive.current = false
    }
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phase !== 'idle') return
      e.stopPropagation()
      useGifts.getState().hideGift()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase])

  if (!id) return null
  const from = gift?.from?.nickname || t('Друг')

  const reveal = (opened: ReceivedGift) => {
    const store = useGifts.getState()
    store.markOpened(opened)
    store.hideGift()
    showReward({
      level: 'big',
      kicker: t('Подарок от {nick}', { nick: opened.from?.nickname || t('Друг') }),
      items: opened.item ? [{ name: opened.item.name, preview: opened.item.preview, rarity: opened.item.rarity }] : [{ name: t('Подарок'), icon: 'gift' }],
      ...(opened.message ? { sub: '«' + opened.message + '»' } : {}),
    })
  }

  const unwrap = async () => {
    if (phase !== 'idle') return
    if (gift?.opened) return reveal(gift)
    const quick = reducedMotion()
    setPhase('shake')
    playSound('click')
    try {
      const [opened] = await Promise.all([openGiftOnServer(id), wait(quick ? 0 : SHAKE_MIN_MS)])
      if (!alive.current) return
      setPhase('open')
      await wait(quick ? 0 : LID_OFF_MS)
      if (alive.current) reveal(opened)
    } catch (err) {
      console.error('[gifts] open', err)
      if (!alive.current) return
      setPhase('idle')
      showToast(t('Подарок не открылся — попробуй ещё раз'), 'error')
    }
  }

  return createPortal(
    <div
      className={'rw gfo is-' + phase}
      style={{ '--rw-tone': 'var(--m-accent)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={t('Подарок от {nick}', { nick: from })}
      onClick={() => {
        if (phase === 'idle') useGifts.getState().hideGift()
      }}
    >
      <div className="rw-stage">
        <Rays />
        <button
          type="button"
          className="gfo-box"
          aria-label={t('Открыть подарок')}
          data-track="gift_unwrap"
          disabled={phase !== 'idle'}
          onClick={(e) => {
            e.stopPropagation()
            void unwrap()
          }}
        >
          <span className="gfo-body">
            <PxIcon name="gift" size={BOX_PX} />
          </span>
          <span className="gfo-lid">
            <PxIcon name="gift" size={BOX_PX} />
          </span>
        </button>
        {phase === 'open' && !reducedMotion() ? <Burst n={30} spread={280} /> : null}
      </div>
      <div className="rw-text">
        <span className="rw-kicker gfo-from">
          <Head nick={gift?.from?.nickname} size={22} />
          {t('Подарок от {nick}', { nick: from })}
        </span>
        <b className="rw-title">{t('Тебе подарок!')}</b>
        <span className="rw-sub">{t('Нажми на коробку, чтобы открыть')}</span>
      </div>
      <div className="rw-acts" onClick={(e) => e.stopPropagation()}>
        <button className="btn md secondary" disabled={phase !== 'idle'} onClick={() => useGifts.getState().hideGift()}>
          {t('Позже')}
        </button>
        <button className="btn md primary" autoFocus disabled={phase !== 'idle'} data-track="gift_unwrap_btn" onClick={() => void unwrap()}>
          {t('Открыть')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
