import { useEffect, useState } from 'react'
import { api, mirrorAsset } from '../../lib/api'
import { diskGet, diskSet } from '../../lib/diskCache'
import { blockFor } from '../catalog/itemView'
import { blockArt } from './data'
import { NO_ART, artFromOriginal, artFromView, hasArt, type ListingArtCard, type PackArt, type PackViewArt } from './packArtPick'
import '../../styles/pixel/catalog2.css'

/** The same Minecraft block the catalog draws for a material without a logo: picked by slug, stable between visits. */
export const blockIcon = (key: string): string => blockArt(blockFor(key))

const mem = new Map<string, PackArt>()
const running = new Map<string, Promise<PackArt>>()
const mirrored = (a: PackArt): PackArt => ({ cover: a.cover ? mirrorAsset(a.cover) || a.cover : null, icon: a.icon ? mirrorAsset(a.icon) || a.icon : null })

async function resolve(slug: string, title: string): Promise<PackArt> {
  const view = await api<PackViewArt>('/catalog/packs/' + encodeURIComponent(slug)).catch(() => null)
  const own = artFromView(view)
  if (hasArt(own)) return mirrored(own)
  const q = title.trim()
  if (!q) return NO_ART
  const list = await api<{ items?: ListingArtCard[] }>('/catalog/listing?section=modpacks&perPage=12&q=' + encodeURIComponent(q)).catch(() => null)
  return mirrored(artFromOriginal(q, Array.isArray(list?.items) ? list.items : []))
}

/** Pictures for one of our packs whose list entry has no cover. `slug` null = nothing to look up. */
export function usePackArt(slug: string | null | undefined, title: string, known: string | null | undefined): PackArt {
  const key = known || !slug ? '' : slug
  const [art, setArt] = useState<PackArt>(() => (key ? mem.get(key) : undefined) ?? NO_ART)
  useEffect(() => {
    if (!key) return
    let alive = true
    const hit = mem.get(key)
    if (hit) setArt(hit)
    else
      void diskGet<PackArt>('pack-art:' + key).then((r) => {
        if (alive && r?.value && !mem.has(key)) setArt(r.value)
      })
    let run = running.get(key)
    if (!run) {
      run = resolve(key, title).finally(() => running.delete(key))
      running.set(key, run)
    }
    void run.then((a) => {
      mem.set(key, a)
      diskSet('pack-art:' + key, a)
      if (alive) setArt(a)
    })
    return () => {
      alive = false
    }
  }, [key, title])
  return known ? { cover: known, icon: null } : art
}

const hideOnError = (e: { currentTarget: HTMLImageElement }) => {
  e.currentTarget.style.visibility = 'hidden'
}

/** Tile art of one of our packs: cover, else its icon on a blurred copy of itself, else a block in the same frame. */
export function PackTileArt({ slug, title, cover }: { slug: string | null | undefined; title: string; cover: string | null | undefined }) {
  const art = usePackArt(slug, title, cover)
  if (art.cover) return <img src={art.cover} alt="" decoding="async" draggable={false} onError={hideOnError} />
  const icon = art.icon || blockIcon(slug || title)
  return (
    <span className="mr-gal-iconcover">
      <img src={icon} alt="" decoding="async" draggable={false} onError={hideOnError} />
      <img src={icon} alt="" decoding="async" draggable={false} onError={hideOnError} />
    </span>
  )
}
