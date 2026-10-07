import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { BattleRoom } from './online';

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    readyState: WebSocket.OPEN,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: vi.fn(),
  } as unknown as WebSocket & { sent: Record<string, unknown>[] };
}

const rooms: BattleRoom[] = [];
function room() {
  const r = new BattleRoom(4);
  rooms.push(r);
  return r;
}
afterEach(() => { rooms.splice(0).forEach((r) => r.stop()); vi.useRealTimers(); });

describe('MF Battle online room', () => {
  it('welcomes a player with the food and then sends what is around them', async () => {
    vi.useFakeTimers();
    const r = room();
    const ws = fakeSocket();
    const c = r.join(ws, { telegramId: 1, name: 'Omar', skin: 'mf' })!;
    await vi.advanceTimersByTimeAsync(120);
    const welcome = ws.sent.find((m) => m.t === 'welcome')!;
    expect(welcome.you).toBe(c.owner.id);
    expect((welcome.food as number[]).length).toBeGreaterThan(1000);
    const snap = ws.sent.find((m) => m.t === 's')!;
    expect((snap.c as number[]).includes(c.owner.id)).toBe(true);
    expect(snap.al).toBe(1);
  });

  it('replaces an older connection of the same account', () => {
    const r = room();
    const a = fakeSocket();
    const b = fakeSocket();
    r.join(a, { telegramId: 7, name: 'A', skin: 'mf' });
    r.join(b, { telegramId: 7, name: 'A', skin: 'mf' });
    expect(r.players).toBe(1);
    expect(a.close).toHaveBeenCalled();
  });

  it('shares chat with everyone, at most about once a second per player', () => {
    const r = room();
    const a = fakeSocket();
    const b = fakeSocket();
    const ca = r.join(a, { telegramId: 1, name: 'A', skin: 'mf' })!;
    r.join(b, { telegramId: 2, name: 'B', skin: 'mf' });
    r.handle(ca, { t: 'chat', x: 'هلو' });
    r.handle(ca, { t: 'chat', x: 'spam' });
    const got = b.sent.filter((m) => m.t === 'chat');
    expect(got).toEqual([{ t: 'chat', n: 'A', x: 'هلو', h: ca.owner.hue }]);
  });

  it('only revives with 500 once per death, and never while alive', () => {
    const r = room();
    const c = r.join(fakeSocket(), { telegramId: 1, name: 'A', skin: 'mf' })!;
    r.handle(c, { t: 'spawn', rv: true });
    expect(r.world.massOf(c.owner)).toBe(20);
    c.owner.dead = true;
    c.canRevenge = true;
    r.handle(c, { t: 'spawn', rv: true });
    expect(r.world.massOf(c.owner)).toBe(500);
    c.owner.dead = true;
    r.handle(c, { t: 'spawn', rv: true });
    expect(r.world.massOf(c.owner)).toBe(20);
  });

  it('ignores bad input values', () => {
    const r = room();
    const c = r.join(fakeSocket(), { telegramId: 1, name: 'A', skin: 'mf' })!;
    r.handle(c, { t: 'in', x: 'NaN', y: 1e99, m: 5, hw: -3 });
    expect(c.owner.dir).toEqual({ x: 0, y: 10000, m: 1 });
    expect(c.view.hw).toBe(200);
    r.handle(c, { t: 'throw', on: true, lv: 99 });
    expect(c.owner.throwLevel).toBe(5);
  });
});
