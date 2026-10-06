import type { ChestTier } from '../../lib/rubies'
import { parseBbModel, sampleTrack, type BbClip, type BbModel } from './bbModel'
import copper from './chests/copper.bbmodel?raw'
import diamond from './chests/diamond.bbmodel?raw'
import netherite from './chests/netherite.bbmodel?raw'
import obsidian from './chests/obsidian.bbmodel?raw'

const SOURCES: Partial<Record<ChestTier, string>> = { COMMON: copper, RARE: diamond, EPIC: obsidian, LEGEND: netherite }

export interface ChestModel {
  model: BbModel
  idle: BbClip | null
  open: BbClip | null
  lidAt: number
}

const LID = 'chest_up'
const LID_OPEN_DEG = 45

function findBone(nodes: BbModel['roots'], name: string): string | null {
  for (const n of nodes) {
    if (!('children' in n)) continue
    if (n.name === name) return n.uuid
    const inner = findBone(n.children, name)
    if (inner) return inner
  }
  return null
}

function lidOpensAt(model: BbModel, open: BbClip | null): number {
  const lid = findBone(model.roots, LID)
  const track = open?.tracks.find((t) => t.bone === lid && t.channel === 'rotation')
  if (!open || !track) return 0
  for (let t = 0; t <= open.length; t += 1 / 60) if (Math.abs(sampleTrack(track.keys, t)[0]) >= LID_OPEN_DEG) return t
  return 0
}

const cache = new Map<ChestTier, ChestModel | null>()

export function chestModel(tier: ChestTier): ChestModel | null {
  if (cache.has(tier)) return cache.get(tier)!
  const src = SOURCES[tier]
  let entry: ChestModel | null = null
  if (src) {
    try {
      const model = parseBbModel(src)
      const open = model.clips.find((c) => c.loop === 'hold') ?? null
      entry = { model, idle: model.clips.find((c) => c.loop === 'loop') ?? null, open, lidAt: lidOpensAt(model, open) }
    } catch (e) {
      console.error('chest model for ' + tier + ' is broken, falling back to the voxel chest', e)
    }
  }
  cache.set(tier, entry)
  return entry
}
