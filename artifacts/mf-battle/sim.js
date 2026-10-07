// MF Battle — the world rules. Plain JavaScript with no DOM, shared by offline practice
// (runs in the browser) and the online room (runs on the bot's server in Node).
//
// A world holds owners (players and bots), their cells, food, thrown mass ("pellets"),
// viruses and golden +100 orbs. step(dt) moves everything forward; whatever happened
// (someone eaten, an orb taken…) is pushed to world.events for the caller to read.

export const WORLD = 16000;
export const START_MASS = 20;
export const REVENGE_MASS = 500;
export const MIN_SPLIT = 36;
export const MAX_CELLS = 16;
export const MAX_CELL_MASS = 23000; // one piece never grows past this; the rest is lost
export const BOT_MAX_MASS = 1500; // a bot bigger than this drops its mass on the ground
export const MERGE_SECONDS = 20; // split pieces join back together on their own after this
export const EAT_RATIO = 1.25;
export const THROW_SPEEDS = [1, 2, 5, 10, 20, 50];
export const MAP_SECTIONS = 4;
export const FOOD_COLORS = ['#ff3b6b', '#ff8a3d', '#ffc83d', '#a3ff3a', '#22e3ff', '#9b5cff', '#ff2bd6', '#4ade80', '#60a5fa'];
export const BOT_NAMES = ['SASUKE', 'KONAN', 'زيد', 'دندون', 'BROKEN', 'Cherry', 'Shadow', 'علي', 'مصطفى', 'Sniper', 'Ghost', 'Ninja', 'حيدر', 'MF_Fan', 'Lulu', 'Rambo', 'King', 'سجاد', 'Pro_IQ', 'Viper', 'أبو حسين', 'Zero', 'Joker', 'كرار', 'Storm', 'Toxic', 'Hunter', 'منتظر', 'Blaze', 'Ace'];
export const BOT_SKINS = ['classic', 'mf', 'ocean', 'lava', 'neon', 'toxic', 'tiger', 'snake', 'galaxy', 'ziggurat', 'skull', 'crown', 'dragon'];
export const VIRUS_MASS = 100;
export const PELLET_MASS = 13;

const EJECT_MIN = 35;
const PELLET_SPEED = 1700; // fades at 4/s, so a pellet flies about 425
const PELLET_LIFE = 45; // seconds a pellet stays on the ground
const MAX_PELLETS = 3000;
const VIRUS_FEED = 5; // pellets a virus takes before it shoots out a new virus
const ORB_MASS = 100;
const GRID = 300;

