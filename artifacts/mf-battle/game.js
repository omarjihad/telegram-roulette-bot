// MF Battle — the arena. Offline practice against bots: eat food and smaller players,
// split, throw mass, grab +100 orbs, and stay away from bigger players and viruses.
// Everything happens in "stage" coordinates (the landscape screen), drawn on one canvas.
// No sound effects in here: sounds are for the menus only.

import { skinSVG } from './skins.js';
import { CONTROLS, byId, fullLayout, controlHTML } from './controls.js';

const WORLD = 9000;
const START_MASS = 20;
const REVENGE_MASS = 500;
const MIN_SPLIT = 36;
const MAX_CELLS = 16;
const MAX_CELL_MASS = 23000; // one piece never grows past this; the rest is lost
const EJECT_COST = 16;
const EJECT_MASS = 13;
const VIRUS_MASS = 100;
const VIRUS_COUNT = 40;
const ORB_COUNT = 45;
const ORB_MASS = 100;
const BOT_COUNT = 26;
const EAT_RATIO = 1.25;
const THROW_EVERY = 0.14; // seconds between throws at ×1
const THROW_SPEEDS = [1, 2, 5, 10, 20, 50];
const MAP_SECTIONS = 3; // the mini map is split into 3×3 numbered sections

const BOT_NAMES = ['SASUKE', 'KONAN', 'زيد', 'دندون', 'BROKEN', 'Cherry', 'Shadow', 'علي', 'مصطفى', 'Sniper', 'Ghost', 'Ninja', 'حيدر', 'MF_Fan', 'Lulu', 'Rambo', 'King', 'سجاد', 'Pro_IQ', 'Viper', 'أبو حسين', 'Zero', 'Joker', 'كرار', 'Storm', 'Toxic', 'Hunter', 'منتظر', 'Blaze', 'Ace'];
const BOT_SKINS = ['classic', 'mf', 'ocean', 'lava', 'neon', 'toxic', 'tiger', 'snake', 'galaxy', 'ziggurat', 'skull', 'crown', 'dragon'];
const FOOD_COLORS = ['#ff3b6b', '#ff8a3d', '#ffc83d', '#a3ff3a', '#22e3ff', '#9b5cff', '#ff2bd6', '#4ade80', '#60a5fa'];
const BOT_TAUNTS = ['هههه 😂', 'تعال تعال', 'GG', 'منو بعد؟ 😎', 'ركض ركض 🏃', 'اكلتك 🍽️', 'لا تزعل 😅', 'جيبوا غيره'];
const BOT_REPLIES = ['😂😂', 'شكو؟', 'تعال اذا رجّال 😤', 'GG', 'هسه اجيك 👀', 'هههه', 'ماكو مثلي 😎', 'منو انت؟', 'لا تهرب 🏃', '👍'];

const rad = (m) => Math.sqrt(m) * 10;
// Bigger is slower, but never stuck.
const speedOf = (m) => Math.max(70, 1000 * Math.pow(m, -0.42));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const short = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const escName = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

/**
 * opts: stage, player, profile, toStage, getSize, onExit, haptic,
 *       openControls(done) — the control layout editor (done gets the saved layout),
 *       showAd(blockId) — resolves when an ad was watched, ads: { reward, interstitial }
 */
