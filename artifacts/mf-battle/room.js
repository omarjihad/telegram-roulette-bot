// MF Battle online room. One shared world (the same rules as offline practice, from sim.js)
// runs here; players send their joystick / split / throw and get back what is around them
// 20 times a second. Plain JavaScript with no server library, so the same room runs on
// the bot's Node server (Railway) and on a Cloudflare Durable Object (close to the players).
//
// A "socket" here is anything with: send(text), close(code, reason), isOpen(), buffered().
// report (optional): ({lead, current, players}) → Promise<{tour}> every few seconds — who led
// the room among real players (for tournaments); tour = the running tournament, or null.
// A "who" (from authenticate) is: { telegramId, name, skin, level?, startMass?, canThrow?(lv),
//   record?({mass, seconds}) → Promise, onKill?(victimMass) → Promise<{coins, level, levelUp}|null> }.

import { createWorld, REVENGE_MASS, START_MASS, THROW_SPEEDS } from './sim.js';

const TICK_MS = 25; // the world moves 40 times a second
const SEND_EVERY = 2; // and each player gets an update every second tick (20 a second)
const ROOM_BOTS = 30;
const SLOW_CLIENT_BYTES = 96 * 1024; // a phone this far behind skips position updates until it catches up
const MAX_PLAYERS = 30;
const HELLO_TIMEOUT_MS = 10000;
const REPORT_MS = 3000;
const BOT_REPLIES = ['😂😂', 'شكو؟', 'تعال اذا رجّال 😤', 'GG', 'هسه اجيك 👀', 'هههه', 'ماكو مثلي 😎', 'منو انت؟', 'لا تهرب 🏃', '👍'];

