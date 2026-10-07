import { create } from 'zustand'
import { usePlus } from '../state/plus'
import { useUi } from '../state/ui'
import { computeAccent, paintAccent, saveAccent, withColorFade, type AccentVars } from './accent'
import { readPref, writePref, type PrefKey } from './prefs'
import type { ShopTier } from './rubies'
import type { PlusTier } from './gameProfile'

/**
 * Тема лаунчера (владелец 06.10.2026): «Стандартная» · «PLUS» · «Diamond».
 * Премиум-тема — тот же лаунчер, спокойно: золотой (или синий) акцент, тонкие
 * золотые линии, знак PLUS у ника и очень мягкий неподвижный свет сверху. Без
 * частиц и анимированных сцен. Доступна, пока идёт подписка; Diamond — только
 * у Diamond.
 *
 * Тема = акцент (`--m-accent*`, lib/accent) + `data-ptheme` на <html>
 * (styles/pixel/premium-theme.css). `data-sub` — сама подписка: магазин
 * подписчика с тем же мягким светом даже в стандартной теме.
 *
 * После оплаты тема включается сама один раз (прежний акцент запоминается;
 * «Стандартная» его возвращает). Подписка кончилась — возврат к прежнему.
 */

export type PremiumTheme = 'off' | 'plus' | 'diamond'

/** Лишний цвет в палитре «Цвет кнопок» — только у подписчика. */
export const PREMIUM_ACCENTS: { id: string; name: string; c: string; h: string; s: string; tier: PlusTier }[] = [
  { id: 'premium-plus', name: 'Золото PLUS', c: '#F5BD2C', h: '#FFD45C', s: 'rgba(245,189,44,.15)', tier: 'PLUS' },
  { id: 'premium-diamond', name: 'Алмаз Diamond', c: '#4FB8FF', h: '#7CCBFF', s: 'rgba(79,184,255,.15)', tier: 'DIAMOND' },
]

const KEY: PrefKey = 'm-ptheme'
const PREV_KEY: PrefKey = 'm-ptheme-prev'
/** Тариф, для которого тема уже включалась сама: второй раз не навязываем. */
const AUTO_KEY: PrefKey = 'm-ptheme-auto'
export const PLUS_BOUGHT_EVENT = 'm-plus-bought'

/** Можно ли включить тему при этом тарифе. */
export const allowed = (t: PremiumTheme, tier: ShopTier): boolean =>
  t === 'off' || (tier === 'DIAMOND' ? true : tier === 'PLUS' ? t === 'plus' : false)

const read = (k: PrefKey, d = ''): string => {
  try {
    return readPref(k, d) || d
  } catch {
    return d
  }
}

const isTheme = (v: string | null): v is PremiumTheme => v === 'off' || v === 'plus' || v === 'diamond'
const isPremiumAccent = (json: string) => /"id":"premium-/.test(json)

function demoParam(name: string): string | null {
  if (!import.meta.env.DEV) return null
  try {
    return new URLSearchParams(location.search).get(name)
  } catch {
    return null
  }
}

function paintAttrs(theme: PremiumTheme) {
  const root = document.documentElement
  if (theme === 'off') delete root.dataset.ptheme
  else root.dataset.ptheme = theme
}

function paintSub(tier: ShopTier) {
  const root = document.documentElement
  if (tier) root.dataset.sub = tier === 'DIAMOND' ? 'diamond' : 'plus'
  else delete root.dataset.sub
}

/** Запомнить обычный акцент — только если сейчас стоит не премиум-цвет. */
function rememberAccent() {
  const cur = read('m-accent')
  if (!isPremiumAccent(cur)) writePref(PREV_KEY, cur)
}

function restoreAccent() {
  let a: AccentVars | null = null
  try {
    const p = JSON.parse(read(PREV_KEY) || 'null')
    if (p && typeof p.c === 'string' && !isPremiumAccent(JSON.stringify(p))) a = p
  } catch {}
  const back = a || computeAccent({ id: 'green', c: '#5EC64D', h: '#70D55F', s: 'rgba(94,198,77,.13)' })
  paintAccent(back, true)
  saveAccent(back)
  writePref(PREV_KEY, '')
}

/** Премиум-цвет акцента без смены темы (палитра «Цвет кнопок»). */
export function applyPremiumAccent(id: string) {
  const p = PREMIUM_ACCENTS.find((a) => a.id === id)
  if (!p) return
  withColorFade(() => {
    rememberAccent()
    const a = computeAccent({ id: p.id, c: p.c, h: p.h, s: p.s })
    paintAccent(a, true)
    saveAccent(a)
  })
}

