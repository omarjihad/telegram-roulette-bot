import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { createWorld, REVENGE_MASS, START_MASS, THROW_SPEEDS } from '../../../../mf-battle/sim.js';
import type { SimOwner, SimPellet, SimWorld } from '../../../../mf-battle/sim.js';
import { logger } from '../config/logger';

/**
 * MF Battle online room. One shared world (the same rules as offline practice, from
 * mf-battle/sim.js) runs here; players connect over a WebSocket, send their joystick /
 * split / throw, and get back what is around them 20 times a second.
 */

export interface BattleIdentity {
  telegramId: number;
  name: string;
  skin: string;
  level?: number;
  /** Mass each life starts with (bought in the shop). */
  startMass?: number;
  /** Whether this throw speed is open to the player right now (bought / unlocked by ads). */
  canThrow?: (level: number) => boolean;
  /** Saves a finished life to the weekly leaderboard. */
  record?: (match: { mass: number; seconds: number }) => Promise<void>;
  /** MF coins and experience for eating someone (online only); returns what was given. */
  onKill?: (victimMass: number) => Promise<{ coins: number; level: number; levelUp: boolean } | null>;
}
export type BattleAuthenticate = (initData: string) => Promise<BattleIdentity>;

export const BATTLE_WS_PATH = '/api/battle/ws';
const TICK_MS = 25; // the world moves 40 times a second
const SEND_EVERY = 2; // and each player gets an update every second tick (20 a second)
const ROOM_BOTS = 30;
const SLOW_CLIENT_BYTES = 96 * 1024; // a phone this far behind skips position updates until it catches up
const MAX_PLAYERS = 30;
const HELLO_TIMEOUT_MS = 10_000;
const BOT_REPLIES = ['😂😂', 'شكو؟', 'تعال اذا رجّال 😤', 'GG', 'هسه اجيك 👀', 'هههه', 'ماكو مثلي 😎', 'منو انت؟', 'لا تهرب 🏃', '👍'];

interface Client {
  ws: WebSocket;
  who: BattleIdentity;
  owner: SimOwner;
  view: { hw: number; hh: number };
  known: Set<string>;
  needsWelcome: boolean;
  lastChatAt: number;
  lastCenter: { x: number; y: number };
  canRevenge: boolean;
}