const num = (v, min, max, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
// eslint-disable-next-line no-control-regex
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const r1 = (n) => Math.round(n);
const ownerRow = (o) => [o.id, o.name, o.skin, o.hue, o.level];
/** A pellet as [id, x0, y0, vx, vy, hue, age in ms, mass] — enough for the phone to draw its flight. */
const pelletRow = (p, now) => [p.id, r1(p.x0), r1(p.y0), r1(p.vx), r1(p.vy), p.hue, r1((now - p.born) * 1000), r1(p.m)];

export class BattleRoom {
  constructor({ bots = ROOM_BOTS, log = () => {}, report = null } = {}) {
    this.bots = bots;
    this.world = createWorld({ bots, trackNet: true });
    this.clients = new Set();
    this.log = log;
    this.report = report;
    this.leadAcc = new Map(); // telegramId -> { name, s: seconds first, m: best mass } since the last report
    this.current = null; // the real player who is first right now
    this.tour = null; // the running tournament, as the last report said
    this.tourSeen = null; // id of the last tournament this room started over for
    this.lastReport = 0;
    this.reporting = false;
    this.timer = null;
    this.tickN = 0;
    this.lastTick = 0;
    this.lastBoard = 0;
  }

  get players() { return this.clients.size; }

  join(ws, who) {
    // The same account on a second phone/tab replaces the first one.
    for (const c of this.clients) {
      if (c.who.telegramId === who.telegramId) {
        this.leave(c);
        c.ws.close(4000, 'دخلت من مكان ثاني');
      }
    }
    if (this.clients.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'err', msg: 'الغرفة مليانة، جرّب بعد شوية' }));
      ws.close(4004, 'full');
      return null;
    }
    const owner = this.world.addOwner({ name: who.name, skin: who.skin, mass: who.startMass ?? START_MASS, level: who.level ?? 1 });
    const client = {
      ws,
      who,
      owner,
      view: { hw: 700, hh: 350 },
      known: new Set(),
      needsWelcome: true,
      lastChatAt: 0,
      lastCenter: this.world.centerOf(owner),
      canRevenge: false,
    };
    this.clients.add(client);
    this.start();
    return client;
  }

  leave(c) {
    if (!this.clients.delete(c)) return;
    if (!c.owner.dead) this.record(c);
    this.world.removeOwner(c.owner);
    if (!this.clients.size) this.stop();
  }

  handle(c, msg) {
    const o = c.owner;
    switch (msg.t) {
      case 'in':
        o.dir = { x: num(msg.x, -1e4, 1e4), y: num(msg.y, -1e4, 1e4), m: num(msg.m, 0, 1) };
        c.view = { hw: num(msg.hw, 200, 6000, 700), hh: num(msg.hh, 150, 6000, 350) };
        break;
      case 'split':
        this.world.split(o, num(msg.x, -1e4, 1e4, 1), num(msg.y, -1e4, 1e4, 0));
        break;
      case 'throw': {
        o.throwing = !!msg.on && !o.dead;
        // Only speeds the player has (bought, or opened by ads and not expired yet).
        let lv = Math.floor(num(msg.lv, 0, THROW_SPEEDS.length - 1));
        while (lv > 0 && c.who.canThrow && !c.who.canThrow(lv)) lv--;
        o.throwLevel = lv;
        break;
      }
      case 'chat': {
        const text = cleanText(msg.x, 60);
        const now = Date.now();
        if (!text || now - c.lastChatAt < 900) break;
        c.lastChatAt = now;
        // id: whose message it is, so the phones show it above that player's piece too.
        this.broadcast({ t: 'chat', n: c.who.name, x: text, h: o.hue, id: o.id });
        if (Math.random() < 0.3) {
          setTimeout(() => {
            const bots = this.world.owners.filter((b) => b.bot && !b.dead);
            if (bots.length && this.clients.size) {
              const b = bots[Math.floor(Math.random() * bots.length)];
              this.broadcast({ t: 'chat', n: b.name, x: BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)], h: b.hue, id: b.id });
            }
          }, 900 + Math.random() * 1500);
        }
        break;
      }
      case 'ping':
        this.send(c, { t: 'pong', c: num(msg.c, 0, 1e15) });
        break;
      case 'spawn': {
        if (!o.dead) break;
        // Revenge (after a watched reward ad): 500 mass, near whoever ate you. Once per death.
        const revenge = !!msg.rv && c.canRevenge;
        const killer = revenge && o.killer && !o.killer.dead ? o.killer : null;
        this.world.respawn(o, revenge ? REVENGE_MASS : c.who.startMass ?? START_MASS, killer ? this.world.centerOf(killer) : null);
        c.canRevenge = false;
        break;
      }
      default:
        break;
    }
  }

  start() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const w = this.world;
    w.step(dt);
    const byOwner = new Map();
    for (const c of this.clients) byOwner.set(c.owner, c);
    for (const ev of w.events.splice(0)) {
      if (ev.type === 'kill') {
        const victim = byOwner.get(ev.victim);
        if (victim) {
          victim.canRevenge = true;
          const s = ev.victim.stats;
          this.send(victim, { t: 'dead', k: ev.killer ? ev.killer.name : null, mx: r1(s.maxMass), ea: s.eaten, sec: r1(w.time - s.born) });
          this.record(victim);
        }
        const killer = ev.killer ? byOwner.get(ev.killer) : undefined;
        if (killer) this.reward(killer, ev.victim.name, ev.mass);
      } else {
        const c = byOwner.get(ev.owner);
        if (c) this.send(c, { t: 'ev', e: ev.type });
      }
    }
    this.tickN++;
    if (this.tickN % SEND_EVERY === 0) this.sendSnapshots();
    if (now - this.lastBoard >= 1000) {
      const seconds = this.lastBoard ? Math.min(2, (now - this.lastBoard) / 1000) : 1;
      this.lastBoard = now;
      const ranked = this.sendBoard();
      this.trackLeader(ranked, byOwner, seconds);
    }
  }

  sendSnapshots() {
    const w = this.world;
    // What changed on the ground since last time goes to everyone: food and thrown mass.
    // Pellets are sent once with their throw; the phones draw the same flight curve.
    const fa = [];
    for (const f of w.foodAdded) if (w.foods.byId.has(f.id)) fa.push(f.id, r1(f.x), r1(f.y), f.c);
    const pa = [];
    for (const p of w.pelletAdded) if (p.m > 0) pa.push(...pelletRow(p, w.time));
    const fr = w.foodRemoved.slice();
    const pr = w.pelletRemoved.slice();
    w.foodAdded.length = 0;
    w.foodRemoved.length = 0;
    w.pelletAdded.length = 0;
    w.pelletRemoved.length = 0;
    const delta = fa.length || fr.length || pa.length || pr.length ? JSON.stringify({ t: 'f', fa, fr, pa, pr }) : null;
    for (const c of this.clients) {
      if (!c.ws.isOpen()) continue;
      if (c.needsWelcome) {
        // The whole ground once; after that only what changed.
        const food = [];
        for (const f of w.foods.byId.values()) food.push(f.id, r1(f.x), r1(f.y), f.c);
        const pellets = [];
        for (const p of w.pellets) if (p.m > 0) pellets.push(...pelletRow(p, w.time));
        this.send(c, { t: 'welcome', you: c.owner.id, players: this.clients.size, food, pellets });
        c.needsWelcome = false;
      } else if (delta) {
        c.ws.send(delta);
      }
      // Positions are only worth sending if the phone keeps up; otherwise skip a beat.
      if (c.ws.buffered() > SLOW_CLIENT_BYTES) continue;
      if (!c.owner.dead && c.owner.cells.length) c.lastCenter = w.centerOf(c.owner);
      const { x, y } = c.lastCenter;
      const hw = c.view.hw + 300;
      const hh = c.view.hh + 300;
      const x0 = x - hw, x1 = x + hw, y0 = y - hh, y1 = y + hh;
      const inBox = (px, py, r) => px + r > x0 && px - r < x1 && py + r > y0 && py - r < y1;
      const cells = [];
      const ow = [];
      for (const cell of w.cells) {
        if (!inBox(cell.x, cell.y, cell.r)) continue;
        cells.push(cell.id, cell.owner.id, r1(cell.x), r1(cell.y), r1(cell.m));
        const key = `${cell.owner.id}:${cell.owner.ver}`;
        if (!c.known.has(key)) {
          c.known.add(key);
          ow.push(ownerRow(cell.owner));
        }
      }
      const viruses = [];
      const vl = []; // [id, loot] of viruses holding thrown mass (shown on them)
      for (const v of w.viruses) {
        if (!inBox(v.x, v.y, v.r)) continue;
        viruses.push(v.id, r1(v.x), r1(v.y), r1(v.r));
        if (v.loot >= 1) vl.push(v.id, r1(v.loot));
      }
      const orbs = [];
      for (const b of w.orbs) if (inBox(b.x, b.y, b.r)) orbs.push(b.id, r1(b.x), r1(b.y));
      // ts: when this picture of the world was taken (the phone draws between two of them).
      this.send(c, { t: 's', ts: Date.now(), c: cells, v: viruses, vl: vl.length ? vl : undefined, o: orbs, ow: ow.length ? ow : undefined, al: c.owner.dead ? 0 : 1 });
    }
  }

  /** Coins and level for eating someone; the killer's phone shows what they got. */
  reward(c, victimName, mass) {
    if (!c.who.onKill) {
      this.send(c, { t: 'ev', e: 'ate', n: victimName });
      return;
    }
    c.who.onKill(mass).then((got) => {
      if (got && got.level !== c.owner.level) {
        c.owner.level = got.level;
        c.owner.ver++; // so everyone gets the new level badge
      }
      this.send(c, { t: 'ev', e: 'ate', n: victimName, coins: got?.coins ?? 0, lv: got?.level, up: got?.levelUp ? 1 : 0 });
    }).catch((err) => {
      this.log('battle kill reward failed', err);
      this.send(c, { t: 'ev', e: 'ate', n: victimName });
    });
  }

  sendBoard() {
    const w = this.world;
    const ranked = w.ranking();
    const top = ranked.slice(0, 5).map((r) => [r.o.id, r1(r.m)]);
    const mm = [];
    for (const r of ranked) {
      const c = w.centerOf(r.o);
      mm.push(r.o.id, r1(c.x), r1(c.y), r1(r.m));
    }
    for (const c of this.clients) {
      const i = ranked.findIndex((r) => r.o === c.owner);
      const ow = [];
      for (const r of ranked.slice(0, 5)) {
        const key = `${r.o.id}:${r.o.ver}`;
        if (c.known.has(key)) continue;
        c.known.add(key);
        ow.push(ownerRow(r.o));
      }
      if (ow.length) this.send(c, { t: 'ow', ow });
      this.send(c, { t: 'lb', r: top, me: i >= 0 ? [i + 1, r1(ranked[i].m)] : null, mm });
    }
    return ranked;
  }

  /** Tournaments: who of the real players is first, and for how long (sent to the server). */
  trackLeader(ranked, byOwner, seconds) {
    if (!this.report) return;
    let top = null;
    for (const r of ranked) {
      const c = byOwner.get(r.o);
      if (c && !r.o.dead) { top = { c, m: r.m }; break; }
    }
    this.current = top ? { telegramId: top.c.who.telegramId, name: top.c.who.name, mass: r1(top.m) } : null;
    if (top && this.tour) {
      const id = top.c.who.telegramId;
      const e = this.leadAcc.get(id) || { name: top.c.who.name, s: 0, m: 0 };
      e.s += seconds;
      e.m = Math.max(e.m, top.m);
      this.leadAcc.set(id, e);
    }
    const now = Date.now();
    if (this.reporting || now - this.lastReport < REPORT_MS) return;
    this.lastReport = now;
    this.reporting = true;
    const lead = [];
    for (const [id, e] of this.leadAcc) lead.push([id, e.name, Math.round(e.s * 10) / 10, r1(e.m)]);
    this.leadAcc = new Map();
    Promise.resolve()
      .then(() => this.report({ lead, current: this.current, players: this.clients.size }))
      .then((res) => {
        const t = (res && res.tour) || null;
        // A tournament that just started: everyone starts over on a fresh map, fair for all.
        if (t && !t.done && t.id && t.id !== this.tourSeen) {
          this.tourSeen = t.id;
          if (Date.now() - (Number(t.startedAt) || 0) < 30000) this.startOver('🏆 بدت البطولة! الكل بدأ من جديد');
        }
        this.tour = t && !t.done ? t : null;
        if (!t) this.broadcast({ t: 'tour' });
        else if (t.done) this.broadcast({ t: 'tour', done: 1, m: t.mode, w: t.winner || null, until: t.until, pz: t.prize || '' });
        else this.broadcast({ t: 'tour', m: t.mode, end: t.endsAt, ld: t.leader || null, pz: t.prize || '' });
      })
      .catch((err) => this.log('battle leader report failed', err))
      .finally(() => { this.reporting = false; });
  }

  /** A brand-new map: new food, viruses and bots; every player starts again at their start size. */
  startOver(note) {
    for (const c of this.clients) if (!c.owner.dead) this.record(c);
    const old = this.world;
    this.world = createWorld({ bots: this.bots, trackNet: true });
    for (const c of this.clients) {
      c.owner = this.world.addOwner({ name: c.who.name, skin: c.who.skin, mass: c.who.startMass ?? START_MASS, level: c.owner.level ?? c.who.level ?? 1 });
      c.known = new Set();
      c.needsWelcome = true;
      c.canRevenge = false;
      c.lastCenter = this.world.centerOf(c.owner);
    }
    old.owners.length = 0;
    this.leadAcc = new Map();
    this.broadcast({ t: 'reset', x: note });
  }

  record(c) {
    const s = c.owner.stats;
    const seconds = this.world.time - s.born;
    if (!c.who.record || seconds < 5) return;
    c.who.record({ mass: s.maxMass, seconds }).catch((err) => this.log('battle match record failed', err));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.ws.isOpen()) c.ws.send(data);
  }

  send(c, msg) {
    if (c.ws.isOpen()) c.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stop();
    for (const c of this.clients) c.ws.close(1001, 'server restart');
  }
}

/**
 * One player's connection: waits for {t:'hello', initData}, signs them in with
 * authenticate(initData), then passes their messages to the room.
 * Returns { message(text), closed() } for the caller to wire to its socket events.
 */
export function connectPlayer(room, ws, authenticate) {
  let client = null;
  let gone = false;
  const helloTimer = setTimeout(() => ws.close(4001, 'no hello'), HELLO_TIMEOUT_MS);
  return {
    async message(raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (client) {
        room.handle(client, msg);
        return;
      }
      if (msg.t !== 'hello') return;
      clearTimeout(helloTimer);
      try {
        const who = await authenticate(String(msg.initData || ''));
        if (gone || !ws.isOpen()) return;
        client = room.join(ws, who);
      } catch (err) {
        const text = err && err.message ? err.message : 'تعذّر الدخول';
        if (ws.isOpen()) ws.send(JSON.stringify({ t: 'err', msg: text }));
        ws.close(4003, 'auth');
      }
    },
    closed() {
      gone = true;
      clearTimeout(helloTimer);
      if (client) room.leave(client);
    },
  };
}
