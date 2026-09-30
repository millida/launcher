import { describe, expect, it } from 'bun:test'
import { cfSourceRef } from './site'

describe('cfSourceRef', () => {
  const cases: { why: string; url: string; want: ReturnType<typeof cfSourceRef> }[] = [
    {
      why: 'a CurseForge modpack from the catalog must install in the launcher instead of bouncing to the site',
      url: 'https://www.curseforge.com/minecraft/modpacks/ciscos-adventure-rpg-ultimate',
      want: { classId: 4471, slug: 'ciscos-adventure-rpg-ultimate' },
    },
    {
      why: 'mods, packs and maps carry their own CurseForge class, a wrong class finds nothing',
      url: 'https://www.curseforge.com/minecraft/mc-mods/reactive-music',
      want: { classId: 6, slug: 'reactive-music' },
    },
    {
      why: 'a trailing path or query is not part of the slug',
      url: 'https://www.curseforge.com/minecraft/texture-packs/faithful-32x/files?page=2',
      want: { classId: 12, slug: 'faithful-32x' },
    },
    { why: 'maps are a class of their own', url: 'https://www.curseforge.com/minecraft/worlds/skyblock', want: { classId: 17, slug: 'skyblock' } },
    {
      why: 'a class the launcher cannot install stays on the site',
      url: 'https://www.curseforge.com/minecraft/bukkit-plugins/essentials',
      want: null,
    },
    { why: 'a Modrinth link is handled by the Modrinth path', url: 'https://modrinth.com/modpack/fps', want: null },
    { why: 'an item without a source has nothing to resolve', url: '', want: null },
  ]

  for (const c of cases) {
    it(c.why, () => {
      expect(cfSourceRef(c.url), `${c.url} resolved wrong: ${c.why}`).toEqual(c.want)
    })
  }
})
