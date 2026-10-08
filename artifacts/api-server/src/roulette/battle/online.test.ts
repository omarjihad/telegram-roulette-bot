import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { BattleRoom } from './online';

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    isOpen: () => true,
    buffered: () => 0,
    send: (data: string) => { sent.push(JSON.parse(data)); },
    close: vi.fn(),
  };
}

const rooms: BattleRoom[] = [];
function room() {
  const r = new BattleRoom({ bots: 4 });
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
    expect(Array.isArray(welcome.pellets)).toBe(true);
    const snap = ws.sent.find((m) => m.t === 's')!;
    expect((snap.c as number[]).includes(c.owner.id)).toBe(true);
    expect(snap.al).toBe(1);
    expect(snap.p).toBeUndefined(); // thrown mass travels as changes, not in every update
  });

  it('sends thrown mass once, with its throw, and gives coins for kills', async () => {
    vi.useFakeTimers();
    const r = room();
    const ws = fakeSocket();
    const onKill = vi.fn(async () => ({ coins: 3, level: 2, levelUp: true }));
    const c = r.join(ws, { telegramId: 1, name: 'A', skin: 'mf', onKill })!;
    c.owner.cells[0].m = 400;
    r.handle(c, { t: 'in', x: 1, y: 0, m: 0 });
    r.handle(c, { t: 'throw', on: true, lv: 0 });
    await vi.advanceTimersByTimeAsync(300);
    const deltas = ws.sent.filter((m) => m.t === 'f');
    const thrown = deltas.flatMap((m) => m.pa as number[]);
    expect(thrown.length % 8).toBe(0);
    expect(thrown.length / 8).toBeGreaterThan(0);
    // Eat a bot: the killer is paid and told.
    const bot = r.world.owners.find((o) => o.bot && !o.dead)!;
    r.handle(c, { t: 'throw', on: false });
    c.owner.cells[0].m = 5000;
    c.owner.cells[0].r = Math.sqrt(5000) * 10;
    for (const b of bot.cells) { b.m = 30; b.r = Math.sqrt(30) * 10; b.x = c.owner.cells[0].x; b.y = c.owner.cells[0].y; }
    await vi.advanceTimersByTimeAsync(100);
    expect(onKill).toHaveBeenCalled();
    expect(ws.sent.find((m) => m.t === 'ev' && m.e === 'ate')).toMatchObject({ coins: 3, lv: 2, up: 1 });
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
    // id: whose message it is, so the phones show it over that player's piece.
    expect(got).toEqual([{ t: 'chat', n: 'A', x: 'هلو', h: ca.owner.hue, id: ca.owner.id }]);
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
