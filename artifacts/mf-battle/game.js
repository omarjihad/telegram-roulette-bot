// MF Battle — the arena screen. The same screen plays two ways:
//   • practice: the world (sim.js) runs right here against bots, no internet needed;
//   • online: the world runs on the bot's server and this screen shows what it sends.
// Everything is drawn on one canvas in "stage" coordinates (the landscape screen).
// No sound effects in here: sounds are for the menus only.

import { skinSVG } from './skins.js';
import { CONTROLS, byId, fullLayout, controlHTML, placeIn } from './controls.js';
import {
  createWorld, FoodGrid, WORLD, START_MASS, REVENGE_MASS, EAT_RATIO, THROW_SPEEDS, MAP_SECTIONS,
  FOOD_COLORS, rad, sectionOf, foodRadius, speedOf, pelletAt, pelletRadius, virusRadius,
} from './sim.js';

const BOT_TAUNTS = ['هههه 😂', 'تعال تعال', 'GG', 'منو بعد؟ 😎', 'ركض ركض 🏃', 'اكلتك 🍽️', 'لا تزعل 😅', 'جيبوا غيره'];
const BOT_REPLIES = ['😂😂', 'شكو؟', 'تعال اذا رجّال 😤', 'GG', 'هسه اجيك 👀', 'هههه', 'ماكو مثلي 😎', 'منو انت؟', 'لا تهرب 🏃', '👍'];
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.4;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const short = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const escName = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hueColors = new Map();
const hueColor = (h) => { let c = hueColors.get(h); if (!c) { c = `hsl(${h}, 85%, 58%)`; hueColors.set(h, c); } return c; };
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

/** Skins as round pictures, drawn once per skin (cheaper than clipping every frame). */
const skinSprites = {};
function skinSprite(id) {
  let s = skinSprites[id];
  if (s) return s.ready ? s.canvas : null;
  s = skinSprites[id] = { ready: false, canvas: document.createElement('canvas') };
  const img = new Image();
  img.onload = () => {
    const size = 256;
    s.canvas.width = size;
    s.canvas.height = size;
    const g = s.canvas.getContext('2d');
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.drawImage(img, 0, 0, size, size);
    s.ready = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(skinSVG(id, 256))}`;
  return null;
}

/** The golden +100 orb, drawn once. */
let orbSprite = null;
function getOrbSprite() {
  if (orbSprite) return orbSprite;
  const r = 26, size = Math.ceil(r * 1.6 * 2) + 4;
  const cv = document.createElement('canvas');
  cv.width = size * 2;
  cv.height = size * 2;
  const g = cv.getContext('2d');
  g.scale(2, 2);
  const c = size / 2;
  g.fillStyle = 'rgba(255,200,61,0.22)';
  g.beginPath(); g.arc(c, c, r * 1.55, 0, 6.2832); g.fill();
  const grad = g.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.1, c, c, r);
  grad.addColorStop(0, '#fff6c2');
  grad.addColorStop(0.6, '#ffc83d');
  grad.addColorStop(1, '#d97706');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, r, 0, 6.2832); g.fill();
  g.font = `900 ${r * 0.62}px Cairo, Tahoma, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#5a2a00';
  g.fillText('+100', c, c + 1);
  orbSprite = { canvas: cv, size };
  return orbSprite;
}

