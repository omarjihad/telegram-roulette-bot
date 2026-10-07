// Types for room.js (the online room shared by the bot's server and Cloudflare).
import type { SimOwner, SimWorld } from './sim.js';

export interface RoomSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
  buffered(): number;
}
export interface BattleIdentity {
  telegramId: number;
  name: string;
  skin: string;
  level?: number;
  startMass?: number;
  canThrow?: (level: number) => boolean;
  record?: (match: { mass: number; seconds: number }) => Promise<void>;
  onKill?: (victimMass: number) => Promise<{ coins: number; level: number; levelUp: boolean } | null>;
}
export interface RoomClient {
  ws: RoomSocket;
  who: BattleIdentity;
  owner: SimOwner;
  view: { hw: number; hh: number };
  known: Set<string>;
  needsWelcome: boolean;
  lastChatAt: number;
  lastCenter: { x: number; y: number };
  canRevenge: boolean;
}
export class BattleRoom {
  constructor(opts?: { bots?: number; log?: (msg: string, err?: unknown) => void });
  world: SimWorld;
  clients: Set<RoomClient>;
  readonly players: number;
  join(ws: RoomSocket, who: BattleIdentity): RoomClient | null;
  leave(c: RoomClient): void;
  handle(c: RoomClient, msg: Record<string, unknown>): void;
  stop(): void;
  close(): void;
  broadcast(msg: unknown): void;
}
export function connectPlayer(
  room: BattleRoom,
  ws: RoomSocket,
  authenticate: (initData: string) => Promise<BattleIdentity>,
): { message(raw: unknown): Promise<void>; closed(): void };
