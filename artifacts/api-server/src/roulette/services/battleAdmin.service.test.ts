import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tourFindOne: vi.fn(),
  tourFindOneAndUpdate: vi.fn(),
  tourUpdateOne: vi.fn(),
  tourExists: vi.fn(),
  tourCreate: vi.fn(),
  sendMessage: vi.fn(),
  profileUpdateOne: vi.fn(),
  profileFindById: vi.fn(),
  profileFor: vi.fn(),
  findUser: vi.fn(),
}));

vi.mock('../models/BattleTournament', () => ({
  BattleTournament: {
    findOne: (...a: unknown[]) => ({ sort: () => mocks.tourFindOne(...a) }),
    findOneAndUpdate: mocks.tourFindOneAndUpdate,
    updateOne: mocks.tourUpdateOne,
    exists: mocks.tourExists,
    create: mocks.tourCreate,
  },
}));
vi.mock('../models/BattleProfile', () => ({ BattleProfile: { updateOne: mocks.profileUpdateOne, findById: mocks.profileFindById } }));
vi.mock('../models/BattleWeeklyStat', () => ({ BattleWeeklyStat: {} }));
vi.mock('../models/Settings', () => ({ Settings: { updateOne: vi.fn() }, getSettings: async () => ({ battlePublic: false }) }));
vi.mock('../models/User', () => ({ User: { find: vi.fn(async () => []) } }));
vi.mock('../models/AuditLog', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('../bot/instance', () => ({ getBotInstance: () => ({ sendMessage: mocks.sendMessage }) }));
vi.mock('./admin.service', () => ({ listAllAdminTelegramIds: async () => [1, 2] }));
vi.mock('./broadcast.service', () => ({ runBroadcast: vi.fn(async () => ({})) }));
vi.mock('./user.service', () => ({ findUserByLookup: mocks.findUser }));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('./battle.service', async (orig) => ({ ...(await orig<typeof import('./battle.service')>()), profileFor: mocks.profileFor }));

import { finishDueTournaments, grantPlayer, reportLeaders, startTournament } from './battleAdmin.service';

const running = (over: Record<string, unknown> = {}) => ({
  _id: 'T1',
  status: 'running',
  mode: 'longest',
  minutes: 30,
  startedAt: new Date(Date.now() - 60000),
  endsAt: new Date(Date.now() + 60000),
  standings: {},
  current: null,
  ...over,
});

describe('MF Battle developer panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds lead time and the current leader from a room report', async () => {
    const t = running();
    mocks.tourFindOne.mockResolvedValue(t);
    mocks.tourFindOneAndUpdate.mockResolvedValue({ ...t, standings: { 42: { telegramId: 42, name: 'Omar', leadSeconds: 3, bestMass: 900 } } });
    const res = await reportLeaders({ lead: [[42, 'Omar', 3, 900]], current: { telegramId: 42, name: 'Omar', mass: 880 }, players: 2, room: 'test' });
    const update = mocks.tourFindOneAndUpdate.mock.calls[0][1];
    expect(update.$inc).toEqual({ 'standings.42.leadSeconds': 3 });
    expect(update.$max['standings.42.bestMass']).toBe(900);
    expect(update.$set.current).toMatchObject({ telegramId: 42, mass: 880 });
    expect(res.tour).toMatchObject({ mode: 'longest', leader: ['Omar', 3] });
  });

  it('after the end, rooms get the winner to show for 5 minutes', async () => {
    const endedAt = new Date(Date.now() - 60000);
    mocks.tourFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: 'T0', status: 'ended', mode: 'final', endsAt: endedAt, endedAt,
      winner: { telegramId: 5, name: 'Zaid', leadSeconds: 10, bestMass: 5000, finalMass: 4200 },
    });
    await new Promise((r) => setTimeout(r, 2100)); // past the 2-second cache of the running one
    const res = await reportLeaders({ lead: [], current: null, players: 1, room: 'test2' });
    expect(res.tour).toMatchObject({ done: true, winner: ['Zaid', 4200] });
    expect((res.tour as { until: number }).until).toBe(endedAt.getTime() + 5 * 60000);
  });

  it('refuses a second tournament while one runs', async () => {
    mocks.tourExists.mockResolvedValue(true);
    await expect(startTournament({ minutes: 30, mode: 'final', broadcast: false }, { id: 1 })).rejects.toThrow(/شغالة/);
    mocks.tourExists.mockResolvedValue(false);
    await expect(startTournament({ minutes: 0, mode: 'final', broadcast: false }, { id: 1 })).rejects.toThrow(/مدة/);
    mocks.tourCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: 'N', standings: {}, ...doc }));
    const res = await startTournament({ minutes: 10, mode: 'final', broadcast: false, prize: '  5000 عملة   وسكن ' }, { id: 1 });
    expect(mocks.tourCreate.mock.calls[0][0].prize).toBe('5000 عملة وسكن');
    expect(res.tournament?.prize).toBe('5000 عملة وسكن');
  });

  it('picks the longest leader and tells the developers and the winner', async () => {
    const t = running({
      endsAt: new Date(Date.now() - 1000),
      standings: { 5: { telegramId: 5, name: 'Zaid', leadSeconds: 40, bestMass: 3000 }, 42: { telegramId: 42, name: 'Omar', leadSeconds: 300, bestMass: 9000 } },
    });
    mocks.tourFindOneAndUpdate.mockResolvedValueOnce(t).mockResolvedValueOnce(null);
    await finishDueTournaments();
    expect(mocks.tourUpdateOne.mock.calls[0][1].$set.winner).toMatchObject({ telegramId: 42, leadSeconds: 300 });
    const to = mocks.sendMessage.mock.calls.map((c) => c[0]);
    expect(to).toEqual([1, 2, 42]);
    expect(mocks.sendMessage.mock.calls[2][1]).toContain('فزت');
  });

  it('final mode: whoever leads at the end wins', async () => {
    const end = new Date(Date.now() - 1000);
    const t = running({ mode: 'final', endsAt: end, standings: { 42: { telegramId: 42, name: 'Omar', leadSeconds: 900, bestMass: 9000 } }, current: { telegramId: 5, name: 'Zaid', mass: 4000, at: new Date(end.getTime() - 2000) } });
    mocks.tourFindOneAndUpdate.mockResolvedValueOnce(t).mockResolvedValueOnce(null);
    await finishDueTournaments();
    expect(mocks.tourUpdateOne.mock.calls[0][1].$set.winner).toMatchObject({ telegramId: 5, finalMass: 4000 });
  });

  it('gives a permanent ×50 and tells the player', async () => {
    const user = { telegramId: 9, firstName: 'Ali' };
    const p = { _id: 'P', coins: 0, xp: 0, ownedSkins: [], throwOwned: 1 };
    mocks.findUser.mockResolvedValue(user);
    mocks.profileFor.mockResolvedValue(p);
    mocks.profileFindById.mockResolvedValue({ ...p, x50Until: new Date('2100-01-01') });
    const res = await grantPlayer({ user: '9', kind: 'throw', value: 5 }, { id: 1 });
    expect(mocks.profileUpdateOne.mock.calls[0][1].$set.x50Until.getUTCFullYear()).toBe(2100);
    expect(res.player.x50Forever).toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledWith(9, expect.stringContaining('×50'));
  });
});