/**
 * opts: stage, player, profile, toStage, getSize() → { w, h, safe }, onExit, haptic,
 *       openControls(done) — the control layout editor (done gets the saved layout),
 *       showAd(blockId) — resolves when an ad was watched, ads: { reward, interstitial },
 *       online: { url, initData } to play online (null = practice against bots).
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
    else if (c.id === 'net') el.innerHTML = '<span class="ctl-label" data-net>-- fps</span>';
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
  const chatBar = document.createElement('form');
  chatBar.className = 'g-chatbar';
  chatBar.hidden = true;
  chatBar.innerHTML = '<input maxlength="60" placeholder="اكتب رسالتك…" autocomplete="off" /><button type="submit">إرسال</button><button type="button" data-cancel>✕</button>';
  hud.appendChild(chatBar);
  const chatInput = chatBar.querySelector('input');
  const popEl = document.createElement('div');
  popEl.className = 'g-pop';
  hud.appendChild(popEl);
  const zoomTip = document.createElement('div');
  zoomTip.className = 'g-zoomtip';
  zoomTip.hidden = true;
  hud.appendChild(zoomTip);

  const overlay = document.createElement('div');
  overlay.className = 'g-overlay';
  overlay.hidden = true;
  root.appendChild(overlay);

  const massEl = ctl.mass.querySelector('[data-mass]');
  const netEl = ctl.net.querySelector('[data-net]');
  const lbEl = ctl.leaderboard.querySelector('[data-lb]');
  const chatEl = ctl.chat.querySelector('[data-chat]');
  const mapCanvas = ctl.minimap.querySelector('canvas');
  const speedEl = ctl.double.querySelector('[data-speed]');
  const knob = ctl.joystick.querySelector('.ctl-joy-knob');

  let SW = 0;
  let SH = 0;
  let SAFE = { x: 0, y: 0, w: 1, h: 1 };
  let dpr = 1;
  function placeControls() {
    for (const c of CONTROLS) {
      const r = placeIn(SAFE, c, layout[c.id]);
      const el = ctl[c.id];
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      el.style.opacity = String(layout[c.id].o);
    }
    topBar.style.left = `${SAFE.x}px`;
    topBar.style.top = `${SAFE.y}px`;
    mapCanvas.width = Math.max(60, Math.round(byId.minimap.w * layout.minimap.s * 0.84 * 2));
    mapCanvas.height = mapCanvas.width;
  }
  function resize() {
    const s = getSize();
    SW = s.w;
    SH = s.h;
    SAFE = s.safe || { x: 0, y: 0, w: SW, h: SH };
    const devDpr = window.devicePixelRatio || 1;
    dpr = settings.quality === 'low' ? 1 : settings.quality === 'high' ? Math.min(2, devDpr) : Math.min(1.25, devDpr);
    canvas.width = Math.round(SW * dpr);
    canvas.height = Math.round(SH * dpr);
    canvas.style.width = `${SW}px`;
    canvas.style.height = `${SH}px`;
    placeControls();
  }

  // ───────────── State shared by both modes ─────────────
  const chat = [];
  let paused = false;
  let over = false;
  let raf = 0;
  let topId = 0; // who is first right now (their name is drawn in gold)
  let throwLevel = 0;
  let bestRank = 99;
  const input = { dx: 1, dy: 0, m: 0, throwing: false };
  const cam = { x: WORLD / 2, y: WORLD / 2, s: 1, ready: false };
  let userZoom = clamp(Number(storage.get('mfb-zoom')) || 1, ZOOM_MIN, ZOOM_MAX);

  /** A short note that floats up in the middle (what you ate, +100, coins…), not in the chat. */
  function popText(text) {
    const el = document.createElement('div');
    el.textContent = text;
    popEl.appendChild(el);
    while (popEl.children.length > 3) popEl.firstChild.remove();
    setTimeout(() => el.remove(), 1600);
  }

  /** The chat shows players' messages only. */
  function say(text, color = '#e2e8f0') {
    if (!settings.chat) return;
    chat.push({ text, color });
    while (chat.length > 5) chat.shift();
    chatEl.innerHTML = chat.map((m) => `<div style="color:${m.color}">${m.text}</div>`).join('');
  }

  // ───────────── Practice: the world runs here ─────────────
  function practiceDriver() {
    const FOOD = settings.quality === 'low' ? 4500 : settings.quality === 'high' ? 7000 : 6000;
    const world = createWorld({ bots: 30, food: FOOD });
    const me = world.addOwner({ name: player.name || 'أنت', skin: profile.skin || 'classic', mass: START_MASS, level: profile.level || 1 });
    const d = {
      online: false,
      ready: true,
      meId: me.id,
      get time() { return world.time; },
      alive: () => !me.dead,
      mine: () => me.cells,
      cells: () => world.cells,
      pellets: () => world.pellets,
      viruses: () => world.viruses,
      orbs: () => world.orbs,
      foodEach: (x0, y0, x1, y1, fn) => world.foods.each(x0, y0, x1, y1, fn),
      ping: () => null,
      ranking() {
        return world.ranking().map((r) => ({ id: r.o.id, name: r.o.name, m: r.m, me: r.o === me }));
      },
      dots() {
        const out = [];
        for (const o of world.owners) if (o !== me && !o.dead) out.push(world.centerOf(o));
        return out;
      },
      update(dt) {
        if (paused && !over) return;
        me.dir = { x: input.dx, y: input.dy, m: over ? 0 : input.m };
        me.throwing = input.throwing && !over;
        me.throwLevel = throwLevel;
        world.step(dt);
        for (const ev of world.events.splice(0)) {
          if (ev.type === 'kill') {
            if (ev.victim === me) {
              died({ killer: ev.killer ? ev.killer.name : null, maxMass: me.stats.maxMass, eaten: me.stats.eaten, secs: world.time - me.stats.born, counts: false });
            } else if (ev.killer === me) {
              popText(`🍽️ ${ev.victim.name}`);
              if (haptic) haptic('medium');
            } else if (ev.killer && ev.killer.bot && Math.random() < 0.2) {
              say(`<b>${escName(ev.killer.name)}:</b> ${pick(BOT_TAUNTS)}`, '#cbd5e1');
            }
          } else if (ev.type === 'orb' && ev.owner === me) {
            popText('+100');
          } else if (ev.type === 'pop' && ev.owner === me && haptic) {
            haptic('heavy');
          }
        }
      },
      split(x, y) { if (world.split(me, x, y) && haptic) haptic('light'); },
      sendChat(text) {
        say(`<b>${escName(me.name)}:</b> ${escName(text)}`, '#22e3ff');
        if (Math.random() < 0.6) {
          setTimeout(() => {
            const alive = world.owners.filter((o) => o.bot && !o.dead);
            if (alive.length && !over) say(`<b>${escName(pick(alive).name)}:</b> ${pick(BOT_REPLIES)}`, '#cbd5e1');
          }, rand(900, 2200));
        }
      },
      respawn(revenge, killerName) {
        const k = revenge && killerName ? world.owners.find((o) => o.name === killerName && !o.dead) : null;
        world.respawn(me, revenge ? REVENGE_MASS : START_MASS, k ? world.centerOf(k) : null);
        return k ? killerName : null;
      },
      close() {},
    };
    if (/[?&]demo=1/.test(location.search)) window.__mfbGame = { world, me, owners: world.owners, you: () => me, viruses: world.viruses, orbs: world.orbs, WORLD };
    return d;
  }

  // ───────────── Online: the world runs on the server ─────────────
  function onlineDriver(info) {
    const owners = new Map(); // id → { id, name, skin, hue, color }
    const cells = new Map(); // id → cell drawn between server updates
    const pellets = new Map();
    const foods = new FoodGrid();
    let viruses = [];
    let orbs = [];
    let ranking = [];
    let dots = [];
    let meId = 0;
    let alive = false;
    let rtt = null;
    let lastIn = 0;
    let sentThrow = false;
    let sentLevel = 0;
    let closedByUs = false;
    const ownerOf = (id) => {
      let o = owners.get(id);
      if (!o) { o = { id, name: '…', skin: 'classic', hue: 200, color: hueColor(200) }; owners.set(id, o); }
      return o;
    };

    const ws = new WebSocket(info.url);
    const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
    ws.onopen = () => send({ t: 'hello', initData: info.initData, v: 1 });
    ws.onclose = (e) => {
      d.ready = false;
      clearInterval(pinger);
      if (closedByUs) return;
      disconnected(e.reason || '');
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 's') onSnapshot(msg);
      else if (msg.t === 'f') {
        for (const id of msg.fr) foods.remove(id);
        const fa = msg.fa;
        for (let i = 0; i < fa.length; i += 4) foods.add({ id: fa[i], x: fa[i + 1], y: fa[i + 2], c: fa[i + 3], r: foodRadius(fa[i]) });
        addPellets(msg.pa);
        for (const id of msg.pr) pellets.delete(id);
      } else if (msg.t === 'ow') addOwners(msg.ow);
      else if (msg.t === 'lb') {
        ranking = msg.r.map(([id, m]) => ({ id, name: ownerOf(id).name, m, me: id === meId }));
        if (msg.me && msg.me[0] > 8) ranking.push({ name: ownerOf(meId).name, m: msg.me[1], me: true, rank: msg.me[0] });
        dots = [];
        for (let i = 0; i < msg.mm.length; i += 4) if (msg.mm[i] !== meId) dots.push({ x: msg.mm[i + 1], y: msg.mm[i + 2], m: msg.mm[i + 3] });
      } else if (msg.t === 'welcome') {
        meId = msg.you;
        d.meId = meId;
        foods.clear();
        const f = msg.food;
        for (let i = 0; i < f.length; i += 4) foods.add({ id: f[i], x: f[i + 1], y: f[i + 2], c: f[i + 3], r: foodRadius(f[i]) });
        pellets.clear();
        addPellets(msg.pellets || []);
        d.ready = true;
        alive = true;
        hideOverlay();
      } else if (msg.t === 'chat') {
        say(`<b style="color:${hueColor(msg.h)}">${escName(msg.n)}:</b> ${escName(msg.x)}`, '#e2e8f0');
      } else if (msg.t === 'ev') {
        if (msg.e === 'orb') popText('+100');
        else if (msg.e === 'ate') {
          popText(`🍽️ ${msg.n}${msg.coins ? ` · +${msg.coins} MF` : ''}`);
          if (msg.coins) opts.onCoins?.(msg.coins, msg.lv);
          if (msg.up) setTimeout(() => popText(`⭐ لفل ${msg.lv}!`), 900);
          if (haptic) haptic('medium');
        } else if (msg.e === 'pop' && haptic) haptic('heavy');
      } else if (msg.t === 'dead') {
        alive = false;
        died({ killer: msg.k, maxMass: msg.mx, eaten: msg.ea, secs: msg.sec, counts: true });
      } else if (msg.t === 'pong') {
        const now = performance.now() - msg.c;
        rtt = rtt == null ? now : rtt * 0.7 + now * 0.3;
      } else if (msg.t === 'err') {
        closedByUs = true;
        ws.close();
        disconnected(msg.msg || 'تعذّر الدخول');
      }
    };
    const pinger = setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);

    function addOwners(list) {
      for (const [id, name, skin, hue, level] of list) {
        const o = owners.get(id);
        if (o) Object.assign(o, { name, skin, hue, level, color: hueColor(hue) }); // same object, so cells update too
        else owners.set(id, { id, name, skin, hue, level, color: hueColor(hue) });
      }
    }
    // Thrown mass comes once, with its throw; it flies on the same curve as on the server.
    function addPellets(list) {
      const now = performance.now();
      for (let i = 0; i < list.length; i += 7) {
        const p = { id: list[i], x0: list[i + 1], y0: list[i + 2], vx: list[i + 3], vy: list[i + 4], hue: list[i + 5], born: now - list[i + 6], r: pelletRadius };
        const at = pelletAt(p, (now - p.born) / 1000);
        p.x = at.x;
        p.y = at.y;
        pellets.set(p.id, p);
      }
    }
    function onSnapshot(msg) {
      if (msg.ow) addOwners(msg.ow);
      const seen = new Set();
      const c = msg.c;
      for (let i = 0; i < c.length; i += 5) {
        const id = c[i];
        seen.add(id);
        const r = rad(c[i + 4]);
        let cell = cells.get(id);
        if (!cell) {
          cell = { id, x: c[i + 2], y: c[i + 3], r, m: c[i + 4], tx: c[i + 2], ty: c[i + 3], tr: r, owner: ownerOf(c[i + 1]) };
          cells.set(id, cell);
        }
        cell.tx = c[i + 2];
        cell.ty = c[i + 3];
        cell.tr = r;
        cell.m = c[i + 4];
        cell.owner = ownerOf(c[i + 1]);
      }
      for (const id of cells.keys()) if (!seen.has(id)) cells.delete(id);
      const old = new Map(viruses.map((v) => [v.id, v]));
      viruses = [];
      for (let i = 0; i < msg.v.length; i += 4) {
        const v = old.get(msg.v[i]) || { id: msg.v[i], x: msg.v[i + 1], y: msg.v[i + 2], r: msg.v[i + 3] };
        v.tx = msg.v[i + 1];
        v.ty = msg.v[i + 2];
        v.r = msg.v[i + 3];
        viruses.push(v);
      }
      orbs = [];
      for (let i = 0; i < msg.o.length; i += 3) orbs.push({ id: msg.o[i], x: msg.o[i + 1], y: msg.o[i + 2], r: 26, ph: msg.o[i] });
      alive = !!msg.al;
    }

    let t = 0;
    const d = {
      online: true,
      ready: false,
      meId: 0,
      get time() { return t; },
      alive: () => alive,
      mine() {
        const out = [];
        for (const c of cells.values()) if (c.owner.id === meId) out.push(c);
        return out;
      },
      cells: () => cells.values(),
      pellets: () => pellets.values(),
      viruses: () => viruses,
      orbs: () => orbs,
      foodEach: (x0, y0, x1, y1, fn) => foods.each(x0, y0, x1, y1, fn),
      ping: () => rtt,
      ranking: () => ranking,
      dots: () => dots,
      update(dt) {
        t += dt;
        // Glide towards the latest server positions (the server sends 20 updates a second).
        // Your own pieces are drawn a little ahead, the way you are steering, so turning
        // answers at once instead of after the round trip to the server.
        const k = 1 - Math.exp(-dt * 16);
        const lead = clamp((rtt || 80) / 2000 + 0.06, 0.06, 0.35);
        const dl = Math.hypot(input.dx, input.dy) || 1;
        const steer = paused || over ? 0 : input.m;
        for (const c of cells.values()) {
          let tx = c.tx, ty = c.ty;
          if (c.owner.id === meId && steer > 0) {
            const ahead = speedOf(c.m) * steer * lead;
            tx += (input.dx / dl) * ahead;
            ty += (input.dy / dl) * ahead;
          }
          c.x += (tx - c.x) * k;
          c.y += (ty - c.y) * k;
          c.r += (c.tr - c.r) * k;
        }
        for (const v of viruses) { v.x += (v.tx - v.x) * k; v.y += (v.ty - v.y) * k; }
        const now = performance.now();
        for (const p of pellets.values()) {
          const age = (now - p.born) / 1000;
          if (age < 3.2) { const at = pelletAt(p, age); p.x = at.x; p.y = at.y; }
        }
        if (d.ready && now - lastIn > 50) {
          lastIn = now;
          const m = paused || over ? 0 : input.m;
          send({ t: 'in', x: Math.round(input.dx * 100) / 100, y: Math.round(input.dy * 100) / 100, m: Math.round(m * 100) / 100, hw: Math.round(SW / 2 / cam.s), hh: Math.round(SH / 2 / cam.s) });
        }
        const throwing = input.throwing && !over && !paused;
        if (throwing !== sentThrow || throwLevel !== sentLevel) {
          sentThrow = throwing;
          sentLevel = throwLevel;
          send({ t: 'throw', on: throwing, lv: throwLevel });
        }
      },
      split(x, y) { send({ t: 'split', x, y }); if (haptic) haptic('light'); },
      sendChat(text) { send({ t: 'chat', x: text }); },
      respawn(revenge) { send({ t: 'spawn', rv: !!revenge }); return null; },
      close() { closedByUs = true; clearInterval(pinger); try { ws.close(); } catch (e) { /* already closed */ } },
    };
    showOverlay('<h2>🌐 جاري الاتصال…</h2><p>ندخلك غرفة الأونلاين ويّا المطورين.</p><div class="spin" style="margin:6px auto"></div><div class="g-row"><button class="btn" data-quit>✕ إلغاء</button></div>')
      .querySelector('[data-quit]').onclick = exit;
    return d;
  }

  function disconnected(reason) {
    over = true;
    const c = showOverlay(`<h2>📡 انقطع الاتصال</h2><p>${escName(reason || 'ما كدرنا نوصل لسيرفر الأونلاين.')}</p>
      <div class="g-row"><button class="btn btn-hot" data-retry>🔁 حاول مرة ثانية</button><button class="btn btn-cyan" data-practice>🤖 تدريب</button><button class="btn" data-quit>🏠 القائمة</button></div>`);
    c.querySelector('[data-retry]').onclick = () => { hideOverlay(); start(opts.online); };
    c.querySelector('[data-practice]').onclick = () => { hideOverlay(); start(null); };
    c.querySelector('[data-quit]').onclick = exit;
  }

  let D = null;
  function start(online) {
    if (D) D.close();
    over = false;
    paused = false;
    bestRank = 99;
    cam.ready = false;
    cam.sReady = false;
    chat.length = 0;
    chatEl.innerHTML = '';
    D = online && online.url ? onlineDriver(online) : practiceDriver();
  }

  // ───────────── Camera & drawing ─────────────
  let mineCache = [];
  function draw(dt) {
    const mine = mineCache = D.ready ? D.mine() : [];
    let tot = 0;
    if (mine.length) {
      let cx = 0, cy = 0;
      for (const c of mine) { cx += c.x * c.m; cy += c.y * c.m; tot += c.m; }
      cx /= tot; cy /= tot;
      if (!cam.ready) { cam.x = cx; cam.y = cy; cam.ready = true; }
      const k = 1 - Math.exp(-dt * 10);
      cam.x += (cx - cam.x) * k;
      cam.y += (cy - cam.y) * k;
    }
    // The view depends on your total size only (not on how spread out you are), and you
    // set how close it is with + / − or two fingers.
    // About 620 world units tall when you start, ~3000 at 2k mass, ~4400 at 5k.
    const viewH = Math.min(9500, 620 * Math.pow(Math.max(START_MASS, tot || START_MASS) / START_MASS, 0.35));
    const base = SH / viewH;
    const target = base * userZoom;
    if (!cam.sReady) { cam.s = target; cam.sReady = true; }
    cam.s += (target - cam.s) * (1 - Math.exp(-dt * 4));
    const s = cam.s;
    const time = D.time;

    const dark = settings.darkMode;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? '#0b0d17' : '#eef1f7';
    ctx.fillRect(0, 0, SW, SH);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (SW / 2 - cam.x * s), dpr * (SH / 2 - cam.y * s));
    const vx0 = cam.x - SW / 2 / s, vx1 = cam.x + SW / 2 / s;
    const vy0 = cam.y - SH / 2 / s, vy1 = cam.y + SH / 2 / s;

    // A faint grid only (the sections are on the mini map, not drawn on the ground).
    const gs = s < 0.2 ? 240 : 60;
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    for (let x = Math.max(0, Math.floor(vx0 / gs) * gs); x <= Math.min(WORLD, vx1); x += gs) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(WORLD, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / gs) * gs); y <= Math.min(WORLD, vy1); y += gs) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(WORLD, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 6 / s;
    ctx.strokeRect(0, 0, WORLD, WORLD);

    const vis = (x, y, r) => x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
    // Food: one path per colour.
    const buckets = FOOD_COLORS.map(() => []);
    D.foodEach(vx0 - 10, vy0 - 10, vx1 + 10, vy1 + 10, (f) => buckets[f.c].push(f));
    for (let i = 0; i < buckets.length; i++) {
      const list = buckets[i];
      if (!list.length) continue;
      ctx.fillStyle = FOOD_COLORS[i];
      ctx.beginPath();
      for (const f of list) { ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, 6.2832); }
      ctx.fill();
    }
    const orb = getOrbSprite();
    for (const b of D.orbs()) {
      if (!vis(b.x, b.y, b.r * 1.6)) continue;
      const k = 1 + Math.sin(time * 4 + b.ph) * 0.08;
      const size = orb.size * k;
      ctx.drawImage(orb.canvas, b.x - size / 2, b.y - size / 2, size, size);
    }
    // Thrown mass: one path per colour.
    const pel = new Map();
    for (const p of D.pellets()) {
      if (!vis(p.x, p.y, p.r)) continue;
      let list = pel.get(p.hue);
      if (!list) { list = []; pel.set(p.hue, list); }
      list.push(p);
    }
    for (const [hue, list] of pel) {
      ctx.fillStyle = hueColor(hue);
      ctx.beginPath();
      for (const p of list) { ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, 6.2832); }
      ctx.fill();
    }

    // Cells and viruses together, smallest first: whoever is bigger is drawn on top, so a
    // small piece can hide under a virus and a big one covers it.
    const things = [];
    for (const c of D.cells()) if (vis(c.x, c.y, c.r)) things.push(c);
    for (const v of D.viruses()) if (vis(v.x, v.y, v.r + 10)) things.push({ virus: true, x: v.x, y: v.y, r: v.r });
    things.sort((a, b) => a.r - b.r);
    const glow = settings.quality === 'high';
    const meId = D.meId;
    for (const c of things) {
      if (c.virus) { drawVirus(c, time); continue; }
      const own = c.owner;
      const isMe = own.id === meId;
      const sprite = skinSprite(own.skin);
      if (glow) { ctx.shadowColor = isMe ? 'rgba(34,227,255,0.6)' : 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; }
      if (sprite) {
        ctx.drawImage(sprite, c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
      } else {
        ctx.fillStyle = own.color;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, c.r * 0.06);
      ctx.strokeStyle = isMe ? '#22e3ff' : own.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, 6.2832);
      ctx.stroke();
      if (c.r * s > 14) {
        const fs = Math.max(12 / s, c.r * 0.34);
        ctx.font = `900 ${fs}px Cairo, Tahoma, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = fs * 0.18;
        const first = own.id === topId;
        // First place: gold name with a dark outline so it stands out on any skin.
        ctx.lineWidth = fs * (first ? 0.26 : 0.18);
        ctx.strokeStyle = first ? 'rgba(60,30,0,0.95)' : 'rgba(0,0,0,0.75)';
        ctx.fillStyle = first ? '#ffd34d' : '#fff';
        ctx.strokeText(own.name, c.x, c.y);
        ctx.fillText(own.name, c.x, c.y);
        if (c.r * s > 26) {
          const ms = fs * 0.6;
          ctx.font = `800 ${ms}px Cairo, Tahoma, sans-serif`;
          ctx.strokeText(short(c.m), c.x, c.y + fs * 0.9);
          ctx.fillText(short(c.m), c.x, c.y + fs * 0.9);
        }
        // Level badge: a green star with the number, next to the name.
        if (own.level && c.r * s > 22) {
          ctx.font = `900 ${fs}px Cairo, Tahoma, sans-serif`;
          const w = Math.min(c.r * 1.5, ctx.measureText(own.name).width);
          drawLevel(c.x + w / 2 + fs * 0.45, c.y - fs * 0.1, fs * 0.5, own.level);
        }
      }
    }

    // The arrow: which way you are heading, just outside your biggest piece.
    if (mine.length && input.m > 0.08 && !over) {
      let big = mine[0];
      for (const c of mine) if (c.r > big.r) big = c;
      const a = Math.atan2(input.dy, input.dx);
      const dist = big.r + 16 / s;
      const size = 13 / s;
      const ax = big.x + Math.cos(a) * dist;
      const ay = big.y + Math.sin(a) * dist;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = dark ? 'rgba(226,232,240,0.85)' : 'rgba(51,65,85,0.8)';
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.7, -size * 0.8);
      ctx.lineTo(-size * 0.7, size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawVirus(v, time) {
    ctx.fillStyle = '#33e06a';
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = Math.max(4, v.r * 0.06);
    ctx.beginPath();
    const spikes = 22;
    for (let i = 0; i <= spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + time * 0.2;
      const rr = i % 2 ? v.r : v.r + v.r * 0.1;
      const px = v.x + Math.cos(a) * rr;
      const py = v.y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawLevel(x, y, size, level) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#16a34a';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = size * 0.1;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? size * 0.45 : size;
      if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${size * 0.72}px Cairo, Tahoma, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(level), 0, size * 0.08);
    ctx.restore();
  }

  // ───────────── HUD ─────────────
  let hudT = 0;
  let fpsN = 0;
  let fpsT = 0;
  let fps = 0;
  function drawHud(dt) {
    fpsN++;
    fpsT += dt;
    if (fpsT >= 0.5) {
      fps = Math.round(fpsN / fpsT);
      fpsN = 0;
      fpsT = 0;
      const p = D.ping();
      netEl.textContent = D.online ? `${fps}fps · ${p == null ? '--' : Math.round(p)}ms` : `${fps}fps · تدريب`;
      ctl.net.classList.toggle('bad', fps < 30 || (p != null && p > 180));
    }
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.25;
    const mine = mineCache;
    const myMass = mine.reduce((s, c) => s + c.m, 0);
    massEl.textContent = `الكتلة: ${Math.round(myMass).toLocaleString('en-US')}`;
    const ranked = D.ranking();
    const myIdx = ranked.findIndex((r) => r.me);
    const myRank = myIdx < 0 ? 0 : ranked[myIdx].rank || myIdx + 1;
    if (myRank && myRank < bestRank) bestRank = myRank;
    topId = ranked[0] ? ranked[0].id || 0 : 0;
    const row = (r, i) => `<li class="${r.me ? 'me' : ''} ${(r.rank || i + 1) === 1 ? 'gold' : ''}"><span>${r.rank || i + 1}. ${escName(r.name)}</span><b>${short(r.m)}</b></li>`;
    lbEl.innerHTML = ranked.slice(0, 8).map(row).join('') + (myIdx >= 8 ? row(ranked[myIdx], myIdx) : '');

    // Mini map: 3×3 numbered sections; you see who is in your section only.
    const mc = mapCanvas.getContext('2d');
    const W = mapCanvas.width;
    const k = W / WORLD;
    const cell = W / MAP_SECTIONS;
    const mySec = sectionOf(cam.x, cam.y);
    mc.clearRect(0, 0, W, W);
    mc.fillStyle = 'rgba(255,255,255,0.05)';
    mc.fillRect(0, 0, W, W);
    mc.font = `900 ${cell * 0.42}px Cairo, Tahoma, sans-serif`;
    mc.textAlign = 'center';
    mc.textBaseline = 'middle';
    for (let r = 0; r < MAP_SECTIONS; r++) {
      for (let c = 0; c < MAP_SECTIONS; c++) {
        const n = r * MAP_SECTIONS + c + 1;
        if (n === mySec) { mc.fillStyle = 'rgba(34,227,255,0.16)'; mc.fillRect(c * cell, r * cell, cell, cell); }
        mc.fillStyle = n === mySec ? 'rgba(34,227,255,0.9)' : 'rgba(255,255,255,0.35)';
        mc.fillText(String(n), c * cell + cell / 2, r * cell + cell / 2);
      }
    }
    mc.strokeStyle = 'rgba(255,255,255,0.22)';
    mc.lineWidth = 1;
    mc.beginPath();
    for (let i = 1; i < MAP_SECTIONS; i++) {
      mc.moveTo(i * cell, 0); mc.lineTo(i * cell, W);
      mc.moveTo(0, i * cell); mc.lineTo(W, i * cell);
    }
    mc.stroke();
    for (const o of D.dots()) {
      if (sectionOf(o.x, o.y) !== mySec) continue;
      mc.fillStyle = o.m > myMass * EAT_RATIO ? '#ff3b6b' : '#a3ff3a';
      mc.beginPath();
      mc.arc(o.x * k, o.y * k, Math.max(2, Math.min(6, Math.sqrt(o.m) * 0.08)), 0, 6.2832);
      mc.fill();
    }
    mc.fillStyle = '#22e3ff';
    for (const c of mine) { mc.beginPath(); mc.arc(c.x * k, c.y * k, 3.5, 0, 6.2832); mc.fill(); }
  }

  // ───────────── Input ─────────────
  function aim() {
    return { x: input.dx, y: input.dy };
  }
  let joy = null;
  let throwPointer = null;
  const free = new Map(); // fingers on empty ground (two of them = pinch to zoom)
  let pinch = null;

  function setZoom(z, tip = true) {
    userZoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    storage.set('mfb-zoom', String(userZoom.toFixed(3)));
    if (!tip) return;
    zoomTip.textContent = `🔍 ${Math.round(userZoom * 100)}%`;
    zoomTip.hidden = false;
    clearTimeout(setZoom.t);
    setZoom.t = setTimeout(() => { zoomTip.hidden = true; }, 900);
  }

  function setJoy(pt) {
    const dx = pt.x - joy.cx;
    const dy = pt.y - joy.cy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(1, d / joy.r);
    if (d > 2) { input.dx = dx; input.dy = dy; }
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
      const r = placeIn(SAFE, byId.joystick, layout.joystick);
      joy = { id: e.pointerId, cx: r.left + r.w / 2, cy: r.top + r.h / 2, r: size * 0.42 };
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
    if (t.closest && (t.closest('.g-top') || t.closest('.g-chatbar') || t.closest('.g-zbtn') || t.closest('.g-overlay'))) return;
    const at = toStage(e.clientX, e.clientY);
    const id = t.closest && t.closest('[data-id]') ? t.closest('[data-id]').dataset.id : null;
    if (id === 'split') { e.preventDefault(); const a = aim(); D.split(a.x, a.y); pulse(ctl.split); return; }
    if (id === 'throw') { e.preventDefault(); input.throwing = true; pulse(ctl.throw); throwPointer = e.pointerId; return; }
    if (id === 'double') {
      e.preventDefault();
      setThrowLevel((throwLevel + 1) % THROW_SPEEDS.length);
      pulse(ctl.double);
      return;
    }
    if (id === 'chat') { e.preventDefault(); openChat(); return; }
    if (e.pointerType === 'mouse') return;
    const onJoy = id === 'joystick';
    const leftSide = at.x < SW * 0.45;
    if (!joy && (onJoy || (settings.joystick === 'floating' && leftSide && !id))) {
      e.preventDefault();
      startJoy(e, at);
      return;
    }
    if (!id) {
      free.set(e.pointerId, at);
      if (free.size === 2) {
        const [a, b] = [...free.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: userZoom };
      }
    }
  }
  function onMove(e) {
    if (joy && e.pointerId === joy.id) { setJoy(toStage(e.clientX, e.clientY)); return; }
    if (free.has(e.pointerId)) {
      free.set(e.pointerId, toStage(e.clientX, e.clientY));
      if (pinch && free.size === 2) {
        const [a, b] = [...free.values()];
        setZoom(pinch.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
      }
      return;
    }
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
    if (free.delete(e.pointerId)) pinch = null;
  }
  function onKey(e) {
    if (over || document.activeElement === chatInput) return;
    if (e.code === 'Space' && e.type === 'keydown') { e.preventDefault(); const a = aim(); D.split(a.x, a.y); }
    if (e.code === 'KeyW') input.throwing = e.type === 'keydown';
    if (e.code === 'Enter' && e.type === 'keydown' && settings.chat) openChat();
    if (e.code === 'Escape' && e.type === 'keydown') togglePause();
  }
  function onWheel(e) {
    e.preventDefault();
    setZoom(userZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  ctl.zoom.querySelectorAll('.g-zbtn').forEach((b) => {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      setZoom(userZoom * (b.dataset.z === '1' ? 1.2 : 1 / 1.2));
      pulse(b);
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
    if (text) D.sendChat(text);
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
    releaseJoy();
    input.throwing = false;
    const mass = Math.round(mineCache.reduce((s, c) => s + c.m, 0)).toLocaleString('en-US');
    const card = showOverlay(`<h2>⏸ ${D.online ? 'استراحة' : 'متوقف'}</h2><p>الكتلة الحالية ${mass}${D.online ? '<br><small>بالأونلاين اللعبة ما توقف: كتلتك واقفة بمكانها.</small>' : ''}</p>
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
      // If you were eaten while editing, the death card is up: leave it there.
      if (!over) hideOverlay();
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
  function died(info) {
    over = true;
    paused = false;
    input.throwing = false;
    releaseJoy();
    closeChat();
    if (haptic) haptic('heavy');
    const secs = Math.round(info.secs || 0);
    const mm = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');

    const card = () => {
      const c = showOverlay(`<div class="g-dead-skin">${skinSVG(profile.skin || 'classic', 88)}</div>
        <h2>انأكلت! 💀</h2>
        <p>${info.killer ? `أكلك <b>${escName(info.killer)}</b>` : 'انتهت الجولة'}</p>
        <div class="g-stats">
          <div><small>أعلى كتلة</small><b>${Math.round(info.maxMass || 0).toLocaleString('en-US')}</b></div>
          <div><small>الوقت</small><b>${mm}:${ss}</b></div>
          <div><small>أكلت لاعبين</small><b>${info.eaten || 0}</b></div>
          <div><small>أفضل ترتيب</small><b>#${bestRank === 99 ? '-' : bestRank}</b></div>
        </div>
        ${ads.reward ? `<button class="btn g-revenge" data-revenge>🔥 الانتقام والبدء بـ ${REVENGE_MASS} <small>📺 شاهد إعلان</small></button>` : ''}
        <p class="g-note" data-msg>${info.counts ? 'جولة أونلاين: انحسبت بالترتيب الأسبوعي ✅' : 'جولة تدريب ضد بوتات، ما تنحسب بالترتيب الأسبوعي.'}</p>
        <div class="g-row"><button class="btn btn-hot" data-again>🔁 العب من جديد</button><button class="btn" data-quit>🏠 القائمة</button></div>`);
      c.querySelector('[data-again]').onclick = () => {
        hideOverlay();
        beforeRound(() => { over = false; bestRank = 99; D.respawn(false); });
      };
      c.querySelector('[data-quit]').onclick = exit;
      const rev = c.querySelector('[data-revenge]');
      if (rev) {
        rev.onclick = async () => {
          rev.disabled = true;
          try {
            await showAd(ads.reward);
            storage.set(NO_AD_KEY, '0'); // a watched reward ad counts as the ad
            hideOverlay();
            over = false;
            const near = D.respawn(true, info.killer);
            popText(`🔥 الانتقام! ${REVENGE_MASS}${near ? ` · ${near}` : ''}`);
          } catch (err) {
            rev.disabled = false;
            c.querySelector('[data-msg]').textContent = err && err.message ? err.message : 'ما اكو إعلان هسه، جرّب بعد شوية';
          }
        };
      }
    };

    setTimeout(() => { if (over) card(); }, 900);
  }

  // Ads: after 3 matches in a row without any ad, the 4th starts with one (no reward).
  // Kept on the phone, so it carries over between visits.
  const NO_AD_KEY = 'mfb-rounds-no-ad';
  function beforeRound(go) {
    const n = Number(storage.get(NO_AD_KEY)) || 0;
    if (n < 3 || !ads.interstitial) {
      storage.set(NO_AD_KEY, String(n + 1));
      go();
      return;
    }
    showOverlay('<h2>📺 إعلان قصير</h2><p>بعده تبدأ الجولة.</p><div class="spin" style="margin:6px auto"></div>');
    Promise.resolve()
      .then(() => showAd(ads.interstitial))
      .catch(() => { /* no ad right now: just play */ })
      .finally(() => {
        storage.set(NO_AD_KEY, '1');
        hideOverlay();
        go();
      });
  }

  let lastT = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    D.update(dt);
    draw(dt);
    drawHud(dt);
  }

  function exit() {
    cancelAnimationFrame(raf);
    if (D) D.close();
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
  setThrowLevel(0);
  beforeRound(() => start(opts.online));
  raf = requestAnimationFrame(frame);

  return {
    resize,
    back() {
      if (over) exit();
      else togglePause();
    },
    exit,
  };
}

