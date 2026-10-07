// MF Battle — the arena. Offline practice against bots: eat food and smaller players,
// split, throw mass, and stay away from bigger players and viruses.
// Everything happens in "stage" coordinates (the landscape screen), drawn on one canvas.

import { skinSVG } from './skins.js';
import { CONTROLS, byId, fullLayout, controlHTML } from './controls.js';
import { sfx } from './sound.js';

const WORLD = 4200;
const START_MASS = 20;
const MIN_SPLIT = 36;
const MAX_CELLS = 16;
const EJECT_COST = 16;
const EJECT_MASS = 13;
const VIRUS_MASS = 100;
const VIRUS_COUNT = 11;
const BOT_COUNT = 14;
const EAT_RATIO = 1.25;
const THROW_EVERY = 0.14; // seconds between throws while held; ×2 halves it

const BOT_NAMES = ['SASUKE', 'KONAN', 'زيد', 'دندون', 'BROKEN', 'Cherry', 'Shadow', 'علي', 'مصطفى', 'Sniper', 'Ghost', 'Ninja', 'حيدر', 'MF_Fan', 'Lulu', 'Rambo', 'King', 'سجاد', 'Pro_IQ', 'Viper'];
const BOT_SKINS = ['classic', 'mf', 'ocean', 'lava', 'neon', 'toxic', 'tiger', 'snake', 'galaxy', 'ziggurat', 'skull', 'crown', 'dragon'];
const FOOD_COLORS = ['#ff3b6b', '#ff8a3d', '#ffc83d', '#a3ff3a', '#22e3ff', '#9b5cff', '#ff2bd6', '#4ade80', '#60a5fa'];
const BOT_TAUNTS = ['هههه 😂', 'تعال تعال', 'GG', 'منو بعد؟ 😎', 'ركض ركض 🏃', 'اكلتك 🍽️', 'لا تزعل 😅', 'جيبوا غيره'];

