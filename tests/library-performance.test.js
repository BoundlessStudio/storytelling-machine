import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialRenderQuality, RenderBudget, SpatialGrid } from '../static/library-performance.js';

test('quality follows capability hints and GPU limits, with safe defaults for absent hints', () => {
  assert.equal(initialRenderQuality(), 'full');
  assert.equal(initialRenderQuality({ coarsePointer: true }), 'balanced');
  assert.equal(initialRenderQuality({ memory: 2, cores: 8, maxTextureSize: 16384 }), 'economy');
  assert.equal(initialRenderQuality({ memory: 8, cores: 2 }), 'economy');
  assert.equal(initialRenderQuality({ memory: 8, cores: 8, maxTextureSize: 2048 }), 'economy');
  assert.equal(initialRenderQuality({ maxTextureSize: 4096 }), 'balanced');
  assert.equal(initialRenderQuality({ floatTargets: false }), 'economy');
  assert.equal(initialRenderQuality({ memory: 0, cores: undefined }), 'full');
});

test('normal capped animation and one delayed frame do not reduce quality', () => {
  const budget = new RenderBudget('full');
  let now = 0;
  for (let i = 0; i < 400; i++) {
    const frame = i === 40 ? 600 : 1000 / 30;
    now += frame;
    assert.equal(budget.observe(now, frame, i === 40 ? 80 : 8), false);
  }
  assert.equal(budget.quality, 'full');
});

test('sustained slow frame delivery reduces GPU cost one step at a time', () => {
  const budget = new RenderBudget('full');
  let changes = 0;
  for (let now = 80; now < 9000; now += 80) if (budget.observe(now, 80, 8)) changes++;
  assert.equal(changes, 2);
  assert.equal(budget.quality, 'economy');
  assert.equal(budget.profile.shadowSize, 0);
  assert.equal(budget.lower(), false);
});

test('expensive CPU frames reduce quality even when frame delivery appears regular', () => {
  const budget = new RenderBudget('balanced');
  for (let now = 34; now < 3400; now += 34) budget.observe(now, 34, 29);
  assert.equal(budget.quality, 'economy');
});

test('resetting measurements prevents pause and resume from carrying a stale overload', () => {
  const budget = new RenderBudget('full');
  for (let now = 80; now < 2400; now += 80) budget.observe(now, 80, 30);
  budget.reset();
  for (let now = 10000; now < 15000; now += 34) budget.observe(now, 34, 5);
  assert.equal(budget.quality, 'full');
});

test('spatial queries cover negative coordinates, cell edges, and moving members', () => {
  const grid = new SpatialGrid(1.5);
  const members = [{ position: { x: -.01, y: -1.5, z: 0 } }, { position: { x: .01, y: -1.49, z: 0 } }, { position: { x: 8, y: 8, z: 8 } }];
  grid.rebuild(members);
  assert.deepEqual([...grid.query(members[0].position, .05)].sort(), [0, 1]);
  members[1].position = { x: -4, y: 0, z: -2 };
  grid.rebuild(members);
  assert.deepEqual([...grid.query(members[0].position, .05)], [0]);
  assert.deepEqual([...grid.query(members[1].position, .05)], [1]);
});

test('broad phase includes every actual neighbor and book collision in a full library', () => {
  let seed = 42;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const members = Array.from({ length: 230 }, () => ({ position: { x: random() * 14 - 7, y: random() * 8 - 2, z: random() * 12 - 6 }, radius: .3 + random() * .4 }));
  // Include a larger book flying from the desk.
  members.push({ position: { x: 0, y: 3, z: 2 }, radius: 2.2 });
  const maximum = Math.max(...members.map(m => m.radius));
  const grid = new SpatialGrid(); grid.rebuild(members);
  for (let i = 0; i < members.length; i++) {
    const a = members[i];
    const candidates = [...grid.query(a.position, Math.max(Math.sqrt(1.6), a.radius + maximum + .035))];
    assert.equal(candidates.length, new Set(candidates).size);
    for (let j = 0; j < members.length; j++) {
      const b = members[j];
      const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
      if (distance <= Math.max(Math.sqrt(1.6), a.radius + b.radius + .035)) assert.ok(candidates.includes(j), `Missing pair ${i}, ${j}`);
    }
  }
});
