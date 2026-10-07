import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { BattleRoom, connectPlayer } from '../../../../mf-battle/room.js';
import type { BattleIdentity, RoomSocket } from '../../../../mf-battle/room.js';
import { logger } from '../config/logger';

/**
 * MF Battle online room on the bot's own server. The room itself (mf-battle/room.js) is
 * shared with the Cloudflare game server; this file only plugs it into Node's WebSockets.
 */

export type { BattleIdentity };
export type BattleAuthenticate = (initData: string) => Promise<BattleIdentity>;
export { BattleRoom };

export const BATTLE_WS_PATH = '/api/battle/ws';

/** The room's view of a Node WebSocket. */
export function nodeSocket(ws: WebSocket): RoomSocket {
  return {
    send: (text) => ws.send(text),
    close: (code, reason) => ws.close(code, reason),
    isOpen: () => ws.readyState === WebSocket.OPEN,
    buffered: () => ws.bufferedAmount,
  };
}

/** Hooks the online room onto the HTTP server at /api/battle/ws. */
export function attachBattleOnline(server: Server, authenticate: BattleAuthenticate, room = new BattleRoom({ log: (msg, err) => logger.warn({ err }, msg) })) {
  // Only big messages (the first full map) are compressed; the 20-a-second updates are small.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: { threshold: 16 * 1024 } });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url || '').split('?')[0];
    if (path !== BATTLE_WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const player = connectPlayer(room, nodeSocket(ws), authenticate);
      ws.on('message', (raw) => void player.message(raw));
      ws.on('close', () => player.closed());
      ws.on('error', () => undefined);
    });
  });

  return {
    room,
    close() {
      room.close();
      wss.close();
    },
  };
}
