import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'
import { setScreen } from './ui'
import type { ScreenId } from './ui'

export interface TourStep {
  sel: string
  title: string
  text: string
  screen?: ScreenId
}

export const TOUR_STEPS: TourStep[] = [
  {
    sel: '[data-screen="play"]',
    title: 'Главный экран',
    text: 'Здесь выбранная сборка, обои и всё, что нужно, чтобы просто зайти в игру.',
    screen: 'play',
  },
  {
    sel: '#playBtn',
    title: 'Кнопка запуска',
    text: 'Пока сборок нет — она создаст первую. Дальше по ней лаунчер сам скачает Java, версию игры и моды и запустит Minecraft.',
    screen: 'play',
  },
  {
    sel: '[data-screen="builds"]',
    title: 'Сборки',
    text: 'Создать свою сборку, импортировать чужую, задать Java и разрешение окна — всё тут.',
  },
  {
    sel: '[data-screen="mods"]',
    title: 'Контент',
    text: 'Моды, модпаки, шейдеры, ресурспаки и карты из Modrinth и CurseForge — ставятся в сборку в один клик.',
  },
  {
    sel: '[data-screen="servers"]',
    title: 'Серверы',
    text: 'Рейтинг серверов Millida: смотришь онлайн и заходишь без ручного ввода IP.',
  },
  {
    sel: '[data-screen="skins"]',
    title: 'Скины',
    text: 'Свой скин, плащи и награды — работают на серверах с аккаунтом Millida.',
  },
  {
    sel: '[data-screen="friends"]',
    title: 'Друзья',
    text: 'Видно, кто в сети и на каком сервере. Чат и приглашение зайти к другу одной кнопкой.',
  },
  {
    sel: '[data-screen="hosting"]',
    title: 'Хостинг',
    text: 'Свой сервер для друзей — есть бесплатный тариф. Консоль, моды, игроки — прямо из лаунчера.',
  },
  {
    sel: '.account',
    title: 'Аккаунты',
    text: 'Здесь переключаются аккаунты и добавляется лицензия Minecraft, если она есть.',
  },
  {
    sel: '[data-screen="settings"]',
    title: 'Настройки',
    text: 'Тема, папка игры, звук, музыка и обновления. Гайд можно запустить отсюда заново.',
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
