import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readAnimations } from './cosmeticAnimation'
import { readCosmeticMesh } from './cosmeticGeometry'
import { emoteSequence } from './emoteSequence'
import { EMOTE_PARTS, EmoteSkeleton } from './emoteSkeleton'

/**
 * Свои эмоции, собранные в репозитории перед загрузкой на сервер
 * (docs/emotes/<набор>/*.json, см. build.mjs там же). Сервер отдаёт их как
 * есть, поэтому файл обязан читаться и лаунчером, и модом: разгон и петля
 * находятся, кости клипов есть в геометрии, у частей игрока нет своих кубов
 * (иначе поверх фигуры нарисовалось бы второе тело), петля сходится, а фигура
 * не уходит из кадра — лобби её смещение не гасит. В публичном дереве папки
 * docs нет, и тест там пропускается.
 */
const ROOT = join(import.meta.dir, '../../docs/emotes')
const sets = existsSync(ROOT) ? readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'catalog.json'))) : []

type CatalogItem = { id: string; model: string; animation: string; slot: string; texture?: string }

describe.skipIf(!sets.length)('authored emotes', () => {
  for (const set of sets) {
    const dir = join(ROOT, set)
    const catalog = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8')) as { items: CatalogItem[] }

    it(set + ': every catalog item has its model file', () => {
      expect(catalog.items.length).toBeGreaterThan(0)
      for (const item of catalog.items) {
        expect(item.slot).toBe('EMOTE')
        expect(existsSync(join(dir, item.model.replace(/^geometry\./, '') + '.json'))).toBe(true)
        if (item.texture) expect(existsSync(join(dir, item.texture))).toBe(true)
      }
    })

    for (const item of catalog.items) {
      it(set + ' ' + item.id + ': plays in the launcher as in the mod', () => {
        const file = JSON.parse(readFileSync(join(dir, item.model.replace(/^geometry\./, '') + '.json'), 'utf8'))
        const skeleton = EmoteSkeleton.of(file.geometry)
        expect(skeleton).not.toBeNull()

        const clips = readAnimations(file.animations)
        const loop = clips[item.animation]
        expect(loop).toBeDefined()
        expect(loop!.endless).toBe(true)
        const sequence = emoteSequence(clips, loop!)
        expect(sequence?.intro).toBeTruthy()
        expect(sequence!.intro!.name).toContain('.start')

        const mesh = readCosmeticMesh(file.geometry)!
        const names = new Set(mesh.bones.map((bone) => bone.name))
        for (const bone of mesh.bones) {
          if (bone.name in EMOTE_PARTS) expect(bone.quads.length).toBe(0)
        }
        for (const clip of Object.values(clips)) {
          for (const bone of Object.keys(clip.bones)) expect(names.has(bone)).toBe(true)
        }

        // The loop closes: its last frame is its first, up to whole turns.
        const raw = file.animations.animations[item.animation].bones as Record<string, Record<string, Record<string, number[]>>>
        for (const [bone, channels] of Object.entries(raw)) {
          for (const [channel, keys] of Object.entries(channels)) {
            const times = Object.keys(keys).sort((a, b) => Number(a) - Number(b))
            const first = keys[times[0]!]!
            const last = keys[times[times.length - 1]!]!
            for (let k = 0; k < 3; k++) {
              const gap = channel === 'rotation' ? Math.abs(((last[k]! - first[k]! + 540) % 360) - 180) : Math.abs(last[k]! - first[k]!)
              if (gap > 0.01) throw new Error(item.id + ' ' + bone + '.' + channel + '[' + k + '] does not close: ' + first[k] + ' → ' + last[k])
            }
          }
        }

        for (const clip of Object.values(clips)) {
          for (let t = 0; t <= clip.length + 1e-9; t += 0.05) {
            for (const part of Object.values(skeleton!.poseAt(clip, t))) {
              for (const v of [...part.shift, ...part.turn]) expect(Number.isFinite(v)).toBe(true)
            }
          }
          // The figure stays where it stands: nothing pins a drifting base.
          for (const key of clip.bones['base']?.position ?? []) {
            const [x, , z] = key.value as number[]
            expect(Math.abs(x!)).toBeLessThanOrEqual(3)
            expect(Math.abs(z!)).toBeLessThanOrEqual(3)
          }
        }
      })
    }
  }
})
