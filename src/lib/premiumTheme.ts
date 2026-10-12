import { create } from 'zustand'
import { usePlus } from '../state/plus'
import { useUi } from '../state/ui'
import { computeAccent, paintAccent, saveAccent, withColorFade, type AccentVars } from './accent'
import { hydratePrefs, readPref, writePref, type PrefKey } from './prefs'
import type { ShopTier } from './rubies'
import { loadPlus, type PlusTier } from './gameProfile'

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
/**
 * Игрок сам выбрал тему или цвет кнопок: дальше лаунчер их не трогает, пока не
 * случится новая оплата. Без этой отметки ложное «подписка кончилась» на старте
 * снимало «уже включали», и следом «есть PLUS» снова красило лаунчер в золото
 * поверх выбранного зелёного — при каждом запуске (владелец 12.10.2026).
 */
const CHOICE_KEY: PrefKey = 'm-ptheme-user'
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

/** Выбор игрока руками (тема или цвет кнопок) — лаунчер его больше не перекрашивает. */
export function markThemeChoice() {
  writePref(CHOICE_KEY, '1')
}

/**
 * Тема PLUS/Diamond — это золотой (синий) цвет кнопок вместе с золотыми линиями рамок и
 * светом сверху. Выбрал обычный цвет кнопок — значит, хочешь обычный лаунчер: тема
 * выключается, а выбранный цвет остаётся (владелец 12.10.2026: зелёные кнопки, а рамки
 * и фон всё равно золотые — «везде золотоватое»). Прежний цвет не возвращаем: его только что выбрали.
 */
export function leavePremiumLook() {
  if (usePremiumTheme.getState().theme === 'off') return
  writePref(KEY, 'off')
  usePremiumTheme.setState({ theme: 'off' })
  paintAttrs('off')
}

/** Тема премиума при обычном цвете кнопок — остаток выбора до этого правила. */
function settleLook() {
  if (usePremiumTheme.getState().theme !== 'off' && !isPremiumAccent(read('m-accent'))) leavePremiumLook()
}

