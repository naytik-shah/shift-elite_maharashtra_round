import test from 'node:test';
import assert from 'node:assert/strict';
import { rankEntries, buildManifest } from '../src/services/drawAlgo.js';
import { sha256 } from '../src/lib/hash.js';

const mk = (n, weight = 1) => Array.from({ length: n }, (_, i) => ({ entryId: `e${String(i).padStart(5, '0')}`, weight }));

test('same seed and entries give the same ranking', () => {
  const a = rankEntries('seed-1', mk(500));
  const b = rankEntries('seed-1', mk(500));
  assert.deepEqual(a, b);
});

test('input order does not change the ranking', () => {
  const entries = mk(300);
  const shuffled = [...entries].reverse();
  assert.deepEqual(rankEntries('s', entries), rankEntries('s', shuffled));
});

test('different seed gives a different ranking', () => {
  assert.notDeepEqual(rankEntries('seed-a', mk(200)), rankEntries('seed-b', mk(200)));
});

test('ranking contains every entry exactly once', () => {
  const r = rankEntries('s', mk(1000));
  assert.equal(r.length, 1000);
  assert.equal(new Set(r).size, 1000);
});

test('equal weights give every entry a fair chance', () => {
  // first 10 of 100 over many seeds: each entry should win about 10% of the time
  const wins = new Map();
  const entries = mk(100);
  const runs = 2000;
  for (let i = 0; i < runs; i++) for (const id of rankEntries(`fair-${i}`, entries).slice(0, 10)) wins.set(id, (wins.get(id) || 0) + 1);
  for (const id of entries.map((e) => e.entryId)) {
    const rate = (wins.get(id) || 0) / runs;
    assert.ok(rate > 0.06 && rate < 0.14, `${id} won ${rate}`);
  }
});

test('low weight entries win much less often', () => {
  const entries = [...mk(900), ...Array.from({ length: 100 }, (_, i) => ({ entryId: `bot${String(i).padStart(3, '0')}`, weight: 0.05 }))];
  let botWins = 0;
  let total = 0;
  for (let i = 0; i < 300; i++) {
    for (const id of rankEntries(`w-${i}`, entries).slice(0, 50)) { total++; if (id.startsWith('bot')) botWins++; }
  }
  const share = botWins / total;
  // bots hold 10% of entries but only about 0.5% of the total weight
  assert.ok(share < 0.02, `bot share of winners was ${share}`);
});

test('a heavier weight never hurts an entry', () => {
  const base = mk(200);
  const heavier = base.map((e) => (e.entryId === 'e00007' ? { ...e, weight: 1 } : { ...e, weight: 0.5 }));
  const rankLight = rankEntries('x', base.map((e) => ({ ...e, weight: 0.5 }))).indexOf('e00007');
  const rankHeavy = rankEntries('x', heavier).indexOf('e00007');
  assert.ok(rankHeavy <= rankLight);
});

test('manifest converts string weights to numbers and sorts by id', () => {
  const m = buildManifest([{ id: 'b', weight: '0.5000' }, { id: 'a', weight: '1.00' }]);
  assert.deepEqual(m.entries, [{ entryId: 'a', weight: 1 }, { entryId: 'b', weight: 0.5 }]);
  assert.equal(m.hash, sha256(JSON.stringify(m.entries)));
});

test('manifest hash does not depend on row order', () => {
  const rows = [{ id: 'c', weight: '1' }, { id: 'a', weight: '0.2' }, { id: 'b', weight: '1' }];
  assert.equal(buildManifest(rows).hash, buildManifest([...rows].reverse()).hash);
});

test('manifest hash changes when a weight changes', () => {
  const a = buildManifest([{ id: 'a', weight: '1' }]);
  const b = buildManifest([{ id: 'a', weight: '0.5' }]);
  assert.notEqual(a.hash, b.hash);
});
