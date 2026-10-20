import { useLayoutEffect, useState } from 'react'
import { openHubBuild } from '../components/playhub/hubTab'
import { SiteCatalog } from '../components/catalog/SiteCatalog'
import { RemoteScreen } from '../components/RemoteScreen'
import { remoteUiEnabled } from '../lib/remoteUi'
import { makeRemoteBridge } from '../lib/remoteUiBridge'

/*
 * Millida Каталог в лаунчере — каталог millida.net один в один (владелец
 * 24.09.2026, 15:25: «возьми прямо с сайта Millida каталог»): те же разделы,
 * фильтры, счётчики, строки и данные (`components/catalog/Site*`). Серверное
 * (плагины, ядра, серверные сборки) — в «Хостинге».
 */

/**
 * Старый экран каталога. Каталог живёт в хабе «Во что играем»: входы
 * `setScreen('mods')` с разделом «Сборки» открывают полный каталог хаба,
 * с модами, паками, картами — вкладку «Мои сборки» с тем разделом, который
 * выставили перед переходом.
 */
export function Mods({ on }: { on: boolean }) {
  useLayoutEffect(() => {
    if (on) openHubBuild()
  }, [on])
  return null
}

/**
 * Каталог в хабе: полный (страница раздела со всеми вкладками) или `content` —
 * во вкладке «Мои сборки», без «Сборок». `onOpenPack` — своя сборка каталога
 * открывается своей страницей хаба («Играть», сервер сборки).
 */
export function CatalogPane({
  content,
  onOpenPack,
  servers,
}: {
  content?: boolean
  onOpenPack?: (slug: string) => boolean | void
  servers?: import('react').ReactNode
}) {
  const [remoteFailed, setRemoteFailed] = useState(false)
  // The full catalog comes from the website bundle when website screens are on; «Мои сборки» keeps its own pane.
  if (!content && remoteUiEnabled() && !remoteFailed)
    return (
      <div className="hub-cat">
        <RemoteScreen screen="catalog" onFail={() => setRemoteFailed(true)} bridge={() => makeRemoteBridge({ join: () => undefined })} />
      </div>
    )
  return (
    <div className="hub-cat">
      <SiteCatalog content={content} onOpenPack={onOpenPack} servers={servers} />
    </div>
  )
}
