import { useEffect, useRef } from 'react'
import { showReward, useReward } from './reward/rewardBus'

/**
 * Праздник оформления PLUS — большой миг награды (лучи, корона влетает,
 * конфетти). Зовут гардероб (Skins.tsx) и окно наград (DailyPassModal.tsx):
 * компонент сам ничего не рисует, только ставит раскрытие в общую очередь
 * и сообщает, когда человек нажал «Круто».
 */
export function PlusCelebration({ onDone }: { items?: number; onDone: () => void }) {
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const id = showReward({
      items: [{ name: 'PLUS', icon: 'crown' }],
      tone: 'var(--m-rarity-legendary)',
      kicker: 'Подписка',
      title: 'PLUS открыт',
      sub: 'Вторая награда дня',
      onDone: () => done.current(),
    })
    // StrictMode монтирует дважды — первое раскрытие убираем без onDone.
    return () => useReward.getState().close(id)
  }, [])
  return null
}
