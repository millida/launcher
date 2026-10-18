import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'
import { setScreen } from './ui'
import type { ScreenId } from './ui'
import { t } from '../i18n'

export interface TourStep {
  sel: string
  title: string
  text: string
  screen?: ScreenId
}

/// Гайд обновлён под лобби в стиле Brawl Stars (25.09.2026): боковой панели и
/// вкладок больше нет, все разделы — на самой главной, поэтому все шаги идут по
/// её элементам. Селекторы — по стабильным классам/атрибутам лобби; если
/// элемента нет (гость, узкое окно), Tour просто затемняет экран для этого шага.
export const TOUR_STEPS: TourStep[] = [
  {
    sel: '#playBtn',
    get title() {

      return t('Кнопка «Играть»')

    },
    get text() {

      return t('Главная кнопка. Нет сборок — создаст первую. Дальше сама скачает Java, версию игры и моды и запустит Minecraft.')

    },
    screen: 'play',
  },
  {
    sel: '.lobby-mode',
    get title() {

      return t('Что играем сегодня')

    },
    get text() {

      return t('Плашка слева от «Играть» открывает библиотеку: свои сборки, версии, режимы и серверы. Выбрал — «Играть» запустит именно их.')

    },
    screen: 'play',
  },
  {
    sel: '.lobby-char',
    get title() {

      return t('Твой персонаж')

    },
    get text() {

      return t('Стоит в том, что ты надел. Клик по фигуре открывает «Мой скин»: скин, плащи и косметика.')

    },
    screen: 'play',
  },
  {
    sel: '[data-track="tile_wardrobe"]',
    get title() {

      return t('Мой скин')

    },
    get text() {

      return t('Загрузить свой скин, надеть плащ и косметику. Работает на серверах с аккаунтом Millida.')

    },
    screen: 'play',
  },
  {
    sel: '[data-track="tile_shop"]',
    get title() {

      return t('Магазин')

    },
    get text() {

      return t('Рубины и осколки, ежедневный бонус, вещи и PLUS. Значок «!» — тебя ждёт бесплатный бонус.')

    },
    screen: 'play',
  },
  {
    sel: '[data-track="tile_server"]',
    get title() {

      return t('Играть с друзьями')

    },
    get text() {

      return t('Свой сервер для друзей — есть бесплатный тариф. Консоль, моды и игроки прямо из лаунчера.')

    },
    screen: 'play',
  },
  {
    sel: '.lb-friends',
    get title() {

      return t('Друзья')

    },
    get text() {

      return t('Видно, кто в сети и на каком сервере. Чат и приглашение зайти к другу — одной кнопкой.')

    },
    screen: 'play',
  },
  {
    sel: '.lb-acc',
    get title() {

      return t('Аккаунт')

    },
    get text() {

      return t('Здесь переключаются аккаунты и добавляется лицензия Minecraft, если она есть.')

    },
    screen: 'play',
  },
  {
    sel: '[data-screen="settings"]',
    get title() {

      return t('Настройки')

    },
    get text() {

      return t('Цвет кнопок, анимации, папка игры, звук и обновления. Гайд можно запустить отсюда заново.')

    },
    screen: 'play',
  },
]

interface TourState {
  active: boolean
  index: number
}

export const useTour = create<TourState>(() => ({ active: false, index: 0 }))

export const tourDone = (): boolean => readPref('m-tour-done', '') === '1'

function applyScreen(index: number) {
  const s = TOUR_STEPS[index]
  if (s && s.screen) setScreen(s.screen)
}

export function startTour() {
  useTour.setState({ active: true, index: 0 })
  applyScreen(0)
}

export function tourNext() {
  const { index } = useTour.getState()
  if (index >= TOUR_STEPS.length - 1) {
    stopTour()
    return
  }
  useTour.setState({ index: index + 1 })
  applyScreen(index + 1)
}

export function tourPrev() {
  const { index } = useTour.getState()
  if (index <= 0) return
  useTour.setState({ index: index - 1 })
  applyScreen(index - 1)
}

export function stopTour() {
  writePref('m-tour-done', '1')
  useTour.setState({ active: false, index: 0 })
}
