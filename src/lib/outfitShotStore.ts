import type { ShotFocus } from './outfitShotMeta'

/*
 * Finished "you in the set" shots without three.js: memory and IndexedDB. A saved shot does not
 * wait for an idle window or the 3D module (about 735 KB). The light wrapper (outfitShotLazy.ts)
 * and the shots module read the same cache.
 */

/**
 * `dressed` is how many items really went on the figure: 0 means the 3D failed (the models did
 * not arrive), and the card shows the flat preview of the item, not a bare character.
 */
export interface OutfitShot {
  url: string
  dressed: number
  /**
   * A loop, for emotes and moving items: `url` is a strip of `frames` frames, left to right,
   * played over `seconds` in a circle (LoopShot). Without it, a single frame.
   */
  frames?: number
  seconds?: number
  /** One frame of a moving item: its loop is still being made and comes next. */
  pending?: boolean
}

export type StoredShot = { blob: Blob; dressed: number; frames?: number; seconds?: number; pending?: boolean }

/**
 * Shots on disk: IndexedDB, keyed by skin, items, frame and proportions. SHOT_VER grows when the
 * frame changes, and old shots are then ignored.
 */
// v5: frame loops, no contact shadow under the feet.
const SHOT_VER = 'v7'
const DB = 'm-outfit-shots'
/** The frame of a moving item has its own key; saving the loop removes it. */
const STILL = '|still'

let dbAsk: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  if (dbAsk) return dbAsk
  dbAsk = new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('shots')
      r.onsuccess = () => ok(r.result)
      r.onerror = () => ok(null)
    } catch {
      ok(null)
    }
  })
  return dbAsk
}

function idbGet(key: string): Promise<string | StoredShot | null> {
  return db().then(
    (d) =>
      new Promise((ok) => {
        if (!d) return ok(null)
        try {
          const q = d.transaction('shots').objectStore('shots').get(SHOT_VER + '|' + key)
          q.onsuccess = () => {
            const v = q.result as unknown
            if (typeof v === 'string') return ok(v)
            const rec = v as StoredShot | undefined
            ok(rec && rec.blob instanceof Blob ? rec : null)
          }
          q.onerror = () => ok(null)
        } catch {
          ok(null)
        }
      }),
  )
}

function idbSet(key: string, value: StoredShot, replaces?: string): Promise<void> {
  return db().then((d) => {
    try {
      const shots = d?.transaction('shots', 'readwrite').objectStore('shots')
      shots?.put(value, SHOT_VER + '|' + key)
      if (replaces) shots?.delete(SHOT_VER + '|' + replaces)
    } catch {}
  })
}

/** Cache key: skin, arm type and the set of items, in any order. */
export const shotKey = (skin: string, slim: boolean, codes: readonly string[]) =>
  skin + '|' + (slim ? 's' : 'c') + '|' + [...codes].sort().join(',')

/** Key of a whole shot: the set, the frame for the item and the proportions of the tile. */
export const fullShotKey = (skin: string, slim: boolean, codes: readonly string[], focus: ShotFocus, aspect: number) =>
  shotKey(skin, slim, codes) + '|' + focus + '|' + aspect

export function fromStored(s: StoredShot): OutfitShot {
  const shot: OutfitShot = { url: URL.createObjectURL(s.blob), dressed: s.dressed }
  if (s.frames && s.frames > 1) {
    shot.frames = s.frames
    shot.seconds = s.seconds
  }
  if (s.pending) shot.pending = true
  return shot
}

/** A record from disk: an image string (one frame) or the JSON of a loop. */
function fromDisk(saved: string): OutfitShot {
  if (saved.startsWith('{')) {
    try {
      const r = JSON.parse(saved) as OutfitShot
      if (r && typeof r.url === 'string') return { ...r, dressed: Math.max(1, r.dressed || 1) }
    } catch {}
  }
  return { url: saved, dressed: 1 }
}

/** Shots of this session, finished and still in the making. */
export const shotCache = new Map<string, Promise<OutfitShot | null>>()

/**
 * A shot from memory or disk: a finished loop or a frame, `null` to shoot it anew.
 * A disk hit stays in memory until the session ends.
 */
export function storedShot(key: string): Promise<OutfitShot | null> {
  const ready = shotCache.get(key)
  if (ready) return ready
  const read = idbGet(key)
    .then((saved) => {
      if (saved) return typeof saved === 'string' ? fromDisk(saved) : fromStored(saved)
      return idbGet(key + STILL).then((still) => (still && typeof still !== 'string' ? fromStored(still) : null))
    })
    .catch(() => null)
  return read.then((hit) => {
    // A miss is not kept: the next visit shoots it. A hit does not replace a shot in the making.
    if (hit && !shotCache.has(key)) shotCache.set(key, Promise.resolve(hit))
    return hit
  })
}

/** Saves a finished shot: a frame under its own key, or the loop, which replaces that frame. */
export function saveShot(key: string, value: StoredShot): void {
  void (value.pending ? idbSet(key + STILL, value) : idbSet(key, value, key + STILL))
}