export function startGame(opts) {
  const { stage, player, profile, toStage, getSize, onExit, haptic, openControls, showAd } = opts;
  const ads = opts.ads || {};
  const settings = { darkMode: true, chat: true, quality: 'medium', joystick: 'fixed', ...(profile.settings || {}) };
  let layout = fullLayout(profile.layout || {});

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
    if (c.id === 'double') el.innerHTML = '<span class="ctl-label" data-speed>×1</span><small>سرعة الرمي</small>';
    else if (c.id === 'mass') el.innerHTML = '<span class="ctl-label" data-mass>الكتلة: 20</span>';
    else if (c.id === 'leaderboard') el.innerHTML = '<div class="g-lb"><b>المتصدرين</b><ol data-lb></ol></div>';
    else if (c.id === 'minimap') el.innerHTML = '<canvas class="g-map"></canvas>';
    else if (c.id === 'chat') el.innerHTML = '<div class="g-chat" data-chat></div><span class="g-chat-hint">✍️ اضغط حتى تكتب</span>';
    else if (c.id === 'zoom') el.innerHTML = '<button class="g-zbtn" data-z="1">+</button><button class="g-zbtn" data-z="-1">−</button>';
    else el.innerHTML = controlHTML(c);
    hud.appendChild(el);
    ctl[c.id] = el;
  }
  if (!settings.chat) ctl.chat.hidden = true;
  // Top corner: exit, pause, control settings.
  const topBar = document.createElement('div');
  topBar.className = 'g-top';
  topBar.innerHTML = '<button class="g-tbtn g-exit" data-top="exit" aria-label="خروج">✕</button><button class="g-tbtn" data-top="pause" aria-label="إيقاف مؤقت">❚❚</button><button class="g-tbtn" data-top="controls" aria-label="إعدادات التحكم">⚙️</button>';
  hud.appendChild(topBar);
  // Chat input bar.
  const chatBar = document.createElement('form');
  chatBar.className = 'g-chatbar';
  chatBar.hidden = true;
  chatBar.innerHTML = '<input maxlength="60" placeholder="اكتب رسالتك…" autocomplete="off" /><button type="submit">إرسال</button><button type="button" data-cancel>✕</button>';
  hud.appendChild(chatBar);
  const chatInput = chatBar.querySelector('input');

  const overlay = document.createElement('div');
  overlay.className = 'g-overlay';
  overlay.hidden = true;
  root.appendChild(overlay);

  const massEl = ctl.mass.querySelector('[data-mass]');
  const lbEl = ctl.leaderboard.querySelector('[data-lb]');
  const chatEl = ctl.chat.querySelector('[data-chat]');
  const mapCanvas = ctl.minimap.querySelector('canvas');
  const speedEl = ctl.double.querySelector('[data-speed]');
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
    mapCanvas.width = Math.max(60, Math.round(byId.minimap.w * layout.minimap.s * 0.84 * 2));
    mapCanvas.height = mapCanvas.width;
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
  const orbs = [];
  const chat = [];
  let you = null;
  let time = 0;
  let paused = false;
  let over = false;
  let raf = 0;
  let deaths = 0;
  let deathsSinceAd = 0;
  let throwLevel = 0;
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
  const FOOD_TARGET = settings.quality === 'low' ? 2200 : settings.quality === 'high' ? 3600 : 3000;

  function makeOwner(isBot, name, skin, mass) {
    const o = {
      id: owners.length + 1,
      bot: isBot,
      name,
      skin,
      color: `hsl(${rand(0, 360)}, 85%, 58%)`,
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

  function safeSpot(mass, near = null) {
    let best = null;
    for (let tries = 0; tries < 24; tries++) {
      const x = near ? clamp(near.x + rand(-900, 900), 200, WORLD - 200) : rand(200, WORLD - 200);
      const y = near ? clamp(near.y + rand(-900, 900), 200, WORLD - 200) : rand(200, WORLD - 200);
      let ok = true;
      for (const o of owners) for (const c of o.cells) if (c.m > mass && Math.hypot(c.x - x, c.y - y) < c.r + 420) ok = false;
      for (const v of viruses) if (Math.hypot(v.x - x, v.y - y) < 260) ok = false;
      best = { x, y };
      if (ok) break;
    }
    return best;
  }

  function newCell(o, x, y, m) {
    return { x, y, m, r: rad(m), bx: 0, by: 0, mergeAt: 0, owner: o };
  }

  function spawnCells(o, mass, near = null) {
    const s = safeSpot(mass, near);
    o.cells = [newCell(o, s.x, s.y, mass)];
    o.dead = false;
  }

  function addVirus() {
    const s = safeSpot(200);
    viruses.push({ x: s.x, y: s.y, m: VIRUS_MASS, r: rad(VIRUS_MASS) * 0.9 });
  }
  function addOrb() {
    orbs.push({ x: rand(150, WORLD - 150), y: rand(150, WORLD - 150), r: 26, m: ORB_MASS, ph: rand(0, 6.28) });
  }

  function grow(c, amount) {
    c.m = Math.min(MAX_CELL_MASS, c.m + amount);
    c.r = rad(c.m);
  }

  function say(text, color = '#e2e8f0') {
    if (!settings.chat) return;
    chat.push({ text, color });
    while (chat.length > 5) chat.shift();
    chatEl.innerHTML = chat.map((m) => `<div style="color:${m.color}">${m.text}</div>`).join('');
  }

  function reset() {
    owners.length = 0;
    foods = [];
    foodGrid.clear();
    ejected.length = 0;
    viruses.length = 0;
    orbs.length = 0;
    chat.length = 0;
    chatEl.innerHTML = '';
    for (let i = 0; i < FOOD_TARGET; i++) addFood();
    for (let i = 0; i < VIRUS_COUNT; i++) addVirus();
    for (let i = 0; i < ORB_COUNT; i++) addOrb();
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < BOT_COUNT; i++) {
      // A mix of sizes, so there is always someone to chase and someone to run from.
      const mass = i < 4 ? rand(900, 2600) : i < 12 ? rand(150, 520) : rand(20, 90);
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
    say('⚔️ أهلاً بـ MF Battle! كُل الأصغر منك، والكرات الذهبية تعطيك +100', '#ffc83d');
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
      const delay = 9 + Math.min(16, half * 0.004);
      c.mergeAt = time + delay;
      const piece = newCell(o, c.x + ux * c.r * 0.5, c.y + uy * c.r * 0.5, half);
      piece.bx = ux * (780 + c.r * 1.4);
      piece.by = uy * (780 + c.r * 1.4);
      piece.mergeAt = time + delay;
      o.cells.push(piece);
      did = true;
    }
    if (did && o === you && haptic) haptic('light');
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
      ejected.push({ x: c.x + ux * c.r, y: c.y + uy * c.r, vx: ux * 760, vy: uy * 760, m: EJECT_MASS, r: rad(EJECT_MASS) * 0.55, color: o.color, born: time, owner: o });
      did = true;
    }
    return did;
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
      const p = newCell(o, c.x, c.y, each);
      p.bx = Math.cos(a) * 620;
      p.by = Math.sin(a) * 620;
      p.mergeAt = time + 12;
      o.cells.push(p);
    }
    if (o === you && haptic) haptic('heavy');
  }

  // ───────────── Bot brains ─────────────
  function centerOf(o) {
    let cx = 0, cy = 0, total = 0;
    for (const c of o.cells) { cx += c.x * c.m; cy += c.y * c.m; total += c.m; }
    return { x: cx / total, y: cy / total, m: total };
  }

  function thinkBot(o) {
    if (time < o.ai.next) return;
    o.ai.next = time + rand(0.12, 0.26);
    const cells = o.cells;
    if (!cells.length) return;
    let big = cells[0], small = cells[0];
    for (const c of cells) { if (c.m > big.m) big = c; if (c.m < small.m) small = c; }
    const { x: cx, y: cy, m: total } = centerOf(o);
    const view = 560 + Math.sqrt(total) * 22;

    // Threats: anyone who can eat my smallest piece and is close.
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
        if (d < v.r + big.r + 60) { fx -= ((v.x - cx) / (d || 1)) * 0.6; fy -= ((v.y - cy) / (d || 1)) * 0.6; danger = Math.max(danger, 0.3); }
      }
    }
    const wall = 260;
    if (cx < wall) fx += (wall - cx) / wall;
    if (cy < wall) fy += (wall - cy) / wall;
    if (cx > WORLD - wall) fx -= (cx - (WORLD - wall)) / wall;
    if (cy > WORLD - wall) fy -= (cy - (WORLD - wall)) / wall;

    if (danger > 0.08 && (!prey || danger > o.ai.aggr * 0.55)) {
      o.dir = { x: fx, y: fy, m: 1 };
      if (danger > 0.85 && cells.length === 1 && big.m > 60 && Math.random() < 0.08 * o.ai.aggr) splitOwner(o, fx, fy);
      return;
    }
    if (prey) {
      const dx = prey.x - big.x;
      const dy = prey.y - big.y;
      const d = Math.hypot(dx, dy);
      o.dir = { x: dx, y: dy, m: 1 };
      const splitRange = big.r * 2.6 + 160;
      if (d < splitRange && big.m / 2 > prey.m * EAT_RATIO && big.m >= MIN_SPLIT && cells.length < 4 && Math.random() < 0.35 * o.ai.aggr) splitOwner(o, dx, dy);
      return;
    }
    // Nothing around: grab a +100 orb if one is near, else graze, else wander.
    let best = null, bestD = Infinity;
    for (const b of orbs) {
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (d < 700 && d < bestD) { bestD = d * 0.5; best = b; }
    }
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

  function moveOwner(o, dt) {
    const { x: cx, y: cy } = centerOf(o);
    let spread = 0;
    for (const c of o.cells) spread = Math.max(spread, Math.hypot(c.x - cx, c.y - cy) + c.r);
    const dl = Math.hypot(o.dir.x, o.dir.y);
    const ux = dl > 0.001 ? o.dir.x / dl : 0;
    const uy = dl > 0.001 ? o.dir.y / dl : 0;
    const mag = clamp(o.dir.m, 0, 1);
    // Every piece heads for one point well ahead of the whole group, so even 16 pieces
    // all move the way you point instead of pulling against each other.
    const reach = spread + 900;
    const tx = cx + ux * reach;
    const ty = cy + uy * reach;
    for (const c of o.cells) {
      const sp = speedOf(c.m) * mag;
      const dx = tx - c.x;
      const dy = ty - c.y;
      const d = Math.hypot(dx, dy) || 1;
      c.x += ((dx / d) * sp + c.bx) * dt;
      c.y += ((dy / d) * sp + c.by) * dt;
      const k = Math.exp(-5 * dt);
      c.bx *= k;
      c.by *= k;
      c.x = clamp(c.x, c.r * 0.3, WORLD - c.r * 0.3);
      c.y = clamp(c.y, c.r * 0.3, WORLD - c.r * 0.3);
      if (c.m > 300) { c.m -= c.m * 0.0016 * dt; c.r = rad(c.m); }
    }
    // Own pieces push apart until they may merge, then merge (still capped at 23k).
    for (let i = 0; i < o.cells.length; i++) {
      for (let j = i + 1; j < o.cells.length; j++) {
        const a = o.cells[i];
        const b = o.cells[j];
        if (a.m <= 0 || b.m <= 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (time >= a.mergeAt && time >= b.mergeAt) {
          if (d < Math.max(a.r, b.r) * 0.75) {
            const keep = a.m >= b.m ? a : b;
            const gone = keep === a ? b : a;
            grow(keep, gone.m);
            gone.m = 0;
          }
        } else {
          const overlap = a.r + b.r - d;
          if (overlap > 0) {
            // Gentle push: they slide around each other instead of locking up.
            const push = Math.min(overlap * 0.5, 600 * dt);
            const nx = dx / d;
            const ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
          }
        }
      }
    }
    o.cells = o.cells.filter((c) => c.m > 0);
  }

  function step(dt) {
    time += dt;
    for (const o of owners) {
      if (o.dead) {
        if (o.bot && time >= o.respawnAt) {
          o.name = pick(BOT_NAMES);
          o.skin = pick(BOT_SKINS);
          spawnCells(o, rand(20, 120));
        }
        continue;
      }
      if (o.bot) thinkBot(o);
    }

    for (const o of owners) {
      if (o.dead) continue;
      moveOwner(o, dt);
      // Holding "throw" keeps throwing, ×1 up to ×50 as fast.
      if (o === you && input.throwing) {
        const every = THROW_EVERY / THROW_SPEEDS[throwLevel];
        o.throwT -= dt;
        let n = 0;
        while (o.throwT <= 0 && n < 12) {
          const a = aim();
          ejectOwner(o, a.x, a.y);
          o.throwT += every;
          n++;
        }
        if (o.throwT < 0) o.throwT = 0;
      }
    }

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
      for (const b of orbs) {
        if (b.m <= 0) continue;
        if (Math.hypot(b.x - c.x, b.y - c.y) < c.r + b.r * 0.4) {
          gain += b.m;
          b.m = 0;
          if (c.owner === you) say('✨ +100 كتلة!', '#ffc83d');
        }
      }
      if (gain) grow(c, gain);
      for (const v of viruses) {
        if (v.m <= 0) continue;
        if (c.m > v.m * 1.33 && Math.hypot(v.x - c.x, v.y - c.y) < c.r - v.r * 0.4) {
          grow(c, v.m);
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
          grow(a, b.m);
          if (a.owner === you && haptic) haptic('medium');
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
        if (o === you) return died(killer);
      }
    }
    for (let i = ejected.length - 1; i >= 0; i--) if (ejected[i].m <= 0) ejected.splice(i, 1);
    for (let i = viruses.length - 1; i >= 0; i--) if (viruses[i].m <= 0) { viruses.splice(i, 1); setTimeout(addVirus, 6000); }
    for (let i = orbs.length - 1; i >= 0; i--) if (orbs[i].m <= 0) { orbs.splice(i, 1); setTimeout(addOrb, 4000); }
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
    // Zoom out as you grow / spread, but never further than ~3400 world units tall.
    const auto = Math.max(SH / 3400, (SH / 640) * Math.pow(START_MASS / Math.max(START_MASS, tot), 0.2) * Math.min(1, 520 / Math.max(260, spread * 1.6)));
    const target = auto * userZoom;
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

    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    const gs = 60;
    for (let x = Math.max(0, Math.floor(vx0 / gs) * gs); x <= Math.min(WORLD, vx1); x += gs) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(WORLD, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / gs) * gs); y <= Math.min(WORLD, vy1); y += gs) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(WORLD, vx1), y); }
    ctx.stroke();
    // Section lines (the same 3×3 sections as the mini map).
    ctx.strokeStyle = dark ? 'rgba(255,200,61,0.18)' : 'rgba(180,120,0,0.22)';
    ctx.lineWidth = 4 / s;
    ctx.beginPath();
    for (let i = 1; i < MAP_SECTIONS; i++) {
      const p = (WORLD / MAP_SECTIONS) * i;
      ctx.moveTo(p, 0); ctx.lineTo(p, WORLD);
      ctx.moveTo(0, p); ctx.lineTo(WORLD, p);
    }
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
    // +100 orbs: golden, pulsing, with "+100".
    for (const b of orbs) {
      if (!vis(b.x, b.y, b.r * 1.6)) continue;
      const pulse = 1 + Math.sin(time * 4 + b.ph) * 0.08;
      const r = b.r * pulse;
      const g = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, r * 0.1, b.x, b.y, r);
      g.addColorStop(0, '#fff6c2');
      g.addColorStop(0.6, '#ffc83d');
      g.addColorStop(1, '#d97706');
      ctx.fillStyle = 'rgba(255,200,61,0.22)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 1.55, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, 6.2832);
      ctx.fill();
      ctx.font = `900 ${r * 0.62}px Cairo, Tahoma, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5a2a00';
      ctx.fillText('+100', b.x, b.y + 1);
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
          ctx.strokeText(short(c.m), c.x, c.y + fs * 0.9);
          ctx.fillText(short(c.m), c.x, c.y + fs * 0.9);
        }
      }
    }

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

  const sectionOf = (x, y) => {
    const n = WORLD / MAP_SECTIONS;
    const col = clamp(Math.floor(x / n), 0, MAP_SECTIONS - 1);
    const row = clamp(Math.floor(y / n), 0, MAP_SECTIONS - 1);
    return row * MAP_SECTIONS + col + 1;
  };

  let hudT = 0;
  function drawHud(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.25;
    const mine = you.cells.reduce((s, c) => s + c.m, 0);
    massEl.textContent = `الكتلة: ${Math.round(mine).toLocaleString('en-US')}`;
    // Leaderboard with everyone's score.
    const ranked = owners.filter((o) => !o.dead).map((o) => ({ o, m: o.cells.reduce((s, c) => s + c.m, 0) })).sort((a, b) => b.m - a.m);
    const myRank = ranked.findIndex((r) => r.o === you) + 1;
    if (myRank && myRank < stats.bestRank) stats.bestRank = myRank;
    const row = (r, i) => `<li class="${r.o === you ? 'me' : ''}"><span>${i + 1}. ${escName(r.o.name)}</span><b>${short(r.m)}</b></li>`;
    lbEl.innerHTML = ranked.slice(0, 8).map(row).join('') + (myRank > 8 ? row(ranked[myRank - 1], myRank - 1) : '');

    // Mini map: 3×3 numbered sections; you see who is in your section only.
    const mc = mapCanvas.getContext('2d');
    const W = mapCanvas.width;
    const k = W / WORLD;
    const cell = W / MAP_SECTIONS;
    const center = you.cells.length ? centerOf(you) : { x: cam.x, y: cam.y };
    const mySec = sectionOf(center.x, center.y);
    mc.clearRect(0, 0, W, W);
    mc.fillStyle = 'rgba(255,255,255,0.05)';
    mc.fillRect(0, 0, W, W);
    for (let r = 0; r < MAP_SECTIONS; r++) {
      for (let c = 0; c < MAP_SECTIONS; c++) {
        const n = r * MAP_SECTIONS + c + 1;
        if (n === mySec) { mc.fillStyle = 'rgba(34,227,255,0.16)'; mc.fillRect(c * cell, r * cell, cell, cell); }
        mc.fillStyle = n === mySec ? 'rgba(34,227,255,0.9)' : 'rgba(255,255,255,0.35)';
        mc.font = `900 ${cell * 0.42}px Cairo, Tahoma, sans-serif`;
        mc.textAlign = 'center';
        mc.textBaseline = 'middle';
        mc.fillText(String(n), c * cell + cell / 2, r * cell + cell / 2);
      }
    }
    mc.strokeStyle = 'rgba(255,255,255,0.22)';
    mc.lineWidth = 1;
    for (let i = 1; i < MAP_SECTIONS; i++) {
      mc.beginPath(); mc.moveTo(i * cell, 0); mc.lineTo(i * cell, W); mc.stroke();
      mc.beginPath(); mc.moveTo(0, i * cell); mc.lineTo(W, i * cell); mc.stroke();
    }
    for (const r of ranked) {
      if (r.o === you) continue;
      const c = centerOf(r.o);
      if (sectionOf(c.x, c.y) !== mySec) continue;
      mc.fillStyle = r.m > mine * EAT_RATIO ? '#ff3b6b' : '#a3ff3a';
      mc.beginPath();
      mc.arc(c.x * k, c.y * k, Math.max(2, Math.min(6, Math.sqrt(r.m) * 0.08)), 0, 6.2832);
      mc.fill();
    }
    mc.fillStyle = '#22e3ff';
    for (const c of you.cells) { mc.beginPath(); mc.arc(c.x * k, c.y * k, 3.5, 0, 6.2832); mc.fill(); }
  }

  // ───────────── Input ─────────────
  const input = { dx: 0, dy: 0, m: 0, throwing: false };
  function aim() {
    return input.m > 0.05 ? { x: input.dx, y: input.dy } : { x: you.dir.x || 1, y: you.dir.y || 0 };
  }
  const joyRest = () => ({ x: layout.joystick.x * SW, y: layout.joystick.y * SH });
  let joy = null;
  let throwPointer = null;

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
  function pulse(el) {
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }
  function setThrowLevel(i) {
    throwLevel = i;
    speedEl.textContent = `×${THROW_SPEEDS[i]}`;
    ctl.double.classList.toggle('on', i > 0);
  }

  function onDown(e) {
    if (over || paused) return;
    const t = e.target;
    if (t.closest && (t.closest('.g-top') || t.closest('.g-chatbar') || t.closest('.g-zbtn'))) return;
    const at = toStage(e.clientX, e.clientY);
    const id = t.closest && t.closest('[data-id]') ? t.closest('[data-id]').dataset.id : null;
    if (id === 'split') { e.preventDefault(); const a = aim(); splitOwner(you, a.x, a.y); pulse(ctl.split); return; }
    if (id === 'throw') { e.preventDefault(); input.throwing = true; you.throwT = 0; pulse(ctl.throw); throwPointer = e.pointerId; return; }
    if (id === 'double') {
      e.preventDefault();
      setThrowLevel((throwLevel + 1) % THROW_SPEEDS.length);
      pulse(ctl.double);
      say(`⚡ سرعة الرمي ×${THROW_SPEEDS[throwLevel]}`, '#ffc83d');
      return;
    }
    if (id === 'chat') { e.preventDefault(); openChat(); return; }
    if (e.pointerType === 'mouse') return;
    const onJoy = id === 'joystick';
    const leftSide = at.x < SW * 0.55;
    if (!joy && (onJoy || (settings.joystick === 'floating' && leftSide && !id))) {
      e.preventDefault();
      startJoy(e, at);
    }
  }
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
    if (over || document.activeElement === chatInput) return;
    if (e.code === 'Space' && e.type === 'keydown') { e.preventDefault(); const a = aim(); splitOwner(you, a.x, a.y); }
    if (e.code === 'KeyW') input.throwing = e.type === 'keydown';
    if (e.code === 'Enter' && e.type === 'keydown' && settings.chat) openChat();
    if (e.code === 'Escape' && e.type === 'keydown') togglePause();
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
      userZoom = clamp(userZoom * (b.dataset.z === '1' ? 1.15 : 0.87), 0.4, 1.8);
    });
  });

  // ───────────── Chat ─────────────
  function openChat() {
    if (!settings.chat) return;
    chatBar.hidden = false;
    chatInput.value = '';
    chatInput.focus(); // inside the tap, so phones open the keyboard
  }
  function closeChat() {
    chatBar.hidden = true;
    chatInput.blur();
  }
  chatBar.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim().slice(0, 60);
    closeChat();
    if (!text) return;
    say(`<b>${escName(you.name)}:</b> ${escName(text)}`, '#22e3ff');
    // Sometimes a bot answers.
    if (Math.random() < 0.6) {
      setTimeout(() => {
        const alive = owners.filter((o) => o.bot && !o.dead);
        if (alive.length && !over) say(`${escName(pick(alive).name)}: ${pick(BOT_REPLIES)}`, '#cbd5e1');
      }, rand(900, 2200));
    }
  });
  chatBar.querySelector('[data-cancel]').addEventListener('click', closeChat);

  // ───────────── Top buttons: exit (with confirm), pause, control settings ─────────────
  function showOverlay(html) {
    overlay.innerHTML = `<div class="g-card">${html}</div>`;
    overlay.hidden = false;
    return overlay.firstElementChild;
  }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }
  function togglePause() {
    if (over) return;
    paused = !paused;
    if (!paused) { hideOverlay(); return; }
    const card = showOverlay(`<h2>⏸ متوقف</h2><p>الكتلة الحالية ${Math.round(you.cells.reduce((s, c) => s + c.m, 0)).toLocaleString('en-US')}</p>
      <div class="g-row"><button class="btn btn-hot" data-resume>▶ كمّل</button><button class="btn" data-exit>✕ خروج</button></div>`);
    card.querySelector('[data-resume]').onclick = togglePause;
    card.querySelector('[data-exit]').onclick = confirmExit;
  }
  function confirmExit() {
    const wasPaused = paused;
    paused = true;
    const card = showOverlay(`<h2>تطلع من الجولة؟</h2><p>إذا طلعت تخسر كتلتك بهالجولة.</p>
      <div class="g-row"><button class="btn btn-hot" data-yes>نعم، اطلع</button><button class="btn" data-no>لا، كمّل</button></div>`);
    card.querySelector('[data-yes]').onclick = exit;
    card.querySelector('[data-no]').onclick = () => {
      hideOverlay();
      paused = false;
      if (wasPaused) togglePause();
    };
  }
  function openControlSettings() {
    if (!openControls || over) return;
    paused = true;
    releaseJoy();
    input.throwing = false;
    openControls((saved) => {
      layout = fullLayout(saved || {});
      placeControls();
      paused = false;
      hideOverlay();
    });
  }
  topBar.querySelectorAll('[data-top]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const a = b.dataset.top;
      if (a === 'exit') { if (over) exit(); else confirmExit(); }
      else if (a === 'pause') togglePause();
      else if (a === 'controls') openControlSettings();
    });
  });

  // ───────────── Death, revenge and ads ─────────────
  function revive(killer) {
    // Revenge: back in the same match with 500, close to whoever ate you (if still around).
    const near = killer && !killer.dead && killer.cells.length ? centerOf(killer) : null;
    spawnCells(you, REVENGE_MASS, near);
    over = false;
    hideOverlay();
    cam.x = you.cells[0].x;
    cam.y = you.cells[0].y;
    say(`🔥 الانتقام! رجعت بـ ${REVENGE_MASS}${near ? ` قريب من ${escName(killer.name)}` : ''}`, '#ff8a3d');
  }

  function died(killer) {
    over = true;
    deaths++;
    deathsSinceAd++;
    input.throwing = false;
    releaseJoy();
    closeChat();
    if (haptic) haptic('heavy');
    const secs = Math.round((performance.now() - stats.start) / 1000);
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');

    const card = () => {
      const c = showOverlay(`<div class="g-dead-skin">${skinSVG(you.skin, 88)}</div>
        <h2>انأكلت! 💀</h2>
        <p>${killer ? `أكلك <b>${escName(killer.name)}</b>` : 'انتهت الجولة'}</p>
        <div class="g-stats">
          <div><small>أعلى كتلة</small><b>${Math.round(stats.maxMass).toLocaleString('en-US')}</b></div>
          <div><small>الوقت</small><b>${mm}:${ss}</b></div>
          <div><small>أكلت لاعبين</small><b>${stats.eaten}</b></div>
          <div><small>أفضل ترتيب</small><b>#${stats.bestRank === 99 ? '-' : stats.bestRank}</b></div>
        </div>
        ${ads.reward ? `<button class="btn g-revenge" data-revenge>🔥 الانتقام والبدء بـ ${REVENGE_MASS} <small>📺 شاهد إعلان</small></button>` : ''}
        <p class="g-note" data-msg>جولة تدريب ضد بوتات، ما تنحسب بالترتيب الأسبوعي.</p>
        <div class="g-row"><button class="btn btn-hot" data-again>🔁 العب من جديد</button><button class="btn" data-quit>🏠 القائمة</button></div>`);
      c.querySelector('[data-again]').onclick = () => { hideOverlay(); reset(); };
      c.querySelector('[data-quit]').onclick = exit;
      const rev = c.querySelector('[data-revenge]');
      if (rev) {
        rev.onclick = async () => {
          rev.disabled = true;
          try {
            await showAd(ads.reward);
            deathsSinceAd = 0; // a watched reward ad counts as the ad for these deaths
            revive(killer);
          } catch (err) {
            rev.disabled = false;
            c.querySelector('[data-msg]').textContent = err && err.message ? err.message : 'ما اكو إعلان هسه، جرّب بعد شوية';
          }
        };
      }
    };

    setTimeout(async () => {
      // Every second death shows an ad first (unless a reward ad was watched since the last one).
      if (deathsSinceAd >= 2 && ads.interstitial) {
        try { await showAd(ads.interstitial); } catch (e) { /* no ad right now */ }
        deathsSinceAd = 0;
      }
      if (over) card();
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
  if (/[?&]demo=1/.test(location.search)) window.__mfbGame = { owners, you: () => you, viruses, orbs, WORLD };

  return {
    resize,
    back() {
      if (over) exit();
      else togglePause();
    },
    exit,
  };
}