export const rad = (m) => Math.sqrt(m) * 10;
export const virusRadius = (fed = 0) => rad(VIRUS_MASS) * 0.9 * (1 + fed * 0.05);
export const pelletRadius = rad(PELLET_MASS) * 0.55;
/** Bigger throws (fast levels on big cells) look bigger too. */
export const pelletSize = (m) => Math.max(pelletRadius, rad(m) * 0.55);
/** Bigger is slower (agar-style curve on the radius), but never stuck. */
export const speedOf = (m) => Math.max(110, 2600 * Math.pow(rad(m), -0.439));
/** Throws per second for each throw-speed level (×1 … ×50): ×50 empties a normal cell in about a second. */
const THROW_RATES = [6, 9, 14, 23, 50, 100];
// Share of the cell each throw takes (at least one normal pellet). ×50 takes 5% a throw at 100
// throws a second, which empties any cell — even 23k — in about 1.3 seconds.
const THROW_SHARE = [0, 0, 0, 0.008, 0.02, 0.05];
export const throwRate = (level) => THROW_RATES[level] || THROW_RATES[0];
/** How far a split half flies: enough to catch someone in front, never across the map. */
export const splitFlight = (r) => Math.min(1300, 260 + r * 1.6);
export const sectionOf = (x, y) => {
  const n = WORLD / MAP_SECTIONS;
  const col = clamp(Math.floor(x / n), 0, MAP_SECTIONS - 1);
  const row = clamp(Math.floor(y / n), 0, MAP_SECTIONS - 1);
  return row * MAP_SECTIONS + col + 1;
};
export const foodRadius = (id) => 6 + (id % 4);
/** Where a thrown pellet is `age` seconds after it left (the same on server and phone). */
export function pelletAt(p, age) {
  const k = (1 - Math.exp(-4 * Math.min(age, 3))) / 4;
  return { x: clamp(p.x0 + p.vx * k, 10, WORLD - 10), y: clamp(p.y0 + p.vy * k, 10, WORLD - 10) };
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Food kept in a grid, so "what is near here" never scans the whole map. */
export class FoodGrid {
  constructor() { this.cells = new Map(); this.byId = new Map(); }
  key(x, y) { return Math.floor(x / GRID) * 4096 + Math.floor(y / GRID); }
  add(f) {
    const k = this.key(f.x, f.y);
    let list = this.cells.get(k);
    if (!list) { list = []; this.cells.set(k, list); }
    list.push(f);
    this.byId.set(f.id, f);
  }
  remove(id) {
    const f = this.byId.get(id);
    if (!f) return;
    this.byId.delete(id);
    const list = this.cells.get(this.key(f.x, f.y));
    if (!list) return;
    const i = list.indexOf(f);
    if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
  }
  clear() { this.cells.clear(); this.byId.clear(); }
  get size() { return this.byId.size; }
  /** Calls fn(food) for food inside the box (roughly; callers check the exact distance). */
  each(x0, y0, x1, y1, fn) {
    const gx0 = Math.floor(x0 / GRID), gx1 = Math.floor(x1 / GRID);
    const gy0 = Math.floor(y0 / GRID), gy1 = Math.floor(y1 / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const list = this.cells.get(gx * 4096 + gy);
        if (!list) continue;
        for (let i = list.length - 1; i >= 0; i--) fn(list[i]);
      }
    }
  }
}

/**
 * opts: bots (how many), food, viruses, orbs, trackNet (keep lists of food and pellets
 * added/removed, for the online room to send).
 */