interface PremiumState {
  theme: PremiumTheme
  /** Тариф по последнему ответу сервера (null — нет подписки). */
  tier: ShopTier
  /** Ответ о подписке уже был: до него «нет подписки» не значит «кончилась». */
  known: boolean
  /** Закрытый вариант в настройках: открыть окно покупки в магазине. */
  wantPlus: PlusTier | null
  setTheme: (t: PremiumTheme) => void
  requestPlus: (t: PlusTier) => void
}

export const usePremiumTheme = create<PremiumState>((set, get) => ({
  theme: (() => {
    const v = read(KEY, 'off')
    return isTheme(v) ? v : 'off'
  })(),
  tier: null,
  known: false,
  wantPlus: null,
  setTheme: (t) => {
    const s = get()
    if (!allowed(t, s.tier) || t === s.theme) return
    withColorFade(() => {
      if (t === 'off') restoreAccent()
      else {
        rememberAccent()
        const p = PREMIUM_ACCENTS[t === 'diamond' ? 1 : 0]
        const a = computeAccent({ id: p.id, c: p.c, h: p.h, s: p.s })
        paintAccent(a, true)
        saveAccent(a)
      }
      paintAttrs(t)
    })
    writePref(KEY, t)
    set({ theme: t })
  },
  requestPlus: (t) => {
    set({ wantPlus: t })
    useUi.getState().setScreen('rubies')
  },
}))

const themeFor = (tier: ShopTier): PremiumTheme => (tier === 'DIAMOND' ? 'diamond' : tier === 'PLUS' ? 'plus' : 'off')

function autoApply(tier: ShopTier) {
  if (!tier || read(AUTO_KEY) === tier) return
  writePref(AUTO_KEY, tier)
  usePremiumTheme.getState().setTheme(themeFor(tier))
}

let started = false

/** Подключается один раз из main.tsx: сразу рисует сохранённую тему, дальше следит за подпиской. */
export function initPremiumTheme() {
  if (started || typeof document === 'undefined') return
  started = true
  paintAttrs(usePremiumTheme.getState().theme)

  // Демо: ?plus=plus|diamond включает тему тарифа; &ptheme=off|plus|diamond — любую.
  const demoTheme = demoParam('ptheme')
  const demoPlus = demoParam('plus')
  // Демо включает тему тарифа один раз за вкладку: иначе каждая перезагрузка
  // возвращала бы PLUS поверх «Стандартной», выбранной руками.
  let demoFirst = false
  if (demoPlus !== null) {
    try {
      demoFirst = sessionStorage.getItem('m-demo-ptheme') !== demoPlus
      if (demoFirst) {
        sessionStorage.setItem('m-demo-ptheme', demoPlus)
        writePref(AUTO_KEY, '')
      }
    } catch {
      demoFirst = true
    }
  }

  let bought = false
  const onTier = (tier: ShopTier) => {
    const s = usePremiumTheme.getState()
    const before = s.known ? s.tier : undefined
    paintSub(tier)
    usePremiumTheme.setState({ tier, known: true })
    if (!tier) {
      // Подписка кончилась — прежний вид; следующая покупка снова включит тему сама.
      if (s.theme !== 'off') s.setTheme('off')
      else if (isPremiumAccent(read('m-accent'))) restoreAccent()
      writePref(AUTO_KEY, '')
      return
    }
    const st = usePremiumTheme.getState()
    if (!allowed(st.theme, tier)) st.setTheme(themeFor(tier))
    if (demoPlus !== null && before === undefined) {
      if (!demoFirst) return
      if (isTheme(demoTheme) && allowed(demoTheme, tier)) st.setTheme(demoTheme)
      else autoApply(tier)
      return
    }
    // Покупка: событие из опроса оплаты или переход «нет подписки → есть» за сессию.
    if (bought || before === null || (before === 'PLUS' && tier === 'DIAMOND')) {
      bought = false
      if (before === 'PLUS' && tier === 'DIAMOND') writePref(AUTO_KEY, '')
      autoApply(tier)
    }
  }

  window.addEventListener(PLUS_BOUGHT_EVENT, () => {
    bought = true
  })
  usePlus.subscribe((p, prev) => {
    if (p.tier === prev.tier && usePremiumTheme.getState().known) return
    onTier(p.tier)
  })
}