const num = (v: unknown, min: number, max: number, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const r1 = (n: number) => Math.round(n);
const ownerRow = (o: SimOwner): [number, string, string, number, number] => [o.id, o.name, o.skin, o.hue, o.level];
/** A pellet as [id, x0, y0, vx, vy, hue, age in ms, mass] — enough for the phone to draw its flight. */
const pelletRow = (p: SimPellet, now: number) => [p.id, r1(p.x0), r1(p.y0), r1(p.vx), r1(p.vy), p.hue, r1((now - p.born) * 1000), r1(p.m)];

export class BattleRoom {
  world: SimWorld;
  clients = new Set<Client>();
  private timer: NodeJS.Timeout | null = null;
  private tickN = 0;
  private lastTick = 0;
  private lastBoard = 0;

  constructor(bots = ROOM_BOTS) {
    this.world = createWorld({ bots, trackNet: true });
  }

  get players() { return this.clients.size; }

  join(ws: WebSocket, who: BattleIdentity) {
    // The same account on a second phone/tab replaces the first one.
    for (const c of this.clients) {
      if (c.who.telegramId === who.telegramId) {
        this.leave(c);
        c.ws.close(4000, 'دخلت من مكان ثاني');
      }
    }
    if (this.clients.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'err', msg: 'الغرفة مليانة، جرّب بعد شوية' }));
      ws.close();
      return null;
    }
    const owner = this.world.addOwner({ name: who.name, skin: who.skin, mass: who.startMass ?? START_MASS, level: who.level ?? 1 });
    const client: Client = {
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

  leave(c: Client) {
    if (!this.clients.delete(c)) return;
    if (!c.owner.dead) this.record(c);
    this.world.removeOwner(c.owner);
    if (!this.clients.size) this.stop();
  }

  handle(c: Client, msg: Record<string, unknown>) {
    const o = c.owner;
    switch (msg.t) {
      case 'in':
        o.dir = { x: num(msg.x, -1e4, 1e4), y: num(msg.y, -1e4, 1e4), m: num(msg.m, 0, 1) };
        c.view = { hw: num(msg.hw, 200, 6000, 700), hh: num(msg.hh, 150, 6000, 350) };
        break;
      case 'split':
        this.world.split(o, num(msg.x, -1e4, 1e4, 1), num(msg.y, -1e4, 1e4, 0));
        break;
      case 'throw':
        o.throwing = !!msg.on && !o.dead;
        // Only speeds the player has (bought, or opened by ads and not expired yet).
        let lv = Math.floor(num(msg.lv, 0, THROW_SPEEDS.length - 1));
        while (lv > 0 && c.who.canThrow && !c.who.canThrow(lv)) lv--;
        o.throwLevel = lv;
        break;
      case 'chat': {
        const text = cleanText(msg.x, 60);
        const now = Date.now();
        if (!text || now - c.lastChatAt < 900) break;
        c.lastChatAt = now;
        this.broadcast({ t: 'chat', n: c.who.name, x: text, h: o.hue });
        if (Math.random() < 0.3) {
          setTimeout(() => {
            const bots = this.world.owners.filter((b) => b.bot && !b.dead);
            if (bots.length && this.clients.size) {
              const b = bots[Math.floor(Math.random() * bots.length)];
              this.broadcast({ t: 'chat', n: b.name, x: BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)], h: b.hue });
            }
          }, 900 + Math.random() * 1500);
        }
        break;
      }
      case 'ping':
        this.send(c, { t: 'pong', c: num(msg.c, 0, 1e12) });
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

  private start() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const w = this.world;
    w.step(dt);
    const byOwner = new Map<SimOwner, Client>();
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
      this.lastBoard = now;
      this.sendBoard();
    }
  }

  private sendSnapshots() {
    const w = this.world;
    // What changed on the ground since last time goes to everyone: food and thrown mass.
    // Pellets are sent once with their throw; the phones draw the same flight curve.
    const fa: number[] = [];
    for (const f of w.foodAdded) if (w.foods.byId.has(f.id)) fa.push(f.id, r1(f.x), r1(f.y), f.c);
    const pa: number[] = [];
    for (const p of w.pelletAdded) if (p.m > 0) pa.push(...pelletRow(p, w.time));
    const fr = w.foodRemoved.slice();
    const pr = w.pelletRemoved.slice();
    w.foodAdded.length = 0;
    w.foodRemoved.length = 0;
    w.pelletAdded.length = 0;
    w.pelletRemoved.length = 0;
    const delta = fa.length || fr.length || pa.length || pr.length ? JSON.stringify({ t: 'f', fa, fr, pa, pr }) : null;
    for (const c of this.clients) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      if (c.needsWelcome) {
        // The whole ground once; after that only what changed.
        const food: number[] = [];
        for (const f of w.foods.byId.values()) food.push(f.id, r1(f.x), r1(f.y), f.c);
        const pellets: number[] = [];
        for (const p of w.pellets) if (p.m > 0) pellets.push(...pelletRow(p, w.time));
        this.send(c, { t: 'welcome', you: c.owner.id, players: this.clients.size, food, pellets });
        c.needsWelcome = false;
      } else if (delta) {
        c.ws.send(delta);
      }
      // Positions are only worth sending if the phone keeps up; otherwise skip a beat.
      if (c.ws.bufferedAmount > SLOW_CLIENT_BYTES) continue;
      if (!c.owner.dead && c.owner.cells.length) c.lastCenter = w.centerOf(c.owner);
      const { x, y } = c.lastCenter;
      const hw = c.view.hw + 300;
      const hh = c.view.hh + 300;
      const x0 = x - hw, x1 = x + hw, y0 = y - hh, y1 = y + hh;
      const inBox = (px: number, py: number, r: number) => px + r > x0 && px - r < x1 && py + r > y0 && py - r < y1;
      const cells: number[] = [];
      const ow: [number, string, string, number, number][] = [];
      for (const cell of w.cells) {
        if (!inBox(cell.x, cell.y, cell.r)) continue;
        cells.push(cell.id, cell.owner.id, r1(cell.x), r1(cell.y), r1(cell.m));
        const key = `${cell.owner.id}:${cell.owner.ver}`;
        if (!c.known.has(key)) {
          c.known.add(key);
          ow.push(ownerRow(cell.owner));
        }
      }
      const viruses: number[] = [];
      for (const v of w.viruses) if (inBox(v.x, v.y, v.r)) viruses.push(v.id, r1(v.x), r1(v.y), r1(v.r));
      const orbs: number[] = [];
      for (const b of w.orbs) if (inBox(b.x, b.y, b.r)) orbs.push(b.id, r1(b.x), r1(b.y));
      // ts: when this picture of the world was taken (the phone draws between two of them).
      this.send(c, { t: 's', ts: Date.now(), c: cells, v: viruses, o: orbs, ow: ow.length ? ow : undefined, al: c.owner.dead ? 0 : 1 });
    }
  }

  /** Coins and level for eating someone; the killer's phone shows what they got. */
  private reward(c: Client, victimName: string, mass: number) {
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
      logger.warn({ err }, 'battle kill reward failed');
      this.send(c, { t: 'ev', e: 'ate', n: victimName });
    });
  }

  private sendBoard() {
    const w = this.world;
    const ranked = w.ranking();
    const top = ranked.slice(0, 10).map((r) => [r.o.id, r1(r.m)]);
    const mm: number[] = [];
    for (const r of ranked) {
      const c = w.centerOf(r.o);
      mm.push(r.o.id, r1(c.x), r1(c.y), r1(r.m));
    }
    const names = ranked.slice(0, 10).map((r) => ownerRow(r.o));
    for (const c of this.clients) {
      const i = ranked.findIndex((r) => r.o === c.owner);
      const ow = names.filter(([id]) => {
        const o = ranked.find((r) => r.o.id === id)!.o;
        const key = `${id}:${o.ver}`;
        if (c.known.has(key)) return false;
        c.known.add(key);
        return true;
      });
      if (ow.length) this.send(c, { t: 'ow', ow });
      this.send(c, { t: 'lb', r: top, me: i >= 0 ? [i + 1, r1(ranked[i].m)] : null, mm });
    }
  }

  private record(c: Client) {
    const s = c.owner.stats;
    const seconds = this.world.time - s.born;
    if (!c.who.record || seconds < 5) return;
    void c.who.record({ mass: s.maxMass, seconds }).catch((err) => logger.warn({ err }, 'battle match record failed'));
  }

  broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }

  private send(c: Client, msg: unknown) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }
}

/** Hooks the online room onto the HTTP server at /api/battle/ws. */
export function attachBattleOnline(server: Server, authenticate: BattleAuthenticate, room = new BattleRoom()) {
  // Only big messages (the first full map) are compressed; the 20-a-second updates are small.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: { threshold: 16 * 1024 } });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url || '').split('?')[0];
    if (path !== BATTLE_WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket) {
    let client: Client | null = null;
    const helloTimer = setTimeout(() => ws.close(4001, 'no hello'), HELLO_TIMEOUT_MS);
    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
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
        if (ws.readyState !== WebSocket.OPEN) return;
        client = room.join(ws, who);
      } catch (err) {
        const text = err instanceof Error && err.message ? err.message : 'تعذّر الدخول';
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'err', msg: text }));
        ws.close(4003, 'auth');
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (client) room.leave(client);
    });
    ws.on('error', () => undefined);
  }

  return {
    room,
    close() {
      room.stop();
      for (const c of room.clients) c.ws.close(1001, 'server restart');
      wss.close();
    },
  };
}
