import { useState } from 'react'
import { useLayoutEffect } from 'react'
import { openHubBuild } from '../components/playhub/hubTab'
import { SiteCatalog } from '../components/catalog/SiteCatalog'
import { AiBuilder } from '../components/catalog/AiBuilder'
import { PxIcon } from '../components/PxIcon'
import { Icon } from '../components/Icon'

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
/**
 * ИИ-сборщик — маленькая кнопка в правом нижнем углу «Ресурсов», по нажатию
 * раскрывается окном (владелец 24.09.2026, 17:50: «чтобы не занимал место,
 * это реклама, что у нас есть нейронка»).
 */
function AiFab() {
  const [open, setOpen] = useState(false)
  return open ? (
    <div className="aif-panel" role="dialog" aria-label="ИИ-сборщик">
      <button className="aif-x" aria-label="Свернуть" onClick={() => setOpen(false)}>
        <Icon id="i-x" />
      </button>
      <AiBuilder />
    </div>
  ) : (
    <button className="aif-btn" data-sound="open" data-track="ai_fab" onClick={() => setOpen(true)}>
      <PxIcon name="sparkle" size={22} /> ИИ соберёт сборку
    </button>
  )
}

export function CatalogPane({
  content,
  onOpenPack,
  servers,
}: {
  content?: boolean
  onOpenPack?: (slug: string) => void
  servers?: import('react').ReactNode
}) {
  return (
    <div className="hub-cat">
      {content ? null : <AiFab />}
      <SiteCatalog content={content} onOpenPack={onOpenPack} servers={servers} />
    </div>
  )
}