const rad = (m) => Math.sqrt(m) * 10;
const speedOf = (m) => 900 * Math.pow(m, -0.42);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Skins as images for the canvas, made once per skin. */
const skinImages = {};
function skinImage(id) {
  if (!skinImages[id]) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(skinSVG(id, 256))}`;
    skinImages[id] = img;
  }
  return skinImages[id];
}

export function startGame(opts) {
  const { stage, player, profile, toStage, getSize, onExit, haptic } = opts;
  const settings = { darkMode: true, chat: true, quality: 'medium', joystick: 'fixed', ...(profile.settings || {}) };
  const layout = fullLayout(profile.layout || {});

  // ───────────── DOM ─────────────
  const root = document.createElement('div');
  root.className = `game ${settings.darkMode ? 'dark' : 'light'}`;
  root.innerHTML = '<canvas class="game-canvas"></canvas><div class="g-hud"></div>';
  stage.appendChild(root);
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const hud = root.querySelector('.g-hud');

  const ctl = {};
  for (const c of CONTROLS) {
    const el = document.createElement('div');
    el.className = `g-ctl ${c.shape}`;
    el.dataset.id = c.id;
    if (c.id === 'double') el.innerHTML = '<span class="ctl-label">2x</span><small>سرعة الرمي</small>';
    else if (c.id === 'mass') el.innerHTML = '<span class="ctl-label" data-mass>الكتلة: 20</span>';
    else if (c.id === 'leaderboard') el.innerHTML = '<div class="g-lb"><b>المتصدرين</b><ol data-lb></ol></div>';
    else if (c.id === 'minimap') el.innerHTML = '<canvas class="g-map"></canvas>';
    else if (c.id === 'chat') el.innerHTML = '<div class="g-chat" data-chat></div>';
    else if (c.id === 'zoom') el.innerHTML = '<button class="g-zbtn" data-z="1">+</button><button class="g-zbtn" data-z="-1">−</button>';
    else el.innerHTML = controlHTML(c);
    hud.appendChild(el);
    ctl[c.id] = el;
  }
  if (!settings.chat) ctl.chat.hidden = true;
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'g-pause';
  pauseBtn.textContent = '❚❚';
  pauseBtn.setAttribute('aria-label', 'إيقاف مؤقت');
  hud.appendChild(pauseBtn);
  const overlay = document.createElement('div');
  overlay.className = 'g-overlay';
  overlay.hidden = true;
  root.appendChild(overlay);

  const massEl = ctl.mass.querySelector('[data-mass]');
  const lbEl = ctl.leaderboard.querySelector('[data-lb]');
  const chatEl = ctl.chat.querySelector('[data-chat]');
  const mapCanvas = ctl.minimap.querySelector('canvas');
  const knob = ctl.joystick.querySelector('.ctl-joy-knob');

  let SW = 0;
  let SH = 0;
  let dpr = 1;
  function placeControls() {
    for (const c of CONTROLS) {
      const p = layout[c.id];
      const el = ctl[c.id];
      const w = c.w * p.s;
      const h = c.h * p.s;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.left = `${p.x * SW - w / 2}px`;
      el.style.top = `${p.y * SH - h / 2}px`;
      el.style.opacity = String(p.o);
    }
    const m = ctl.minimap.getBoundingClientRect();
    mapCanvas.width = Math.max(40, Math.round(byId.minimap.w * layout.minimap.s * 0.84 * 2));
    mapCanvas.height = mapCanvas.width;
    void m;
  }
  function resize() {
    const s = getSize();
    SW = s.w;
    SH = s.h;
    const devDpr = window.devicePixelRatio || 1;
    dpr = settings.quality === 'low' ? 1 : settings.quality === 'high' ? Math.min(2, devDpr) : Math.min(1.5, devDpr);
    canvas.width = Math.round(SW * dpr);
    canvas.height = Math.round(SH * dpr);
    canvas.style.width = `${SW}px`;
    canvas.style.height = `${SH}px`;
    placeControls();
  }

  // ───────────── World ─────────────
  const owners = [];
  let foods = [];
  const ejected = [];
  const viruses = [];
  const chat = [];
  let you = null;
  let time = 0;
  let paused = false;
  let over = false;
  let raf = 0;
  const stats = { maxMass: START_MASS, eaten: 0, bestRank: 99, start: 0 };

  const GRID = 300;
  const foodGrid = new Map();
  const gkey = (x, y) => `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`;
  function addFood(x = rand(20, WORLD - 20), y = rand(20, WORLD - 20)) {
    const f = { x, y, c: pick(FOOD_COLORS), r: rand(6, 9), alive: true };
    foods.push(f);
    const k = gkey(x, y);
    if (!foodGrid.has(k)) foodGrid.set(k, []);
    foodGrid.get(k).push(f);
  }
  function foodNear(x, y, r, fn) {
    const x0 = Math.floor((x - r) / GRID), x1 = Math.floor((x + r) / GRID);
    const y0 = Math.floor((y - r) / GRID), y1 = Math.floor((y + r) / GRID);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const list = foodGrid.get(`${gx},${gy}`);
        if (!list) continue;
        for (let i = list.length - 1; i >= 0; i--) {
          const f = list[i];
          if (!f.alive) { list.splice(i, 1); continue; }
          fn(f);
        }
      }
    }
  }
  const FOOD_TARGET = settings.quality === 'low' ? 520 : 720;

  function hueColor(h) {
    return `hsl(${h}, 85%, 58%)`;
  }

  function makeOwner(isBot, name, skin, mass) {
    const o = {
      id: owners.length + 1,
      bot: isBot,
      name,
      skin,
      color: hueColor(rand(0, 360)),
      cells: [],
      dead: false,
      respawnAt: 0,
      dir: { x: 0, y: 0, m: 0 },
      ai: { next: 0, aggr: rand(0.35, 1), wander: { x: rand(0, WORLD), y: rand(0, WORLD) } },
      throwT: 0,
    };
    spawnCells(o, mass);
    owners.push(o);
    return o;
  }

  function safeSpot(mass) {
    let best = null;
    for (let tries = 0; tries < 20; tries++) {
      const x = rand(200, WORLD - 200);
      const y = rand(200, WORLD - 200);
      let ok = true;
      for (const o of owners) for (const c of o.cells) if (c.m > mass && Math.hypot(c.x - x, c.y - y) < c.r + 500) ok = false;
      for (const v of viruses) if (Math.hypot(v.x - x, v.y - y) < 260) ok = false;
      best = { x, y };
      if (ok) break;
    }
    return best;
  }

  function spawnCells(o, mass) {
    const s = safeSpot(mass);
    o.cells = [{ x: s.x, y: s.y, m: mass, r: rad(mass), bx: 0, by: 0, mergeAt: 0, owner: o }];
    o.dead = false;
  }

  function addVirus() {
    const s = safeSpot(200);
    viruses.push({ x: s.x, y: s.y, m: VIRUS_MASS, r: rad(VIRUS_MASS) * 0.9 });
  }

  function say(text, color = '#e2e8f0') {
    if (!settings.chat) return;
    chat.push({ text, color });
    while (chat.length > 4) chat.shift();
    chatEl.innerHTML = chat.map((m) => `<div style="color:${m.color}">${m.text}</div>`).join('');
  }
  const escName = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function reset() {
    owners.length = 0;
    foods = [];
    foodGrid.clear();
    ejected.length = 0;
    viruses.length = 0;
    chat.length = 0;
    chatEl.innerHTML = '';
    for (let i = 0; i < FOOD_TARGET; i++) addFood();
    for (let i = 0; i < VIRUS_COUNT; i++) addVirus();
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < BOT_COUNT; i++) {
      // A mix of sizes, so there is always someone to chase and someone to run from.
      const mass = i < 3 ? rand(260, 520) : i < 8 ? rand(70, 180) : rand(20, 60);
      makeOwner(true, names[i % names.length], pick(BOT_SKINS), mass);
    }
    you = makeOwner(false, player.name || 'أنت', profile.skin || 'classic', START_MASS);
    time = 0;
    over = false;
    paused = false;
    stats.maxMass = START_MASS;
    stats.eaten = 0;
    stats.bestRank = 99;
    stats.start = performance.now();
    cam.x = you.cells[0].x;
    cam.y = you.cells[0].y;
    say('⚔️ أهلاً بـ MF Battle! كُل الأصغر منك وابتعد عن الأكبر', '#ffc83d');
    sfx('start');
  }

  // ───────────── Actions ─────────────
  function splitOwner(o, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const list = [...o.cells].sort((a, b) => b.m - a.m);
    let did = false;
    for (const c of list) {
      if (o.cells.length >= MAX_CELLS || c.m < MIN_SPLIT) continue;
      const half = c.m / 2;
      c.m = half;
      c.r = rad(half);
      const delay = 9 + Math.min(16, half * 0.012);
      c.mergeAt = time + delay;
      o.cells.push({ x: c.x + ux * c.r * 0.5, y: c.y + uy * c.r * 0.5, m: half, r: rad(half), bx: ux * (780 + c.r * 1.4), by: uy * (780 + c.r * 1.4), mergeAt: time + delay, owner: o });
      did = true;
    }
    if (did && o === you) { sfx('split'); haptic && haptic('light'); }
    return did;
  }

  function ejectOwner(o, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    let did = false;
    for (const c of o.cells) {
      if (c.m < 35) continue;
      c.m -= EJECT_COST;
      c.r = rad(c.m);
      ejected.push({ x: c.x + ux * c.r, y: c.y + uy * c.r, vx: ux * 720, vy: uy * 720, m: EJECT_MASS, r: rad(EJECT_MASS) * 0.55, color: o.color, born: time, owner: o });
      did = true;
    }
    if (did && o === you) sfx('throw', 40);
  }

  function popOnVirus(c) {
    const o = c.owner;
    const room = MAX_CELLS - o.cells.length;
    if (room <= 0) return;
    const pieces = Math.min(room, Math.max(2, Math.floor(c.m / 40)), 9);
    const each = c.m / (pieces + 1);
    c.m = each;
    c.r = rad(each);
    c.mergeAt = time + 12;
    for (let i = 0; i < pieces; i++) {
      const a = (i / pieces) * Math.PI * 2 + rand(-0.2, 0.2);
      o.cells.push({ x: c.x, y: c.y, m: each, r: rad(each), bx: Math.cos(a) * 620, by: Math.sin(a) * 620, mergeAt: time + 12, owner: o });
    }
    if (o === you) { sfx('virus'); haptic && haptic('heavy'); }
  }

  // ───────────── Bot brains ─────────────
  function thinkBot(o) {
    if (time < o.ai.next) return;
    o.ai.next = time + rand(0.12, 0.26);
    const cells = o.cells;
    if (!cells.length) return;
    let cx = 0, cy = 0, total = 0, big = cells[0], small = cells[0];
    for (const c of cells) {
      cx += c.x * c.m; cy += c.y * c.m; total += c.m;
      if (c.m > big.m) big = c;
      if (c.m < small.m) small = c;
    }
    cx /= total; cy /= total;
    const view = 520 + Math.sqrt(total) * 22;

    // Threats: anyone who can eat my smallest piece and is close. Viruses hurt when big.
    let fx = 0, fy = 0, danger = 0;
    let prey = null, preyScore = 0;
    for (const e of owners) {
      if (e === o || e.dead) continue;
      for (const c of e.cells) {
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d > view + c.r) continue;
        if (c.m > small.m * EAT_RATIO) {
          const reach = c.r + 260 + (c.m > big.m * 2.5 ? 220 : 0);
          if (d < reach) {
            const w = (reach - d) / reach;
            fx -= ((c.x - cx) / (d || 1)) * w;
            fy -= ((c.y - cy) / (d || 1)) * w;
            danger = Math.max(danger, w);
          }
        } else if (big.m > c.m * EAT_RATIO * 1.05) {
          const score = (c.m / (d + 60)) * (e === you ? 1.25 : 1);
          if (score > preyScore) { preyScore = score; prey = c; }
        }
      }
    }
    if (big.m > VIRUS_MASS * 1.4) {
      for (const v of viruses) {
        const d = Math.hypot(v.x - cx, v.y - cy);
        const reach = v.r + big.r + 60;
        if (d < reach) { fx -= ((v.x - cx) / (d || 1)) * 0.6; fy -= ((v.y - cy) / (d || 1)) * 0.6; danger = Math.max(danger, 0.3); }
      }
    }
    // Stay off the walls when running.
    const wall = 260;
    if (cx < wall) fx += (wall - cx) / wall;
    if (cy < wall) fy += (wall - cy) / wall;
    if (cx > WORLD - wall) fx -= (cx - (WORLD - wall)) / wall;
    if (cy > WORLD - wall) fy -= (cy - (WORLD - wall)) / wall;

    if (danger > 0.08 && (!prey || danger > o.ai.aggr * 0.55)) {
      o.dir = { x: fx, y: fy, m: 1 };
      // Cornered small bots sometimes split away to escape.
      if (danger > 0.85 && cells.length === 1 && big.m > 60 && Math.random() < 0.08 * o.ai.aggr) splitOwner(o, fx, fy);
      return;
    }
    if (prey) {
      const dx = prey.x - big.x;
      const dy = prey.y - big.y;
      const d = Math.hypot(dx, dy);
      o.dir = { x: dx, y: dy, m: 1 };
      // The kill: a quick split onto prey that can't get away.
      const splitRange = big.r * 2.6 + 160;
      if (d < splitRange && big.m / 2 > prey.m * EAT_RATIO && big.m >= MIN_SPLIT && cells.length < 4 && Math.random() < 0.35 * o.ai.aggr) {
        splitOwner(o, dx, dy);
      }
      return;
    }
    // Nothing around: graze. Head for nearby food, wander otherwise.
    let best = null, bestD = Infinity;
    foodNear(cx, cy, 420, (f) => {
      const d = Math.hypot(f.x - cx, f.y - cy);
      if (d < bestD) { bestD = d; best = f; }
    });
    for (const ej of ejected) {
      const d = Math.hypot(ej.x - cx, ej.y - cy);
      if (d < 500 && d < bestD * 1.4) { bestD = d; best = ej; }
    }
    if (best) { o.dir = { x: best.x - cx, y: best.y - cy, m: 1 }; return; }
    if (Math.hypot(o.ai.wander.x - cx, o.ai.wander.y - cy) < 200) o.ai.wander = { x: rand(200, WORLD - 200), y: rand(200, WORLD - 200) };
    o.dir = { x: o.ai.wander.x - cx, y: o.ai.wander.y - cy, m: 0.85 };
  }

  // ───────────── Simulation ─────────────
  function kill(victim, killer) {
    victim.dead = true;
    victim.cells = [];
    if (victim === you) return;
    victim.respawnAt = time + rand(2.5, 5);
    if (killer === you) {
      stats.eaten++;
      say(`🍽️ أكلت <b>${escName(victim.name)}</b>!`, '#a3ff3a');
    } else if (killer && Math.random() < 0.5) {
      say(`${escName(killer.name)}: ${pick(BOT_TAUNTS)}`, '#cbd5e1');
    }
  }

  function step(dt) {
    time += dt;
    // Who wants to go where.
    for (const o of owners) {
      if (o.dead) {
        if (o.bot && time >= o.respawnAt) {
          o.name = pick(BOT_NAMES);
          o.skin = pick(BOT_SKINS);
          spawnCells(o, rand(20, 90));
        }
        continue;
      }
      if (o.bot) thinkBot(o);
    }

    // Movement.
    for (const o of owners) {
      if (o.dead) continue;
      let cx = 0, cy = 0, tot = 0;
      for (const c of o.cells) { cx += c.x * c.m; cy += c.y * c.m; tot += c.m; }
      cx /= tot; cy /= tot;
      const dl = Math.hypot(o.dir.x, o.dir.y);
      const ux = dl > 0.001 ? o.dir.x / dl : 0;
      const uy = dl > 0.001 ? o.dir.y / dl : 0;
      const mag = clamp(o.dir.m, 0, 1);
      for (const c of o.cells) {
        const sp = speedOf(c.m) * mag;
        // Pieces steer toward a point ahead of the group, so a split group regroups.
        const tx = cx + ux * 400 - c.x;
        const ty = cy + uy * 400 - c.y;
        const tl = Math.hypot(tx, ty) || 1;
        const vx = o.cells.length > 1 ? (tx / tl) * sp : ux * sp;
        const vy = o.cells.length > 1 ? (ty / tl) * sp : uy * sp;
        c.x += (vx + c.bx) * dt;
        c.y += (vy + c.by) * dt;
        const k = Math.exp(-5 * dt);
        c.bx *= k;
        c.by *= k;
        c.x = clamp(c.x, c.r * 0.3, WORLD - c.r * 0.3);
        c.y = clamp(c.y, c.r * 0.3, WORLD - c.r * 0.3);
        // Big cells slowly lose mass.
        if (c.m > 300) { c.m -= c.m * 0.0016 * dt; c.r = rad(c.m); }
      }
      // Own pieces push apart until they may merge, then merge.
      for (let i = 0; i < o.cells.length; i++) {
        for (let j = i + 1; j < o.cells.length; j++) {
          const a = o.cells[i];
          const b = o.cells[j];
          if (a.m <= 0 || b.m <= 0) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const canMerge = time >= a.mergeAt && time >= b.mergeAt;
          if (canMerge) {
            if (d < Math.max(a.r, b.r) * 0.75) {
              const keep = a.m >= b.m ? a : b;
              const gone = keep === a ? b : a;
              keep.m += gone.m;
              keep.r = rad(keep.m);
              gone.m = 0;
            }
          } else {
            const overlap = a.r + b.r - d;
            if (overlap > 0) {
              const push = overlap * 0.5;
              const nx = dx / d;
              const ny = dy / d;
              a.x -= nx * push; a.y -= ny * push;
              b.x += nx * push; b.y += ny * push;
            }
          }
        }
      }
      o.cells = o.cells.filter((c) => c.m > 0);
      // Holding "throw" keeps throwing; ×2 throws twice as fast.
      if (o === you && input.throwing) {
        o.throwT -= dt;
        if (o.throwT <= 0) {
          ejectOwner(o, aim().x, aim().y);
          o.throwT = input.fast ? THROW_EVERY / 2 : THROW_EVERY;
        }
      }
    }

    // Thrown mass slides and stops.
    for (const e of ejected) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const k = Math.exp(-4 * dt);
      e.vx *= k;
      e.vy *= k;
      e.x = clamp(e.x, 10, WORLD - 10);
      e.y = clamp(e.y, 10, WORLD - 10);
    }

    // Eating.
    const all = [];
    for (const o of owners) if (!o.dead) for (const c of o.cells) all.push(c);
    for (const c of all) {
      if (c.m <= 0) continue;
      let gain = 0;
      foodNear(c.x, c.y, c.r, (f) => {
        if (Math.hypot(f.x - c.x, f.y - c.y) < c.r) { f.alive = false; gain += 1; }
      });
      for (const e of ejected) {
        if (e.m <= 0 || (e.owner === c.owner && time - e.born < 0.35)) continue;
        if (c.m > e.m && Math.hypot(e.x - c.x, e.y - c.y) < c.r - e.r * 0.3) { gain += e.m; e.m = 0; }
      }
      if (gain) {
        c.m += gain;
        c.r = rad(c.m);
        if (c.owner === you) sfx('eat', 70);
      }
      for (const v of viruses) {
        if (v.m <= 0) continue;
        if (c.m > v.m * 1.33 && Math.hypot(v.x - c.x, v.y - c.y) < c.r - v.r * 0.4) {
          c.m += v.m;
          c.r = rad(c.m);
          v.m = 0;
          popOnVirus(c);
        }
      }
    }
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.m <= 0) continue;
      for (let j = 0; j < all.length; j++) {
        const b = all[j];
        if (i === j || b.m <= 0 || a.owner === b.owner) continue;
        if (a.m >= b.m * EAT_RATIO && Math.hypot(a.x - b.x, a.y - b.y) < a.r - b.r * 0.35) {
          a.m += b.m;
          a.r = rad(a.m);
          if (a.owner === you) { sfx('eatBig'); haptic && haptic('medium'); }
          b.m = 0;
          b.eatenBy = a.owner;
        }
      }
    }
    for (const o of owners) {
      if (o.dead) continue;
      const before = o.cells;
      o.cells = before.filter((c) => c.m > 0);
      if (!o.cells.length) {
        const killer = before.find((c) => c.eatenBy)?.eatenBy || null;
        kill(o, killer);
        if (o === you) return finish(killer);
      }
    }
    for (let i = ejected.length - 1; i >= 0; i--) if (ejected[i].m <= 0) ejected.splice(i, 1);
    for (let i = viruses.length - 1; i >= 0; i--) if (viruses[i].m <= 0) { viruses.splice(i, 1); setTimeout(addVirus, 6000); }
    // Keep the map full of food.
    foods = foods.filter((f) => f.alive);
    for (let i = foods.length; i < FOOD_TARGET; i++) if (Math.random() < 0.35) addFood();

    const mine = you.cells.reduce((s, c) => s + c.m, 0);
    stats.maxMass = Math.max(stats.maxMass, mine);
  }

  // ───────────── Camera & drawing ─────────────
  const cam = { x: WORLD / 2, y: WORLD / 2, s: 1 };
  let userZoom = 1;
  function draw() {
    const mine = you.cells;
    let cx = cam.x, cy = cam.y, tot = 0, spread = 0;
    if (mine.length) {
      cx = 0; cy = 0;
      for (const c of mine) { cx += c.x * c.m; cy += c.y * c.m; tot += c.m; }
      cx /= tot; cy /= tot;
      for (const c of mine) spread = Math.max(spread, Math.hypot(c.x - cx, c.y - cy) + c.r);
    }
    const target = (SH / 640) * Math.pow(START_MASS / Math.max(START_MASS, tot), 0.2) * Math.min(1, 520 / Math.max(260, spread * 1.6)) * userZoom;
    cam.x += (cx - cam.x) * 0.18;
    cam.y += (cy - cam.y) * 0.18;
    cam.s += (target - cam.s) * 0.08;
    const s = cam.s;

    const dark = settings.darkMode;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? '#0b0d17' : '#eef1f7';
    ctx.fillRect(0, 0, SW, SH);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (SW / 2 - cam.x * s), dpr * (SH / 2 - cam.y * s));
    const vx0 = cam.x - SW / 2 / s, vx1 = cam.x + SW / 2 / s;
    const vy0 = cam.y - SH / 2 / s, vy1 = cam.y + SH / 2 / s;

    // Grid and border.
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    const gs = 60;
    for (let x = Math.max(0, Math.floor(vx0 / gs) * gs); x <= Math.min(WORLD, vx1); x += gs) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(WORLD, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / gs) * gs); y <= Math.min(WORLD, vy1); y += gs) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(WORLD, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 6 / s;
    ctx.strokeRect(0, 0, WORLD, WORLD);

    const vis = (x, y, r) => x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
    for (const f of foods) {
      if (!f.alive || !vis(f.x, f.y, f.r)) continue;
      ctx.fillStyle = f.c;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, 6.2832);
      ctx.fill();
    }
    for (const e of ejected) {
      if (!vis(e.x, e.y, e.r)) continue;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, 6.2832);
      ctx.fill();
    }

    const cells = [];
    for (const o of owners) if (!o.dead) for (const c of o.cells) if (vis(c.x, c.y, c.r)) cells.push(c);
    cells.sort((a, b) => a.m - b.m);
    const glow = settings.quality === 'high';
    for (const c of cells) {
      const img = skinImage(c.owner.skin);
      if (glow) { ctx.shadowColor = c.owner === you ? 'rgba(34,227,255,0.6)' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; }
      ctx.fillStyle = c.owner.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (img.complete && img.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r * 0.97, 0, 6.2832);
        ctx.clip();
        ctx.drawImage(img, c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
        ctx.restore();
      }
      ctx.lineWidth = Math.max(2, c.r * 0.06);
      ctx.strokeStyle = c.owner === you ? '#22e3ff' : 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, 6.2832);
      ctx.stroke();
      // Name (and mass for your own pieces).
      if (c.r * s > 14) {
        const fs = Math.max(12 / s, c.r * 0.34);
        ctx.font = `900 ${fs}px Cairo, Tahoma, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = fs * 0.18;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.fillStyle = '#fff';
        ctx.strokeText(c.owner.name, c.x, c.y);
        ctx.fillText(c.owner.name, c.x, c.y);
        if (c.owner === you && c.r * s > 26) {
          const ms = fs * 0.6;
          ctx.font = `800 ${ms}px Cairo, Tahoma, sans-serif`;
          ctx.strokeText(String(Math.round(c.m)), c.x, c.y + fs * 0.9);
          ctx.fillText(String(Math.round(c.m)), c.x, c.y + fs * 0.9);
        }
      }
    }

    // Viruses on top: green and spiky.
    for (const v of viruses) {
      if (!vis(v.x, v.y, v.r + 10)) continue;
      ctx.fillStyle = 'rgba(57, 255, 120, 0.85)';
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      const spikes = 22;
      for (let i = 0; i <= spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2 + time * 0.2;
        const rr = i % 2 ? v.r : v.r + 9;
        const px = v.x + Math.cos(a) * rr;
        const py = v.y + Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  let hudT = 0;
  function drawHud(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.25;
    const mine = Math.round(you.cells.reduce((s, c) => s + c.m, 0));
    massEl.textContent = `الكتلة: ${mine.toLocaleString('en-US')}`;
    const ranked = owners.filter((o) => !o.dead).map((o) => ({ o, m: o.cells.reduce((s, c) => s + c.m, 0) })).sort((a, b) => b.m - a.m);
    const myRank = ranked.findIndex((r) => r.o === you) + 1;
    if (myRank && myRank < stats.bestRank) {
      if (stats.bestRank !== 99 && myRank <= 3) sfx('rankUp');
      stats.bestRank = myRank;
    }
    lbEl.innerHTML = ranked.slice(0, 8).map((r, i) => `<li class="${r.o === you ? 'me' : ''}">${i + 1}. ${escName(r.o.name)}</li>`).join('')
      + (myRank > 8 ? `<li class="me">${myRank}. ${escName(you.name)}</li>` : '');
    // Minimap.
    const mc = mapCanvas.getContext('2d');
    const W = mapCanvas.width;
    mc.clearRect(0, 0, W, W);
    mc.fillStyle = 'rgba(255,255,255,0.06)';
    mc.fillRect(0, 0, W, W);
    const k = W / WORLD;
    for (const r of ranked.slice(0, 3)) {
      if (r.o === you) continue;
      const c = r.o.cells[0];
      mc.fillStyle = '#ff3b6b';
      mc.beginPath();
      mc.arc(c.x * k, c.y * k, 3, 0, 6.2832);
      mc.fill();
    }
    mc.strokeStyle = 'rgba(255,255,255,0.5)';
    mc.lineWidth = 1;
    mc.strokeRect((cam.x - SW / 2 / cam.s) * k, (cam.y - SH / 2 / cam.s) * k, (SW / cam.s) * k, (SH / cam.s) * k);
    mc.fillStyle = '#22e3ff';
    for (const c of you.cells) { mc.beginPath(); mc.arc(c.x * k, c.y * k, 3.5, 0, 6.2832); mc.fill(); }
  }

  // ───────────── Input ─────────────
  const input = { dx: 0, dy: 0, m: 0, throwing: false, fast: false, mouse: null };
  function aim() {
    return input.m > 0.05 ? { x: input.dx, y: input.dy } : { x: you.dir.x || 1, y: you.dir.y || 0 };
  }
  const joyRest = () => ({ x: layout.joystick.x * SW, y: layout.joystick.y * SH });
  let joy = null; // { id, cx, cy, r }

  function setJoy(pt) {
    const dx = pt.x - joy.cx;
    const dy = pt.y - joy.cy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(1, d / joy.r);
    input.dx = dx;
    input.dy = dy;
    input.m = m < 0.12 ? 0 : m;
    const kx = d > joy.r ? (dx / d) * joy.r : dx;
    const ky = d > joy.r ? (dy / d) * joy.r : dy;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }
  function releaseJoy() {
    joy = null;
    input.m = 0;
    knob.style.transform = '';
    if (settings.joystick === 'floating') placeControls();
    ctl.joystick.classList.remove('active');
  }
  function startJoy(e, at) {
    const el = ctl.joystick;
    const size = byId.joystick.w * layout.joystick.s;
    if (settings.joystick === 'floating') {
      el.style.left = `${at.x - size / 2}px`;
      el.style.top = `${at.y - size / 2}px`;
      joy = { id: e.pointerId, cx: at.x, cy: at.y, r: size * 0.42 };
    } else {
      const c = joyRest();
      joy = { id: e.pointerId, cx: c.x, cy: c.y, r: size * 0.42 };
    }
    el.classList.add('active');
    setJoy(at);
  }

  function onDown(e) {
    if (over || paused) return;
    const at = toStage(e.clientX, e.clientY);
    const t = e.target;
    const id = t.closest && t.closest('[data-id]') ? t.closest('[data-id]').dataset.id : null;
    if (t.closest && t.closest('.g-zbtn')) return;
    if (id === 'split') { e.preventDefault(); splitOwner(you, aim().x, aim().y); pulse(ctl.split); return; }
    if (id === 'throw') { e.preventDefault(); input.throwing = true; you.throwT = 0; pulse(ctl.throw); throwPointer = e.pointerId; return; }
    if (id === 'double') {
      e.preventDefault();
      input.fast = !input.fast;
      ctl.double.classList.toggle('on', input.fast);
      sfx('toggle');
      say(input.fast ? '⚡ سرعة الرمي ×2 شغّالة' : 'سرعة الرمي رجعت عادية', '#ffc83d');
      return;
    }
    if (e.pointerType === 'mouse') return;
    // Touch: the joystick (fixed: on it; floating: anywhere on the left part of the screen).
    const onJoy = id === 'joystick';
    const leftSide = at.x < SW * 0.55;
    if (!joy && (onJoy || (settings.joystick === 'floating' && leftSide && !id))) {
      e.preventDefault();
      startJoy(e, at);
    }
  }
  let throwPointer = null;
  function onMove(e) {
    if (joy && e.pointerId === joy.id) { setJoy(toStage(e.clientX, e.clientY)); return; }
    if (e.pointerType === 'mouse' && !over && !paused) {
      const at = toStage(e.clientX, e.clientY);
      input.dx = at.x - SW / 2;
      input.dy = at.y - SH / 2;
      input.m = Math.min(1, Math.hypot(input.dx, input.dy) / (SH * 0.3));
    }
  }
  function onUp(e) {
    if (joy && e.pointerId === joy.id) releaseJoy();
    if (e.pointerId === throwPointer) { input.throwing = false; throwPointer = null; }
  }
  function onKey(e) {
    if (over) return;
    if (e.code === 'Space') { e.preventDefault(); splitOwner(you, aim().x, aim().y); }
    if (e.code === 'KeyW') input.throwing = e.type === 'keydown';
    if (e.code === 'Escape' && e.type === 'keydown') togglePause();
  }
  function pulse(el) {
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  ctl.zoom.querySelectorAll('.g-zbtn').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      userZoom = clamp(userZoom * (b.dataset.z === '1' ? 1.15 : 0.87), 0.55, 1.8);
      sfx('tap');
    });
  });

  // ───────────── Pause, death, exit ─────────────
  function showOverlay(html) {
    overlay.innerHTML = `<div class="g-card">${html}</div>`;
    overlay.hidden = false;
  }
  function togglePause() {
    if (over) return;
    paused = !paused;
    sfx(paused ? 'close' : 'open');
    if (!paused) { overlay.hidden = true; return; }
    showOverlay(`<h2>⏸ متوقف</h2><p>الكتلة الحالية ${Math.round(you.cells.reduce((s, c) => s + c.m, 0))}</p>
      <div class="g-row"><button class="btn btn-hot" data-resume>▶ كمّل</button><button class="btn" data-quit>🚪 خروج للقائمة</button></div>`);
    overlay.querySelector('[data-resume]').onclick = togglePause;
    overlay.querySelector('[data-quit]').onclick = () => { sfx('close'); exit(); };
  }
  pauseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); togglePause(); });

  function finish(killer) {
    over = true;
    input.throwing = false;
    releaseJoy();
    sfx('die');
    haptic && haptic('heavy');
    const secs = Math.round((performance.now() - stats.start) / 1000);
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');
    setTimeout(() => {
      showOverlay(`<div class="g-dead-skin">${skinSVG(you.skin, 88)}</div>
        <h2>انأكلت! 💀</h2>
        <p>${killer ? `أكلك <b>${escName(killer.name)}</b>` : 'انتهت الجولة'}</p>
        <div class="g-stats">
          <div><small>أعلى كتلة</small><b>${Math.round(stats.maxMass).toLocaleString('en-US')}</b></div>
          <div><small>الوقت</small><b>${mm}:${ss}</b></div>
          <div><small>أكلت لاعبين</small><b>${stats.eaten}</b></div>
          <div><small>أفضل ترتيب</small><b>#${stats.bestRank === 99 ? '-' : stats.bestRank}</b></div>
        </div>
        <p class="g-note">جولة تدريب ضد بوتات، ما تنحسب بالترتيب الأسبوعي.</p>
        <div class="g-row"><button class="btn btn-hot" data-again>🔁 العب مرة ثانية</button><button class="btn" data-quit>🏠 القائمة</button></div>`);
      overlay.querySelector('[data-again]').onclick = () => { overlay.hidden = true; reset(); };
      overlay.querySelector('[data-quit]').onclick = () => { sfx('close'); exit(); };
    }, 900);
  }

  let lastT = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    if (!paused && !over) {
      you.dir = { x: input.dx, y: input.dy, m: input.m };
      step(dt);
    } else if (over) {
      // The world keeps moving behind the result card.
      step(dt * 0.6);
    }
    draw();
    if (!over) drawHud(dt);
  }

  function exit() {
    cancelAnimationFrame(raf);
    root.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    root.remove();
    onExit();
  }

  resize();
  reset();
  raf = requestAnimationFrame(frame);
  // Demo page only: a handle for automated play tests.
  if (/[?&]demo=1/.test(location.search)) window.__mfbGame = { owners, you: () => you, viruses };

  return {
    resize,
    back() {
      if (over) exit();
      else togglePause();
    },
    exit,
  };
}