/** Премиум-цвет акцента без смены темы (палитра «Цвет кнопок»). */
export function applyPremiumAccent(id: string) {
  const p = PREMIUM_ACCENTS.find((a) => a.id === id)
  if (!p) return
  markThemeChoice()
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

/** Тема из настроек Стандартная · PLUS · Diamond — выбор игрока. */
export function chooseTheme(t: PremiumTheme) {
  markThemeChoice()
  usePremiumTheme.getState().setTheme(t)
}

const themeFor = (tier: ShopTier): PremiumTheme => (tier === 'DIAMOND' ? 'diamond' : tier === 'PLUS' ? 'plus' : 'off')

/**
 * Сама включает тему тарифа. `paid` — настоящая оплата только что: тогда тема
 * включается всегда, даже поверх прежнего выбора. Без оплаты выбор игрока важнее.
 */
function autoApply(tier: ShopTier, paid = false) {
  if (!tier) return
  if (!paid && (read(AUTO_KEY) === tier || read(CHOICE_KEY) === '1')) return
  writePref(AUTO_KEY, tier)
  writePref(CHOICE_KEY, '')
  usePremiumTheme.getState().setTheme(themeFor(tier))
}

/**
 * Выбор, сделанный до отметки CHOICE_KEY: тема подписки включена, а цвет кнопок
 * обычный, или тему уже включали и игрок её выключил. Оба значат «я выбрал сам».
 */
function inferChoice() {
  if (read(CHOICE_KEY)) return
  const theme = usePremiumTheme.getState().theme
  const manualAccent = theme !== 'off' && !isPremiumAccent(read('m-accent'))
  const turnedOff = theme === 'off' && !!read(AUTO_KEY)
  if (manualAccent || turnedOff) markThemeChoice()
}

let started = false

/** Подключается один раз из main.tsx: сразу рисует сохранённую тему, дальше следит за подпиской. */
export function initPremiumTheme() {
  if (started || typeof document === 'undefined') return
  started = true
  paintAttrs(usePremiumTheme.getState().theme)
  // Тема прочитана до копии с диска: после выхода через трей localStorage мог
  // откатиться на прежнюю. Копия с диска главнее.
  void hydratePrefs().then(() => {
    const v = read(KEY, 'off')
    if (isTheme(v) && v !== usePremiumTheme.getState().theme) {
      usePremiumTheme.setState({ theme: v })
      paintAttrs(v)
    }
    settleLook()
  })

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
        writePref(CHOICE_KEY, '')
      }
    } catch {
      demoFirst = true
    }
  }

  let bought = false
  /** Подписка точно кончилась (проверено запросом) — следующая покупка снова включит тему. */
  let ended = false
  /**
   * Что было до «подписка кончилась» в этой сессии, если тогда что-то перекрасили.
   * Подписка вернулась без оплаты — значит, ответы просто разошлись: возвращаем
   * ровно как было, а не включаем тему заново.
   */
  let undo: { theme: PremiumTheme; accent: string; auto: string } | null = null
  let checking = false
  const restore = (u: NonNullable<typeof undo>, tier: ShopTier) => {
    const st = usePremiumTheme.getState()
    if (!allowed(u.theme, tier)) {
      autoApply(tier)
      return
    }
    withColorFade(() => {
      if (u.theme !== 'off') st.setTheme(u.theme)
      try {
        const a = JSON.parse(u.accent || 'null') as AccentVars | null
        if (a && typeof a.c === 'string') {
          paintAccent(a, true)
          saveAccent(a)
        }
      } catch {}
    })
    writePref(AUTO_KEY, u.auto)
  }
  const confirmEnded = async () => {
    if (checking) return
    checking = true
    const st = await loadPlus().catch(() => null)
    checking = false
    if (!st || st.active) return
    // Пока ждали ответ, другой источник (магазин, опрос оплаты) сказал «подписка есть»:
    // это не конец подписки, а разнобой ответов.
    if (usePlus.getState().tier) return
    const s = usePremiumTheme.getState()
    const was = { theme: s.theme, accent: read('m-accent'), auto: read(AUTO_KEY) }
    ended = true
    paintSub(null)
    usePremiumTheme.setState({ tier: null, known: true })
    let changed = true
    if (s.theme !== 'off') s.setTheme('off')
    else if (isPremiumAccent(was.accent)) restoreAccent()
    else changed = false
    undo = changed ? was : null
    writePref(AUTO_KEY, '')
  }
  let inferred = false
  const onTier = (tier: ShopTier) => {
    if (!inferred) {
      inferred = true
      inferChoice()
    }
    const s = usePremiumTheme.getState()
    const before = s.known ? s.tier : undefined
    if (!tier) {
      // «Нет подписки» приходит и мельком (магазин отдал пустой тариф, ответ ещё не пришёл):
      // раньше это сбрасывало «уже включали», и следующий же «есть PLUS» снова красил лаунчер
      // в золото поверх выбранной зелёной темы (владелец 10.10.2026). Верим только проверке.
      void confirmEnded()
      return
    }
    paintSub(tier)
    usePremiumTheme.setState({ tier, known: true })
    const st = usePremiumTheme.getState()
    if (!allowed(st.theme, tier)) st.setTheme(themeFor(tier))
    if (demoPlus !== null && before === undefined) {
      if (!demoFirst) return
      if (isTheme(demoTheme) && allowed(demoTheme, tier)) st.setTheme(demoTheme)
      else autoApply(tier)
      return
    }
    // Покупка: событие из опроса оплаты или переход «нет подписки → есть» за сессию.
    const upgraded = before === 'PLUS' && tier === 'DIAMOND'
    if (bought || upgraded || (before === null && ended)) {
      const paid = bought || upgraded
      const back = undo
      ended = false
      bought = false
      undo = null
      if (!paid && back) restore(back, tier)
      else autoApply(tier, paid)
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
