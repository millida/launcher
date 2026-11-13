import { seasonOf } from './ambience'
import { hydratePrefs, readPref } from './prefs'
import { FESTIVE_KEY, festiveActive, useFestive, type FestiveScene } from './festiveStore'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { appVersion } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

/**
 * Новогодняя тема (владелец 11.11.2026): снег во всём окне, сугробы у нижнего края,
 * фейерверки в новогоднюю ночь, гирлянда сверху, праздничные кнопки. Бесплатно всем.
 *
 * Пока тема живёт только в тестовой сборке: локальная сборка с версией 99.x
 * (BUILDING.md: «version": "99.0.0» в tauri.conf.json) показывает её всегда, чтобы
 * проверить до сезона. В обычных сборках её нет, пока FESTIVE_IN_PROD = false.
 * Включить у всех — поставить true: тогда тема сама идёт с 10.12 по 20.01
 * (lib/ambience, seasonOf), а фейерверки — с 31.12 по 02.01.
 *
 * Тема — атрибут `data-festive="winter|newyear"` на <html> и слой поверх окна
 * (components/festive: снег, гирлянда, festive.css) в своём корне React у <body>.
 * Этот файл main.tsx грузит через import(), слой — только когда тема на экране:
 * стартовый бюджет тема не трогает, обычная сборка слой не скачивает.
 * Состояние — lib/festiveStore (его же читают настройки и лобби).
 */
export const FESTIVE_IN_PROD = false

/** Старший номер версии локальной тестовой сборки. */
export const TEST_BUILD_MAJOR = 99

export { festiveActive, useFestive, type FestiveScene }

/** Подмена даты для проверки в тестовой сборке и в DEV: «MM-DD», например «12-31». */
const DATE_KEY = 'm-festive-date'

export function isTestBuild(version: string): boolean {
  const major = Number(/^\s*v?(\d+)\./.exec(version)?.[1])
  return Number.isFinite(major) && major >= TEST_BUILD_MAJOR
}

/** Праздничный сезон на эту дату: снег или снег с фейерверками. */
export function festiveSeason(d: Date): FestiveScene | null {
  const s = seasonOf(d)
  return s === 'winter' || s === 'newyear' ? s : null
}

/**
 * Что показывать. Тестовая сборка — всегда (вне сезона — снег), обычная — только
 * в сезон и только когда тема включена для всех.
 */
export function festiveScene(o: { test: boolean; prod: boolean; date: Date }): FestiveScene | null {
  const s = festiveSeason(o.date)
  if (o.test) return s ?? 'winter'
  return o.prod ? s : null
}

/** «MM-DD» → дата этого года; что-то другое — сегодня. */
export function festiveDate(override: string | null, now = new Date()): Date {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(override?.trim() ?? '')
  if (!m) return now
  const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), 12)
  return Number.isNaN(d.getTime()) ? now : d
}

function paint() {
  const root = document.documentElement
  const scene = festiveActive(useFestive.getState())
  if (scene) root.dataset.festive = scene
  else delete root.dataset.festive
}

function devWanted(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return new URLSearchParams(location.search).has('festive')
  } catch {
    return false
  }
}

function dateOverride(test: boolean): string | null {
  if (!test) return null
  try {
    return localStorage.getItem(DATE_KEY)
  } catch {
    return null
  }
}

let mounted = false

/** Слой — свой корень React у <body>: position: fixed, под окнами (400) и тостами (500). */
function mountLayer() {
  if (mounted) return
  mounted = true
  void import('../components/festive/FestiveLayer')
    .then(({ FestiveLayer }) => {
      const el = document.createElement('div')
      el.id = 'fx-root'
      document.body.appendChild(el)
      createRoot(el).render(createElement(FestiveLayer))
    })
    .catch(() => {
      mounted = false
    })
}

function onState() {
  paint()
  if (festiveActive(useFestive.getState())) mountLayer()
}

let started = false

/** Один раз из main.tsx. В обычной сборке без флага только спрашивает версию и больше ничего не делает. */
export function initFestive() {
  if (started || typeof document === 'undefined') return
  started = true
  useFestive.subscribe(onState)
  void hydratePrefs().then(() => useFestive.setState({ on: readPref(FESTIVE_KEY, '1') !== '0' }))

  const version = hasTauri() ? appVersion().catch(() => '') : Promise.resolve('')
  void version.then((v) => {
    const test = devWanted() || isTestBuild(v)
    if (!test && !FESTIVE_IN_PROD) return
    const check = () => useFestive.setState({ scene: festiveScene({ test, prod: FESTIVE_IN_PROD, date: festiveDate(dateOverride(test)) }) })
    check()
    // Сезон меняется только в полночь (31.12 — фейерверки, 21.01 — конец снега): один таймер
    // до следующей полуночи, а не опрос; после сна ПК — проверка, когда окно снова в фокусе.
    const atMidnight = () => {
      const now = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
      window.setTimeout(() => {
        check()
        atMidnight()
      }, next.getTime() - now.getTime())
    }
    atMidnight()
    window.addEventListener('focus', check)
  })
}