export function createWorld(opts = {}) {
  const cfg = { bots: 30, food: 6000, viruses: 80, orbs: 90, trackNet: false, ...opts };
  let nextId = 1;
  const w = {
    time: 0,
    owners: [],
    cells: [], // every live cell, rebuilt each step
    foods: new FoodGrid(),
    pellets: [],
    viruses: [],
    orbs: [],
    events: [],
    foodAdded: [],
    foodRemoved: [],
    pelletAdded: [],
    pelletRemoved: [],
    timers: [],
  };

  // ───────────── Spawning ─────────────
  function addFood(x = rand(20, WORLD - 20), y = rand(20, WORLD - 20)) {
    const f = { id: nextId++, x, y, c: (Math.random() * FOOD_COLORS.length) | 0 };
    f.r = foodRadius(f.id);
    w.foods.add(f);
    if (cfg.trackNet) w.foodAdded.push(f);
  }
  function eatFood(f) {
    w.foods.remove(f.id);
    if (cfg.trackNet) w.foodRemoved.push(f.id);
  }

  function safeSpot(mass, near = null) {
    let best = null;
    for (let tries = 0; tries < 24; tries++) {
      const x = near ? clamp(near.x + rand(-900, 900), 200, WORLD - 200) : rand(200, WORLD - 200);
      const y = near ? clamp(near.y + rand(-900, 900), 200, WORLD - 200) : rand(200, WORLD - 200);
      let ok = true;
      for (const c of w.cells) if (c.m > mass && Math.hypot(c.x - x, c.y - y) < c.r + 420) { ok = false; break; }
      if (ok) for (const v of w.viruses) if (Math.hypot(v.x - x, v.y - y) < 260) { ok = false; break; }
      best = { x, y };
      if (ok) break;
    }
    return best;
  }

  function newCell(o, x, y, m) {
    const c = { id: nextId++, x, y, m, r: rad(m), bx: 0, by: 0, mergeAt: 0, owner: o };
    w.cells.push(c);
    return c;
  }

  function addVirus(x, y, vx = 0, vy = 0) {
    const s = x === undefined ? safeSpot(200) : { x, y };
    w.viruses.push({ id: nextId++, x: s.x, y: s.y, m: VIRUS_MASS, r: virusRadius(0), fed: 0, vx, vy });
  }
  function addOrb() {
    w.orbs.push({ id: nextId++, x: rand(150, WORLD - 150), y: rand(150, WORLD - 150), r: 26, m: ORB_MASS, ph: rand(0, 6.28) });
  }
  function later(seconds, fn) { w.timers.push({ at: w.time + seconds, fn }); }

  function addPellet(o, x, y, ux, uy, m = PELLET_MASS) {
    const p = { id: nextId++, x0: x, y0: y, x, y, vx: ux * PELLET_SPEED, vy: uy * PELLET_SPEED, m, r: pelletSize(m), hue: o.hue, born: w.time, owner: o };
    w.pellets.push(p);
    if (cfg.trackNet) w.pelletAdded.push(p);
  }
  function dropPellet(p) {
    if (p.m <= 0) return;
    p.m = 0;
    if (cfg.trackNet) w.pelletRemoved.push(p.id);
  }

  /** A player or bot. */
  w.addOwner = ({ name, skin = 'classic', bot = false, mass = START_MASS, near = null, hue, level } = {}) => {
    const o = {
      id: nextId++,
      ver: 1,
      bot,
      name: String(name || '').slice(0, 24) || 'لاعب',
      skin,
      level: Number.isFinite(level) ? level : bot ? 1 + ((Math.random() * 60) | 0) : 1,
      hue: Number.isFinite(hue) ? hue : (Math.random() * 360) | 0,
      cells: [],
      dead: true,
      respawnAt: 0,
      dir: { x: 0, y: 0, m: 0 },
      aim: null, // where throws go when it isn't the way you are heading (bots dropping mass)
      throwing: false,
      throwLevel: 0,
      throwT: 0,
      ai: { next: 0, aggr: rand(0.35, 1), greed: rand(0.5, 0.95), feeder: Math.random() < 0.4, wander: { x: rand(0, WORLD), y: rand(0, WORLD) } },
      stats: { maxMass: mass, eaten: 0, born: 0 },
      killer: null,
    };
    o.color = `hsl(${o.hue}, 85%, 58%)`;
    w.owners.push(o);
    w.respawn(o, mass, near);
    return o;
  };

  w.removeOwner = (o) => {
    const i = w.owners.indexOf(o);
    if (i >= 0) w.owners.splice(i, 1);
    o.dead = true;
    for (const c of o.cells) c.m = 0;
    o.cells = [];
    w.cells = w.cells.filter((c) => c.m > 0);
  };

  w.respawn = (o, mass = START_MASS, near = null) => {
    for (const c of o.cells) c.m = 0;
    w.cells = w.cells.filter((c) => c.m > 0);
    const s = safeSpot(mass, near);
    o.cells = [newCell(o, s.x, s.y, mass)];
    o.dead = false;
    o.killer = null;
    o.throwing = false;
    o.aim = null;
    o.dir = { x: 0, y: 0, m: 0 };
    o.stats = { maxMass: mass, eaten: 0, born: w.time };
  };

  w.centerOf = (o) => {
    let cx = 0, cy = 0, total = 0;
    for (const c of o.cells) { cx += c.x * c.m; cy += c.y * c.m; total += c.m; }
    return total ? { x: cx / total, y: cy / total, m: total } : { x: WORLD / 2, y: WORLD / 2, m: 0 };
  };
  w.massOf = (o) => { let m = 0; for (const c of o.cells) m += c.m; return m; };
  w.ranking = () => w.owners.filter((o) => !o.dead).map((o) => ({ o, m: w.massOf(o) })).sort((a, b) => b.m - a.m);

  function grow(c, amount) {
    c.m = Math.min(MAX_CELL_MASS, c.m + amount);
    c.r = rad(c.m);
  }

  // ───────────── Actions ─────────────
  /** Every piece big enough splits in two; the new half shoots forward to catch someone. */
  w.split = (o, dx, dy) => {
    if (o.dead) return false;
    const len = Math.hypot(dx, dy);
    const ux = len > 0.001 ? dx / len : 1;
    const uy = len > 0.001 ? dy / len : 0;
    const list = [...o.cells].sort((a, b) => b.m - a.m);
    let did = false;
    for (const c of list) {
      if (o.cells.length >= MAX_CELLS || c.m < MIN_SPLIT) continue;
      const half = c.m / 2;
      c.m = half;
      c.r = rad(half);
      c.mergeAt = w.time + MERGE_SECONDS;
      const piece = newCell(o, c.x + ux * c.r * 0.5, c.y + uy * c.r * 0.5, half);
      // The boost fades at 4/s, so this speed gives a flight of splitFlight().
      const v = 4 * splitFlight(piece.r);
      piece.bx = ux * v;
      piece.by = uy * v;
      piece.mergeAt = w.time + MERGE_SECONDS;
      o.cells.push(piece);
      did = true;
    }
    return did;
  };

  /** One throw from every piece that can afford it. */
  w.eject = (o, dx, dy, level = 0) => {
    const len = Math.hypot(dx, dy);
    const ux = len > 0.001 ? dx / len : 1;
    const uy = len > 0.001 ? dy / len : 0;
    for (const c of o.cells) {
      if (c.m < EJECT_MIN) continue;
      // A throw takes exactly what the pellet carries: no mass is lost.
      const m = Math.min(c.m - EJECT_MIN + PELLET_MASS, Math.max(PELLET_MASS, c.m * (THROW_SHARE[level] || 0)));
      c.m -= m;
      c.r = rad(c.m);
      const pr = pelletSize(m);
      addPellet(o, c.x + ux * (c.r + pr), c.y + uy * (c.r + pr), ux, uy, m);
    }
    let extra = w.pellets.length - MAX_PELLETS;
    for (let i = 0; extra > 0 && i < w.pellets.length; i++) if (w.pellets[i].m > 0) { dropPellet(w.pellets[i]); extra--; }
  };

  function popOnVirus(c) {
    const o = c.owner;
    const room = MAX_CELLS - o.cells.length;
    w.events.push({ type: 'pop', owner: o });
    if (room <= 0) return;
    // Straight to the most pieces you can have (16 in all), all the same size.
    const pieces = Math.min(room, Math.max(1, Math.floor(c.m / MIN_SPLIT) - 1));
    const each = c.m / (pieces + 1);
    c.m = each;
    c.r = rad(each);
    c.mergeAt = w.time + MERGE_SECONDS;
    for (let i = 0; i < pieces; i++) {
      const a = (i / pieces) * Math.PI * 2 + rand(-0.2, 0.2);
      const p = newCell(o, c.x, c.y, each);
      p.bx = Math.cos(a) * 1200;
      p.by = Math.sin(a) * 1200;
      p.mergeAt = c.mergeAt;
      o.cells.push(p);
    }
  }

  // ───────────── Bot brains ─────────────
  function thinkBot(o) {
    if (w.time < o.ai.next) return;
    o.ai.next = w.time + rand(0.1, 0.22);
    const cells = o.cells;
    if (!cells.length) return;
    let big = cells[0], small = cells[0];
    for (const c of cells) { if (c.m > big.m) big = c; if (c.m < small.m) small = c; }
    const { x: cx, y: cy, m: total } = w.centerOf(o);
    const view = 560 + Math.sqrt(total) * 22;
    o.throwing = false;
    o.aim = null;

    // Thrown mass is tempting. Whoever is throwing it looks friendly, so the bot walks
    // right up to them — that is the bait: throw, let it come close, then split on it.
    let bait = null, baitD = Infinity;
    for (const p of w.pellets) {
      if (p.owner === o || p.m <= 0) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < 620 + big.r && d < baitD) { baitD = d; bait = p; }
    }
    const feeder = bait ? bait.owner : null;

    // Threats: anyone who can eat my smallest piece and is close. Prey: someone I can eat.
    let fx = 0, fy = 0, danger = 0;
    let prey = null, preyScore = 0;
    for (const c of w.cells) {
      if (c.owner === o) continue;
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (d > view + c.r) continue;
      if (c.m > small.m * EAT_RATIO) {
        if (c.owner === feeder && d > c.r + small.r * 0.6) continue;
        // A split from a big cell reaches far, so keep extra distance from them.
        const reach = c.r + 220 + (c.m > small.m * EAT_RATIO * 2 ? splitFlight(rad(c.m / 2)) * 0.6 : 0);
        if (d < reach) {
          const k = (reach - d) / reach;
          fx -= ((c.x - cx) / (d || 1)) * k;
          fy -= ((c.y - cy) / (d || 1)) * k;
          danger = Math.max(danger, k);
        }
      } else if (big.m > c.m * EAT_RATIO * 1.05 && !(o.ai.feeder && !c.owner.bot)) {
        const score = (c.m / (d + 60)) * (c.owner.bot ? 1 : 1.3);
        if (score > preyScore) { preyScore = score; prey = c; }
      }
    }
    if (big.m > VIRUS_MASS * 1.4) {
      for (const v of w.viruses) {
        const d = Math.hypot(v.x - cx, v.y - cy);
        if (d < v.r + big.r + 60) { fx -= ((v.x - cx) / (d || 1)) * 0.6; fy -= ((v.y - cy) / (d || 1)) * 0.6; danger = Math.max(danger, 0.3); }
      }
    }
    const wall = 260;
    if (cx < wall) fx += (wall - cx) / wall;
    if (cy < wall) fy += (wall - cy) / wall;
    if (cx > WORLD - wall) fx -= (cx - (WORLD - wall)) / wall;
    if (cy > WORLD - wall) fy -= (cy - (WORLD - wall)) / wall;

    if (bait && danger < o.ai.greed) {
      o.dir = { x: bait.x - cx, y: bait.y - cy, m: 1 };
      return;
    }
    if (danger > 0.08 && (!prey || danger > o.ai.aggr * 0.55)) {
      o.dir = { x: fx, y: fy, m: 1 };
      if (danger > 0.85 && cells.length === 1 && big.m > 60 && Math.random() < 0.08 * o.ai.aggr) w.split(o, fx, fy);
      return;
    }
    // Too big: drop mass on the ground bit by bit, all around.
    if (total > BOT_MAX_MASS) {
      const a = w.time * 2.3 + o.id;
      o.aim = { x: Math.cos(a), y: Math.sin(a) };
      o.throwing = true;
      o.throwLevel = 1;
    }
    // Friendly bots feed a smaller player until the player is about their size.
    if (o.ai.feeder && total > 120) {
      let friend = null, fd = Infinity;
      for (const h of w.owners) {
        if (h.bot || h.dead) continue;
        const hc = w.centerOf(h);
        const d = Math.hypot(hc.x - cx, hc.y - cy);
        if (d < 1100 + big.r && d < fd && hc.m < total * 0.9) { fd = d; friend = hc; }
      }
      if (friend) {
        const dx = friend.x - cx, dy = friend.y - cy;
        const close = fd < big.r + 650;
        o.dir = { x: dx, y: dy, m: close ? 0.15 : 1 };
        if (close) { o.aim = { x: dx, y: dy }; o.throwing = true; o.throwLevel = 1; }
        return;
      }
    }
    if (prey) {
      const dx = prey.x - big.x;
      const dy = prey.y - big.y;
      const d = Math.hypot(dx, dy);
      o.dir = { x: dx, y: dy, m: 1 };
      // Split on it when the flying half would land on it.
      const flight = splitFlight(rad(big.m / 2));
      if (d < flight + big.r * 0.4 && big.m / 2 > prey.m * EAT_RATIO && big.m >= MIN_SPLIT && cells.length < 4 && Math.random() < 0.4 * o.ai.aggr) w.split(o, dx, dy);
      return;
    }
    // Nothing around: grab a +100 orb if one is near, else graze, else wander.
    let best = null, bestD = Infinity;
    for (const b of w.orbs) {
      const d = Math.hypot(b.x - cx, b.y - cy) * 0.5;
      if (d < 350 && d < bestD) { bestD = d; best = b; }
    }
    w.foods.each(cx - 420, cy - 420, cx + 420, cy + 420, (f) => {
      const d = Math.hypot(f.x - cx, f.y - cy);
      if (d < bestD) { bestD = d; best = f; }
    });
    if (best) { o.dir = { x: best.x - cx, y: best.y - cy, m: 1 }; return; }
    if (Math.hypot(o.ai.wander.x - cx, o.ai.wander.y - cy) < 200) o.ai.wander = { x: rand(200, WORLD - 200), y: rand(200, WORLD - 200) };
    o.dir = { x: o.ai.wander.x - cx, y: o.ai.wander.y - cy, m: 0.85 };
  }

  // ───────────── Movement and merging ─────────────
  function moveOwner(o, dt) {
    const { x: cx, y: cy } = w.centerOf(o);
    const dl = Math.hypot(o.dir.x, o.dir.y);
    const ux = dl > 0.001 ? o.dir.x / dl : 0;
    const uy = dl > 0.001 ? o.dir.y / dl : 0;
    const mag = clamp(o.dir.m, 0, 1);
    const many = o.cells.length > 1;
    const fade = Math.exp(-4 * dt);
    for (const c of o.cells) {
      // Every piece moves the same way you point, side by side, so pieces never block each other.
      const sp = speedOf(c.m) * mag;
      let vx = ux * sp;
      let vy = uy * sp;
      if (many) {
        // A gentle pull keeps the group together; once they may merge it gets strong.
        const dx = cx - c.x, dy = cy - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          // Before merging the pull is always weaker than the piece's own speed, so a piece
          // left far away never pins the rest of you in place.
          const base = speedOf(c.m);
          // After the merge time it is stronger, but still below the piece's speed, so the
          // group keeps going where you steer while the pieces close in and join.
          const pull = w.time >= c.mergeAt ? Math.min(base * 0.8, d * 1.2 + 40) : Math.min(base * 0.35, Math.max(0, d - c.r) * 0.25);
          vx += (dx / d) * pull;
          vy += (dy / d) * pull;
        }
      }
      c.x += (vx + c.bx) * dt;
      c.y += (vy + c.by) * dt;
      c.bx *= fade;
      c.by *= fade;
      c.x = clamp(c.x, c.r * 0.3, WORLD - c.r * 0.3);
      c.y = clamp(c.y, c.r * 0.3, WORLD - c.r * 0.3);
      if (c.m > 300) { c.m -= c.m * 0.0016 * dt; c.r = rad(c.m); }
    }
    // Own pieces slide apart softly until they may merge, then merge by themselves.
    for (let i = 0; i < o.cells.length; i++) {
      const a = o.cells[i];
      if (a.m <= 0) continue;
      for (let j = i + 1; j < o.cells.length; j++) {
        const b = o.cells[j];
        if (b.m <= 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const canMerge = w.time >= a.mergeAt && w.time >= b.mergeAt && a.m + b.m <= MAX_CELL_MASS;
        if (canMerge) {
          if (d < Math.max(a.r, b.r) * 0.85) {
            const keep = a.m >= b.m ? a : b;
            const gone = keep === a ? b : a;
            grow(keep, gone.m);
            gone.m = 0;
            if (gone === a) break;
          }
        } else {
          const overlap = a.r + b.r - d;
          if (overlap > 0) {
            const push = Math.min(overlap * 0.2, 180 * dt);
            const nx = dx / d;
            const ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
          }
        }
      }
    }
    if (o.cells.some((c) => c.m <= 0)) o.cells = o.cells.filter((c) => c.m > 0);
  }

  // ───────────── One step ─────────────
  w.step = (dt) => {
    w.time += dt;
    for (let i = w.timers.length - 1; i >= 0; i--) {
      if (w.time >= w.timers[i].at) { const t = w.timers[i]; w.timers.splice(i, 1); t.fn(); }
    }
    for (const o of w.owners) {
      if (o.dead) {
        if (o.bot && w.time >= o.respawnAt) {
          o.name = pick(BOT_NAMES);
          o.skin = pick(BOT_SKINS);
          o.level = 1 + ((Math.random() * 60) | 0);
          o.ver++;
          w.respawn(o, rand(20, 140));
        }
        continue;
      }
      if (o.bot) thinkBot(o);
    }

    for (const o of w.owners) {
      if (o.dead) continue;
      moveOwner(o, dt);
      // Holding "throw" keeps throwing: ×1 is about 6 a second, ×50 is 50 a second.
      if (o.throwing) {
        o.throwT -= dt;
        let n = 0;
        while (o.throwT <= 0 && n < 4) {
          const a = o.aim || o.dir;
          w.eject(o, a.x || o.lastX || 1, a.y || o.lastY || 0, o.throwLevel);
          o.throwT += 1 / throwRate(o.throwLevel);
          n++;
        }
        if (o.throwT < -0.1) o.throwT = 0;
      } else if (o.throwT < 0) {
        o.throwT = 0;
      }
      if (o.dir.x || o.dir.y) { o.lastX = o.dir.x; o.lastY = o.dir.y; }
    }

    // Pellets fly on a fixed curve (the phones draw the same curve), then lie still.
    for (const p of w.pellets) {
      if (p.m <= 0) continue;
      const age = w.time - p.born;
      if (age > PELLET_LIFE) { dropPellet(p); continue; }
      if (age < 3) { const at = pelletAt(p, age); p.x = at.x; p.y = at.y; }
    }
    // Viruses: a shot virus slides to a stop; one fed 5 pellets shoots out a new virus.
    const vfade = Math.exp(-3 * dt);
    for (const v of w.viruses) {
      if (v.vx || v.vy) {
        v.x = clamp(v.x + v.vx * dt, 60, WORLD - 60);
        v.y = clamp(v.y + v.vy * dt, 60, WORLD - 60);
        v.vx *= vfade;
        v.vy *= vfade;
        if (Math.abs(v.vx) + Math.abs(v.vy) < 5) { v.vx = 0; v.vy = 0; }
      }
    }

    // Eating. Cells are swept left to right, so only neighbours are compared.
    const all = w.cells = [];
    for (const o of w.owners) if (!o.dead) for (const c of o.cells) all.push(c);
    const pelletGrid = new Map();
    for (const p of w.pellets) {
      if (p.m <= 0) continue;
      const k = Math.floor(p.x / GRID) * 4096 + Math.floor(p.y / GRID);
      let list = pelletGrid.get(k);
      if (!list) { list = []; pelletGrid.set(k, list); }
      list.push(p);
    }
    const nearPellets = (x, y, r, fn) => {
      const gx0 = Math.floor((x - r) / GRID), gx1 = Math.floor((x + r) / GRID);
      const gy0 = Math.floor((y - r) / GRID), gy1 = Math.floor((y + r) / GRID);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const list = pelletGrid.get(gx * 4096 + gy);
          if (list) for (const p of list) if (p.m > 0) fn(p);
        }
      }
    };
    // Pellets into viruses.
    const newViruses = [];
    for (const v of w.viruses) {
      nearPellets(v.x, v.y, v.r, (p) => {
        if (Math.hypot(p.x - v.x, p.y - v.y) > v.r) return;
        dropPellet(p);
        v.fed++;
        v.r = virusRadius(v.fed);
        if (v.fed >= VIRUS_FEED) {
          v.fed = 0;
          v.r = virusRadius(0);
          if (w.viruses.length + newViruses.length < cfg.viruses * 1.6) {
            const len = Math.hypot(p.vx, p.vy) || 1;
            newViruses.push([v.x, v.y, (p.vx / len) * 2400, (p.vy / len) * 2400]);
          }
        }
      });
    }
    for (const nv of newViruses) addVirus(...nv);

    for (const c of all) {
      if (c.m <= 0) continue;
      let gain = 0;
      w.foods.each(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r, (f) => {
        if (Math.hypot(f.x - c.x, f.y - c.y) < c.r) { eatFood(f); gain += 1; }
      });
      nearPellets(c.x, c.y, c.r, (p) => {
        if (p.owner === c.owner && w.time - p.born < 0.4) return;
        if (c.m > p.m && Math.hypot(p.x - c.x, p.y - c.y) < c.r - p.r * 0.3) { gain += p.m; dropPellet(p); }
      });
      for (const b of w.orbs) {
        if (b.m <= 0) continue;
        if (Math.hypot(b.x - c.x, b.y - c.y) < c.r + b.r * 0.4) {
          gain += b.m;
          b.m = 0;
          w.events.push({ type: 'orb', owner: c.owner });
        }
      }
      if (gain) grow(c, gain);
      for (const v of w.viruses) {
        if (v.m <= 0) continue;
        if (c.m > v.m * 1.33 && Math.hypot(v.x - c.x, v.y - c.y) < c.r - v.r * 0.4) {
          grow(c, v.m);
          v.m = 0;
          popOnVirus(c);
        }
      }
    }
    all.sort((a, b) => (a.x - a.r) - (b.x - b.r));
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.x - b.r > a.x + a.r) break;
        if (a.m <= 0) break;
        if (b.m <= 0 || a.owner === b.owner) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (a.m >= b.m * EAT_RATIO && d < a.r - b.r * 0.35) {
          grow(a, b.m); b.lost = b.m; b.m = 0; b.eatenBy = a.owner;
        } else if (b.m >= a.m * EAT_RATIO && d < b.r - a.r * 0.35) {
          grow(b, a.m); a.lost = a.m; a.m = 0; a.eatenBy = b.owner;
        }
      }
    }
    for (const o of w.owners) {
      if (o.dead) continue;
      const before = o.cells;
      if (before.some((c) => c.m <= 0)) o.cells = before.filter((c) => c.m > 0);
      if (!o.cells.length) {
        const killer = before.find((c) => c.eatenBy)?.eatenBy || null;
        const mass = before.reduce((s, c) => s + (c.lost || 0), 0);
        o.dead = true;
        o.killer = killer;
        o.throwing = false;
        if (o.bot) o.respawnAt = w.time + rand(2.5, 5);
        if (killer) killer.stats.eaten++;
        w.events.push({ type: 'kill', victim: o, killer, mass });
      } else {
        const m = w.massOf(o);
        if (m > o.stats.maxMass) o.stats.maxMass = m;
      }
    }
    w.cells = all.filter((c) => c.m > 0);
    if (w.pellets.some((p) => p.m <= 0)) w.pellets = w.pellets.filter((p) => p.m > 0);
    for (let i = w.viruses.length - 1; i >= 0; i--) {
      if (w.viruses[i].m > 0) continue;
      w.viruses.splice(i, 1);
      if (w.viruses.length < cfg.viruses) later(6, () => addVirus());
    }
    for (let i = w.orbs.length - 1; i >= 0; i--) if (w.orbs[i].m <= 0) { w.orbs.splice(i, 1); later(4, addOrb); }
    const missing = cfg.food - w.foods.size;
    for (let i = 0; i < missing; i++) if (Math.random() < 0.35) addFood();
  };

  // ───────────── Start ─────────────
  for (let i = 0; i < cfg.food; i++) addFood();
  for (let i = 0; i < cfg.viruses; i++) addVirus();
  for (let i = 0; i < cfg.orbs; i++) addOrb();
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < cfg.bots; i++) {
    // A mix of sizes, so there is always someone to chase and someone to run from.
    const mass = i < 5 ? rand(800, BOT_MAX_MASS) : i < 14 ? rand(150, 520) : rand(20, 90);
    w.addOwner({ name: names[i % names.length], skin: pick(BOT_SKINS), bot: true, mass });
  }
  w.foodAdded.length = 0;
  return w;
}
