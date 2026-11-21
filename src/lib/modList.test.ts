import { expect, test } from 'bun:test'
import type { ModFile, Profile } from '../ipc/commands'
import { formatModList, prettyFile } from './modList'

const mod = (name: string, enabled: boolean, extra: Partial<ModFile> = {}): ModFile => ({ name, enabled, size: 1, scanned: true, ...extra })
const fabric: Profile = { name: 'Моя сборка', version: '1.21.1', fabric: true, loader: 'fabric', loader_version: '0.16.9' }

test('шапка, моды по алфавиту, выключенные отдельным блоком', () => {
  const text = formatModList(fabric, [
    mod('sodium-fabric-0.6.0.jar', true, { title: 'Sodium', version_number: 'mc1.21.1-0.6.0' }),
    mod('iris.jar', false, { title: 'Iris Shaders', version_number: '1.8.1' }),
    mod('fabric-api-0.100.jar', true, { title: 'Fabric API', version_number: '0.100.0+1.21.1' }),
    mod('dungeons-and-taverns-3.0.3.f.jar', true),
  ])
  expect(text).toBe(
    [
      'Minecraft 1.21.1 · Fabric 0.16.9 · 3 мода',
      '',
      'Dungeons and taverns',
      'Fabric API — 0.100.0+1.21.1',
      'Sodium — mc1.21.1-0.6.0',
      '',
      'Выключены:',
      'Iris Shaders — 1.8.1',
    ].join('\n'),
  )
})

test('ванила и сборка без модов', () => {
  expect(formatModList({ name: 'v', version: '1.8.9', fabric: false }, [])).toBe('Minecraft 1.8.9 · Ванилла · модов нет')
})

test('Forge, NeoForge и Quilt называются своим именем, без версии загрузчика — только имя', () => {
  for (const [loader, name] of [['forge', 'Forge'], ['neoforge', 'NeoForge'], ['quilt', 'Quilt']]) {
    const head = formatModList({ name: 'x', version: '1.20.1', fabric: false, loader }, [mod('a.jar', true, { title: 'A' })]).split('\n')[0]
    expect(head).toBe(`Minecraft 1.20.1 · ${name} · 1 мод`)
  }
})

test('в списке нет имён файлов, путей и ника', () => {
  const text = formatModList(fabric, [mod('C:\\Users\\Steve\\secret-1.0.jar', true, { title: 'Secret' })])
  expect(text).not.toContain('Steve')
  expect(text).not.toContain('.jar')
  expect(text).not.toContain('Моя сборка')
})

test('prettyFile', () => {
  expect(prettyFile('dungeons-and-taverns-3.0.3.f.jar')).toBe('Dungeons and taverns')
})
