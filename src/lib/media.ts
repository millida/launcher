import { useEffect } from 'react'
import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { convertFileSrc, mediaFetch, mediaReady } from '../ipc/commands'
import { noted } from './noted'

// Большие медиафайлы (радио, ролики-обои, страница Arcania) живут в media/. Откуда они берутся, решает одна
// переключалка сборки, MEDIA_REMOTE (docs/MEDIA.md):
//  - по умолчанию файлы едут внутри сборки и читаются по /media/<имя>, как раньше из public/: игрок ничего не
//    теряет, пока объекты не залиты на CDN;
//  - MEDIA_REMOTE=1 (релиз после scripts/check-media-remote.mjs): в установщике их нет, ядро качает каждый один раз
//    по хешу при первом обращении и кладёт в кэш (src-tauri/src/engine/core/media.rs). Окно называет файл по имени
//    из media/manifest.json и читает его по asset://. Пока файла нет — заглушка или постер, лаунчер работает.

/// Качает ли файлы ядро (сборка с MEDIA_REMOTE=1). Иначе они внутри сборки.
export const mediaRemote = (): boolean => typeof __MEDIA_REMOTE__ !== 'undefined' && __MEDIA_REMOTE__

const viaCore = (): boolean => hasTauri() && mediaRemote()

/// Прозрачный GIF 1×1: место под картинку, которая ещё качается. Стиль заглушки — в 05-media.css.
export const MEDIA_WAIT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

interface MediaState {
  /** Имя из манифеста → адрес для <img>/<video>/<audio>. */
  urls: Record<string, string>
  /** Растёт, когда появился хоть один новый файл: компоненты с useMediaTick перерисовываются. */
  tick: number
}

export const useMediaStore = create<MediaState>(() => ({ urls: {}, tick: 0 }))

/// После неудачи (нет сети) тот же файл не просим чаще раза в минуту.
const RETRY_MS = 60_000
const failedAt = new Map<string, number>()
/// Просьбы про группу (`prefix/` и `@пакет`) не сводятся к одному имени: когда ядро ответило, группа считается выданной.
const groupDone = new Set<string>()
const isGroup = (n: string) => n.endsWith('/') || n.startsWith('@')
const groupGot = new Map<string, boolean>()
const loading = new Map<string, Promise<void>>()
let primed: Promise<void> | null = null

function merge(paths: Record<string, string>) {
  const { urls, tick } = useMediaStore.getState()
  let next: Record<string, string> | null = null
  for (const [name, path] of Object.entries(paths)) {
    const url = convertFileSrc(path)
    if (urls[name] !== url) (next ??= { ...urls })[name] = url
  }
  if (next) useMediaStore.setState({ urls: next, tick: tick + 1 })
}

/// Что уже лежит в кэше. Один раз за запуск.
export function primeMedia(): Promise<void> {
  if (!viaCore()) return Promise.resolve()
  return (primed ??= mediaReady()
    .then(merge)
    .catch(() => {
      primed = null
    }))
}

/// Адрес готового файла или null. Внутри сборки (и в браузере разработки, где их отдаёт vite) файл всегда на месте.
export function mediaUrl(name: string): string | null {
  if (!viaCore()) return '/media/' + name
  return useMediaStore.getState().urls[name] ?? null
}

/// Докачать то, чего нет. Имя с косой чертой на конце — всё, что под ним, `@пакет` — все файлы пакета. Промис кончается,
/// когда ядро ответило.
export function ensureMedia(names: string[]): Promise<void> {
  if (!viaCore()) return Promise.resolve()
  const now = Date.now()
  const urls = useMediaStore.getState().urls
  const todo = names.filter((n) => !(n in urls) && !groupDone.has(n) && !loading.has(n) && now - (failedAt.get(n) ?? 0) > RETRY_MS)
  if (todo.length) {
    const job = primeMedia()
      .then(() => {
        const have = useMediaStore.getState().urls
        const still = todo.filter((n) => isGroup(n) || !(n in have))
        return still.length
          ? mediaFetch(still).then((paths) => {
              merge(paths)
              for (const n of still) if (n.startsWith('@')) groupGot.set(n, Object.keys(paths).length > 0)
            })
          : undefined
      })
      .catch(noted('media'))
      .then(() => {
        const have = useMediaStore.getState().urls
        for (const n of todo) {
          loading.delete(n)
          if (isGroup(n)) {
            // Ядро вернуло хоть что-то под этим именем — группа выдана; пустой ответ — повтор через минуту.
            const got = n.startsWith('@') ? groupGot.get(n) : Object.keys(have).some((k) => k.startsWith(n))
            if (got) groupDone.add(n)
            else failedAt.set(n, Date.now())
          } else if (!(n in have)) failedAt.set(n, Date.now())
        }
      })
    for (const n of todo) loading.set(n, job)
  }
  return Promise.all(names.map((n) => loading.get(n)).filter((p): p is Promise<void> => !!p)).then(() => undefined)
}

export const useMediaTick = (): number => useMediaStore((s) => s.tick)

/// Просит снова каждые RETRY_MS, пока `have()` не скажет, что файл на месте, или не вызвали возвращённую остановку.
/// Без этого после сбоя (нет сети в первую минуту) обои и арт оставались заглушкой, пока компонент не пересоздадут:
/// `ensureMedia` сам повторов не делает, а эффект компонента запускался один раз (Н4 второго ревью).
export function askUntilHave(ask: () => Promise<void>, have: () => boolean, delay = RETRY_MS + 500): () => void {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const round = () => {
    void ask().then(() => {
      if (alive && !have()) timer = setTimeout(round, delay)
    })
  }
  round()
  return () => {
    alive = false
    clearTimeout(timer)
  }
}

/// Адрес файла для компонента: просит ядро скачать, пока файла нет, и перерисовывает, когда он появился.
/// null в `name` — «пока не нужен» (карточка за экраном, лёгкий режим).
export function useMedia(name: string | null): string | null {
  const url = useMediaStore((s) => (name ? (viaCore() ? s.urls[name] : '/media/' + name) ?? null : null))
  useEffect(() => {
    if (!name || url) return
    return askUntilHave(
      () => ensureMedia([name]),
      () => name in useMediaStore.getState().urls,
    )
  }, [name, url])
  return url
}

/// То же для набора под общим префиксом: одна просьба ядру на весь пакет.
export function useMediaGroup(prefix: string | null) {
  useMediaTick()
  useEffect(() => {
    if (!prefix) return
    return askUntilHave(
      () => ensureMedia([prefix]),
      () => groupDone.has(prefix),
    )
  }, [prefix])
}

/// Только для тестов: забыть всё, что модуль запомнил.
export function resetMediaForTests(): void {
  failedAt.clear()
  groupDone.clear()
  groupGot.clear()
  loading.clear()
  primed = null
  useMediaStore.setState({ urls: {}, tick: 0 })
}
