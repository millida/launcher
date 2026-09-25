import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { importDroppedPack } from '../ipc/commands'
import { listenPackDrag, listenPackDrop, type DroppedPack } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import { useProfiles } from '../state/profiles'
import { showToast, useUi } from '../state/ui'
import { track } from '../lib/telemetry'
import type { ScreenId } from '../state/ui'
import { trackImportFailure } from '../lib/importTrack'

const SCREENS: ScreenId[] = ['play', 'builds']

/// Перетаскивание принимает ядро: путь приходит от системы вместе с окном, а не
/// от страницы, поэтому наружу уходит только выданный ядром номер файла.
export function PackDrop() {
  const screen = useUi((s) => s.screen)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const armed = useRef(false)
  const running = useRef(false)

  useEffect(() => {
    armed.current = SCREENS.includes(screen)
    if (!armed.current) setOver(false)
  }, [screen])

  useEffect(() => {
    let alive = true
    const stops: UnlistenFn[] = []
    const keep = (u: UnlistenFn | null) => {
      if (!u) return
      if (alive) stops.push(u)
      else u()
    }

    const run = async (packs: DroppedPack[]) => {
      running.current = true
      for (const pack of packs) {
        setBusy(pack.name)
        try {
          const prof = await importDroppedPack(pack.id)
          track('build_import', {
            source: 'drop',
            mc: prof.version,
            loader: prof.loader || (prof.fabric ? 'fabric' : 'vanilla'),
          })
          useProfiles.getState().setSelected(prof.name)
          void useProfiles.getState().refresh()
          showToast('Импортировано: ' + prof.name)
        } catch (err) {
          trackImportFailure('drop', err, { name: pack.name })
          showToast('' + err, 'error')
        }
      }
      setBusy(null)
      running.current = false
    }

    void listenPackDrag((v) => keepDrag(v)).then(keep)
    void listenPackDrop((packs) => {
      setOver(false)
      if (!armed.current || running.current) return
      if (!packs.length) {
        showToast('Такой файл не подойдёт: нужен .mrpack или zip сборки', 'error')
        return
      }
      void run(packs)
    }).then(keep)

    function keepDrag(v: boolean) {
      if (!armed.current || running.current) return
      setOver(v)
    }

    return () => {
      alive = false
      stops.forEach((u) => u())
    }
  }, [])

  if (!over && !busy) return null

  return (
    <div className={'pack-drop' + (busy ? ' busy' : '')}>
      <div className="pack-drop-card">
        <Icon id="i-box2" />
        <b>{busy ? 'Импортируем сборку' : 'Отпусти файл сборки'}</b>
        <span>{busy || '.mrpack, zip сборки или zip клиента'}</span>
      </div>
    </div>
  )
}
