import { describe, expect, it } from 'bun:test';
import {
  RECS_WEIGHTS,
  affinityOf,
  emptyLog,
  exposureOf,
  logClick,
  logSeen,
  mixFeed,
  parseLog,
  recentKeys,
  variantOf,
  type FeedItem,
} from './recsMix';

const item = (section: string, i: number, ok = true): FeedItem<null> => ({ key: `${section}/${section}-${i}`, section, ok, data: null });
const sections = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => [s, Array.from({ length: 20 }, (_, i) => item(s, i))]));
const base = { sections, personal: [] as FeedItem<null>[], n: 16, weights: RECS_WEIGHTS.a };

describe('mixFeed', () => {
  it('детерминирован по зерну и меняется от зерна', () => {
    const a = mixFeed({ ...base, seed: 'u:1:a' }).map((p) => p.item.key);
    expect(mixFeed({ ...base, seed: 'u:1:a' }).map((p) => p.item.key)).toEqual(a);
    expect(mixFeed({ ...base, seed: 'u:2:a' }).map((p) => p.item.key)).not.toEqual(a);
  });

  it('не больше двух одного раздела подряд, даже когда интерес к одному разделу огромный', () => {
    for (let d = 0; d < 30; d += 1) {
      const out = mixFeed({ ...base, seed: `s${d}`, affinity: { a: 50 }, weights: RECS_WEIGHTS.b });
      for (let i = 2; i < out.length; i += 1)
        expect(out[i]!.item.section === out[i - 1]!.item.section && out[i]!.item.section === out[i - 2]!.item.section).toBe(false);
    }
  });

  it('доля исследования близка к весу группы', () => {
    let explore = 0;
    let total = 0;
    for (let d = 0; d < 200; d += 1) {
      const out = mixFeed({ ...base, seed: `e${d}` });
      explore += out.filter((p) => p.why === 'explore').length;
      total += out.length;
    }
    expect(explore / total).toBeGreaterThan(0.22);
    expect(explore / total).toBeLessThan(0.38);
  });

  it('исследование идёт в недосмотренные разделы', () => {
    const out = mixFeed({ ...base, n: 60, seed: 'x', affinity: { a: 5, b: 5, c: 5 }, exposure: { a: 40, b: 40, c: 40 } });
    const ex = out.filter((p) => p.why === 'explore').map((p) => p.item.section);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((s) => ['d', 'e', 'f'].includes(s))).toBe(true);
  });

  it('личное идёт первой очередью, недавнее и ниже порога — нет', () => {
    const personal = [item('a', 100), item('b', 100), item('c', 100, false)];
    const out = mixFeed({ ...base, seed: 'p', personal, weights: { ...RECS_WEIGHTS.a, explore: 0, personal: 1 }, recent: new Set(['a/a-0', 'b/b-0']) });
    const keys = out.map((p) => p.item.key);
    expect(keys.slice(0, 2).sort()).toEqual(['a/a-100', 'b/b-100']);
    expect(keys).not.toContain('c/c-100');
    expect(keys).not.toContain('a/a-0');
  });

  it('недавнее возвращается только когда свежее кончилось', () => {
    const small = { a: [item('a', 1), item('a', 2)], b: [item('b', 1), item('b', 2)] };
    const out = mixFeed({ ...base, sections: small, n: 4, seed: 'r', recent: new Set(['a/a-1']) });
    expect(out.map((p) => p.item.key)).toHaveLength(4);
    const keys = out.map((p) => p.item.key);
    expect(keys.indexOf('a/a-1')).toBeGreaterThan(keys.indexOf('a/a-2'));
  });

  it('уже стоящее на странице не повторяется', () => {
    const out = mixFeed({ ...base, seed: 't', taken: new Set(['a/a-0', 'b/b-0']) });
    expect(out.some((p) => p.item.key === 'a/a-0' || p.item.key === 'b/b-0')).toBe(false);
    expect(new Set(out.map((p) => p.item.key)).size).toBe(out.length);
  });
});

describe('A/B и журнал', () => {
  it('группа стабильна и делит примерно пополам', () => {
    expect(variantOf('abc')).toBe(variantOf('abc'));
    const n = Array.from({ length: 2000 }, (_, i) => variantOf(`user${i}`)).filter((v) => v === 'a').length;
    expect(n).toBeGreaterThan(900);
    expect(n).toBeLessThan(1100);
  });

  it('показанное сегодня не прячется до завтра, потом уходит на три дня; нажатое — на две недели', () => {
    let log = logSeen(emptyLog(), ['mods/x'], 100);
    log = logClick(log, 'maps/y', 100);
    expect(recentKeys(log, 100).has('mods/x')).toBe(false);
    expect(recentKeys(log, 101).has('mods/x')).toBe(true);
    expect(recentKeys(log, 103).has('mods/x')).toBe(false);
    expect(recentKeys(log, 113).has('maps/y')).toBe(true);
    expect(recentKeys(log, 114).has('maps/y')).toBe(false);
    expect(parseLog(JSON.stringify(log))).toEqual(log);
    expect(parseLog('{')).toEqual(emptyLog());
    expect(exposureOf(log, 101)).toEqual({ mods: 1 });
  });

  it('интерес: установка сильнее лайка, лайк сильнее захода', () => {
    const a = affinityOf({ visits: { mods: 1 }, likes: ['maps'], installs: { shaders: 1 } });
    expect(a.shaders!).toBeGreaterThan(a.maps!);
    expect(a.maps!).toBeGreaterThan(a.mods!);
    expect(affinityOf({})).toEqual({});
  });
});
