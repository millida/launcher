import { describe, expect, test } from 'bun:test'
import { cfgEntries, cfgGet, cfgSet, checkValue } from './milliCfg'
import { chosenSteps, parseAction } from './milliActions'

describe('milliCfg: правка по месту', () => {
  test('options.txt: число в пределах, кавычки сохраняются, новый ключ дописывается', () => {
    const t = 'version:3465\nrenderDistance:12\nrenderClouds:"true"\nkey_key.attack:key.mouse.left\n'
    const r = cfgSet(t, 'txt-kv', 'renderDistance', '99', { type: 'int', min: 2, max: 32 })
    expect(r.ok && r.text).toContain('renderDistance:32')
    const c = cfgSet(t, 'txt-kv', 'renderClouds', 'false', { type: 'enum', values: ['true', 'fast', 'false'] })
    expect(c.ok && c.text).toContain('renderClouds:"false"')
    const n = cfgSet(t, 'txt-kv', 'gamma', '0.75', { type: 'float', min: 0, max: 1 }, true)
    expect(n.ok && n.text.endsWith('gamma:0.75\n')).toBe(true)
    expect(cfgGet(t, 'txt-kv', 'key_key.attack')).toBe('key.mouse.left')
  })
  test('TOML Forge: комментарии и раздел остаются, тип проверяется', () => {
    const t = '#Client settings\n[client]\n\t#Show overlay\n\toverlay = true # inline\n\tscale = 1.5\n\tname = "abc"\n[[rules]]\n\tx = 1\n'
    const r = cfgSet(t, 'toml', 'client.overlay', 'false')
    expect(r.ok && r.text).toContain('\toverlay = false # inline')
    expect(cfgSet(t, 'toml', 'client.overlay', 'abc').ok).toBe(false)
    expect(cfgSet(t, 'toml', 'client.name', 'z\nq').ok).toBe(false)
    expect(cfgEntries(t, 'toml').find((e) => e.path === 'client.overlay')?.hint).toBe('Show overlay')
    expect(cfgSet(t, 'toml', 'rules.x', '2').ok).toBe(false)
    const add = cfgSet(t, 'toml', 'client.newKey', '3', { type: 'int' }, true)
    expect(add.ok && add.text).toContain('\tnewKey = 3\n[[rules]]')
  })
  test('JSON5 с комментариями: меняется только значение', () => {
    const t = '{\n  // Jade\n  "general": { displayTooltip: true, /* x */ "scale": 1.0 },\n  list: [1, 2],\n}\n'
    const r = cfgSet(t, 'json5', 'general.displayTooltip', 'false')
    expect(r.ok && r.text).toBe(t.replace('displayTooltip: true', 'displayTooltip: false'))
    const f = cfgSet(t, 'json5', 'general.scale', '2')
    expect(f.ok && f.text).toContain('"scale": 2.0')
    expect(cfgSet(t, 'json5', 'general.nope', 'true').ok).toBe(false)
  })
  test('JSON: недостающий ключ создаётся только в чистом JSON', () => {
    const r = cfgSet('{\n  "a": {}\n}', 'json', 'a.b.c', 'true', { type: 'bool' }, true)
    expect(r.ok && JSON.parse(r.text)).toEqual({ a: { b: { c: true } } })
  })
  test('Xaero: поле внутри строки модуля', () => {
    const t = 'minimapSize:0\nmodule;id=xaerominimap:minimap;active=true;x=-11;fromRight=false;fromBottom=false\n'
    const r = cfgSet(t, 'txt-kv', 'module;id=xaerominimap:minimap;fromRight', 'true', { type: 'bool' })
    expect(r.ok && r.text).toContain(';fromRight=true;fromBottom=false')
  })
  test('старый .cfg, properties, yaml', () => {
    const cfg = 'general {\n    B:showHud=true\n    I:"max mobs"=70\n}\n'
    expect((cfgSet(cfg, 'cfg', 'general.B:showHud', 'false') as { text: string }).text).toContain('B:showHud=false')
    expect(cfgSet(cfg, 'cfg', 'general.I:max mobs', '5000').ok).toBe(false) // ×20 защита
    expect((cfgSet('# x\nenableShaders=false\n', 'properties', 'enableShaders', 'true') as { text: string }).text).toBe('# x\nenableShaders=true\n')
    expect((cfgSet('a:\n  b: 3 # c\n', 'yaml', 'a.b', '4') as { text: string }).text).toBe('a:\n  b: 4 # c\n')
  })
  test('checkValue: да/нет по-русски, перечисление', () => {
    expect(checkValue('вкл', 'false')).toEqual({ ok: true, v: 'true' })
    expect(checkValue('FAST', null, { type: 'enum', values: ['true', 'fast', 'false'] })).toEqual({ ok: true, v: 'fast' })
  })
})

describe('milliActions: разбор и выбор шагов', () => {
  test('битое действие отбрасывается, снятая галочка убирает шаги строки', () => {
    expect(parseAction({ id: 'x' })).toBeNull()
    const a = parseAction({ id: 'a', kind: 'graphics', title: 'Графика', rows: [{ id: 'r1', label: 'Дальность', steps: [0] }, { id: 'r2', label: 'FPS', optional: true, steps: [1, 9] }], steps: [{ op: 'opt', key: 'renderDistance', to: '8' }, { op: 'fpsboost', on: true }, { nope: 1 }] })!
    expect(a.steps.length).toBe(2)
    expect(a.rows[1].steps).toEqual([1])
    expect(chosenSteps(a, ['r2']).map((x) => x.step.op)).toEqual(['opt'])
  })
})
