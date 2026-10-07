// MF Battle online game server on Cloudflare. One Durable Object holds the room (the same
// room.js as the bot's server), placed close to the players for a low ping. Players are
// signed in, paid and recorded by the bot's server on Railway (server-to-server calls).
import { BattleRoom, connectPlayer } from '../../../artifacts/mf-battle/room.js';
import { THROW_SPEEDS } from '../../../artifacts/mf-battle/sim.js';

function allowedThrow(t, lv) {
  if (lv <= Math.max(1, t.throwOwned || 1)) return true;
  const until = lv === 4 ? t.x20Until : lv === THROW_SPEEDS.length - 1 ? t.x50Until : null;
  return !!until && new Date(until).getTime() > Date.now();
}

export class BattleRoomDO {
  constructor(state, env) {
    this.env = env;
    this.room = new BattleRoom({ log: (msg, err) => console.log(msg, err && err.message) });
  }

  /** A call to the bot's server (sign in / kill reward / finished life). */
  async api(what, body) {
    const res = await fetch(`${this.env.API_BASE}/api/battle-internal/${what}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-battle-key': this.env.BATTLE_INTERNAL_KEY || '' },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !json || !json.ok) throw new Error((json && json.message) || 'تعذّر الدخول');
    return json.data;
  }

  async identity(initData) {
    const d = await this.api('identity', { initData });
    return {
      ...d,
      canThrow: (lv) => allowedThrow(d.throws || {}, lv),
      record: (match) => this.api('record', { telegramId: d.telegramId, ...match }).then(() => undefined),
      onKill: (mass) => this.api('kill', { telegramId: d.telegramId, mass }),
    };
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('MF Battle game server ✓');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const socket = {
      send: (text) => { try { server.send(text); } catch { /* closed */ } },
      close: (code, reason) => { try { server.close(code, reason); } catch { /* closed */ } },
      isOpen: () => server.readyState === 1,
      buffered: () => 0,
    };
    const player = connectPlayer(this.room, socket, (initData) => this.identity(initData));
    server.addEventListener('message', (e) => { player.message(e.data); });
    server.addEventListener('close', () => player.closed());
    server.addEventListener('error', () => player.closed());
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws' || url.pathname === '/api/battle/ws') {
      // One room for everyone; it is created near the first player (location hint).
      const id = env.ROOM.idFromName('main');
      const stub = env.ROOM.get(id, { locationHint: env.LOCATION_HINT || 'me' });
      return stub.fetch(request);
    }
    return new Response('MF Battle game server ✓', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
