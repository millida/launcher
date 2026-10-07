import { playSample, type SoundEvent } from '../../lib/sound'
import type { Rarity } from '../../lib/rubies'
import { rarityRank } from '../shop/rarity'

/**
 * Звуки открытия сундука (06.10.2026): события сцены → звуки Minecraft из
 * ассетов Mojang (src-tauri/src/engine/media/sounds.rs качает их при первом
 * запуске). Высота — playbackRate того же образца. Громкость и «выключено»
 * уважает playSample (общие настройки звука). Отображение событий — чистая
 * функция `cues`, её проверяет caseSound.test.ts.
 *
 *   rumble  — сундук появился и трясётся: низкий стук дерева трижды;
 *   hit     — удар: стук дерева, каждый выше; со второго — треск, последний — сильнее;
 *   burst   — крышка: взрыв фейерверка, скрип сундука, искра опыта;
 *   reveal  — награда: валюта звенит, вещь — по редкости (эпик — испытание,
 *             легенда и выше — новый уровень и золото);
 *   up      — сундук поднялся на редкость (как Starr Drops): звон, выше с каждой ступенью;
 *   flip    — карта ×10 перевернулась: короткий щелчок, редкие — звоном редкости;
 *   best    — лучшая карта ×10 открыта последней: фанфары.
 */
export type CaseSound =
  | { t: 'rumble' }
  | { t: 'hit'; i: number; last: boolean }
  | { t: 'burst' }
  | { t: 'reveal'; kind: 'item' | 'cheap' | 'rubies' | 'shards' | 'fragments'; rarity?: Rarity }
  | { t: 'up'; rarity: Rarity }
  | { t: 'flip'; rarity?: Rarity }
  | { t: 'best'; rarity?: Rarity }

/** Один звук: образец, высота, задержка (мс). */
export interface Cue {
  ev: SoundEvent
  rate: number
  at: number
}

const cue = (ev: SoundEvent, rate = 1, at = 0): Cue => ({ ev, rate, at })

export function cues(s: CaseSound): Cue[] {
  switch (s.t) {
    case 'rumble':
      return [cue('chest_hit', 0.5), cue('chest_hit', 0.56, 90), cue('chest_hit', 0.5, 180)]
    case 'hit': {
      const out = [cue('chest_hit', 0.85 + s.i * 0.12)]
      if (s.i >= 1) out.push(cue('chest_crack', 1.1 + s.i * 0.05, 40))
      if (s.last) out.push(cue('chest_crack', 0.8, 110))
      return out
    }
    case 'burst':
      return [cue('case_burst'), cue('chest_open', 1, 40), cue('chest_card', 1.3, 200)]
    case 'reveal': {
      if (s.kind === 'rubies') return [cue('chest_card', 1.5), cue('chest_gold', 1.15, 70), cue('chest_gold', 1.3, 160)]
      if (s.kind === 'shards') return [cue('chest_rare', 1.2), cue('chest_card', 1.6, 90)]
      const r = rarityRank(s.rarity)
      if (r >= rarityRank('LEGENDARY')) return [cue('achievement'), cue('chest_epic', 1, 120), cue('chest_gold', 1, 260)]
      if (r >= rarityRank('EPIC')) return [cue('chest_epic'), cue('chest_rare', 1.1, 120)]
      if (r >= rarityRank('RARE')) return [cue('chest_rare', 1.1)]
      return [cue('chest_card', 1 + Math.max(0, r) * 0.15)]
    }
    case 'up': {
      const r = Math.max(0, rarityRank(s.rarity))
      const out = [cue('chest_rare', 0.9 + r * 0.1), cue('chest_crack', 1.2 + r * 0.05, 30)]
      if (r >= rarityRank('EPIC')) out.push(cue('chest_epic', 0.9 + r * 0.05, 90))
      return out
    }
    case 'flip': {
      const r = Math.max(0, rarityRank(s.rarity))
      if (r >= rarityRank('EPIC')) return [cue('chest_card', 1.3), cue('chest_epic', 1, 60)]
      if (r >= rarityRank('RARE')) return [cue('chest_card', 1.3), cue('chest_rare', 1.1, 50)]
      return [cue('chest_card', 1.1 + r * 0.1)]
    }
    case 'best':
      return [cue('case_burst'), cue('achievement', 1, 80), cue('chest_epic', 1, 200), cue('chest_gold', 1, 340), cue('chest_gold', 1.25, 460)]
  }
}

/** Проиграть событие сцены. Таймеры отложенных звуков — в `timers` (снимаются при закрытии). */
export function playCase(s: CaseSound, timers?: number[]) {
  for (const c of cues(s)) {
    if (!c.at) playSample(c.ev, c.rate)
    else {
      const t = window.setTimeout(() => playSample(c.ev, c.rate), c.at)
      timers?.push(t)
    }
  }
}
