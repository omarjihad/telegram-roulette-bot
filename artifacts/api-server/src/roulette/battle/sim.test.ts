import { describe, expect, it } from 'vitest';
import { createWorld, MAX_CELL_MASS, MERGE_SECONDS, rad } from '../../../../mf-battle/sim.js';
import type { SimOwner, SimWorld } from '../../../../mf-battle/sim.js';

// The game's rules (the same file runs the online rooms and the phones' practice).
const run = (w: SimWorld, seconds: number) => { for (let t = 0; t < seconds; t += 0.025) w.step(0.025); };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function twoPieces(w: SimWorld, o: SimOwner, mass: number, apart: number) {
  o.cells[0].x = 5000;
  o.cells[0].y = 5000;
  w.split(o, 1, 0);
  const [a, b] = o.cells;
  for (const c of [a, b]) { c.m = mass; c.r = rad(mass); c.bx = 0; c.by = 0; }
  b.x = 5000 + apart;
  b.y = 5000;
  return [a, b];
}

describe('MF Battle rules', () => {
  it('own pieces never stay inside each other before the merge time: they slide apart to a small gap', () => {
    const w = createWorld({ bots: 0, food: 0, viruses: 0, orbs: 0 });
    const o = w.addOwner({ name: 'me', mass: 4000 });
    const [a, b] = twoPieces(w, o, 2000, 300); // deep inside each other
    run(w, 2);
    const gap = dist(a, b) - a.r - b.r;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(80);
  });

  it('a piece far away comes back near the others (but not into them)', () => {
    const w = createWorld({ bots: 0, food: 0, viruses: 0, orbs: 0 });
    const o = w.addOwner({ name: 'me', mass: 4000 });
    const [a, b] = twoPieces(w, o, 2000, 2500);
    run(w, 16);
    const gap = dist(a, b) - a.r - b.r;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(300);
  });

  it('pieces merge at the merge time, even past the biggest size (the extra is lost)', () => {
    const w = createWorld({ bots: 0, food: 0, viruses: 0, orbs: 0 });
    const o = w.addOwner({ name: 'me', mass: 30000 });
    twoPieces(w, o, 15000, rad(15000) * 2.2);
    run(w, MERGE_SECONDS + 15);
    expect(o.cells).toHaveLength(1);
    expect(o.cells[0].m).toBeLessThanOrEqual(MAX_CELL_MASS);
    expect(o.cells[0].m).toBeGreaterThan(MAX_CELL_MASS * 0.95);
  });

  it('a big burst into a virus shoots one new virus, and the virus keeps all the thrown mass', () => {
    const w = createWorld({ bots: 0, food: 0, viruses: 1, orbs: 0 });
    const v = w.viruses[0];
    v.x = 8000;
    v.y = 8000;
    const o = w.addOwner({ name: 'me', mass: 23000 });
    const c = o.cells[0];
    c.x = v.x - c.r - v.r - 120;
    c.y = v.y;
    for (let i = 0; i < 25; i++) { w.eject(o, 1, 0, 5); w.step(0.01); }
    run(w, 2);
    const thrown = 23000 - w.massOf(o);
    expect(w.viruses).toHaveLength(2);
    expect(v.loot).toBeGreaterThan(thrown * 0.98);
  });

  it('hitting a virus always bursts you into 16 pieces, even small, with the loot it holds', () => {
    const w = createWorld({ bots: 0, food: 0, viruses: 1, orbs: 0 });
    const v = w.viruses[0];
    v.loot = 10000;
    const o = w.addOwner({ name: 'me', mass: 200 });
    o.cells[0].x = v.x;
    o.cells[0].y = v.y;
    w.step(0.025);
    expect(o.cells).toHaveLength(16);
    expect(w.massOf(o)).toBeCloseTo(200 + 100 + 10000, 0);
  });
});
