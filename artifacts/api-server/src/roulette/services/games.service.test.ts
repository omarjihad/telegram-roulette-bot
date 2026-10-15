import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  adCreate: vi.fn(),
  adFindUpdate: vi.fn(),
  adFindOne: vi.fn(),
  sessionFind: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionCreate: vi.fn(),
  settings: vi.fn(),
  env: { ADSGRAM_REWARD_KEY: '' },
}));

vi.mock('../models/User', () => ({ User: { updateOne: mocks.userUpdate } }));
vi.mock('../models/AdView', () => ({
  AdView: {
    create: mocks.adCreate,
    findOneAndUpdate: mocks.adFindUpdate,
    findOne: (...a: unknown[]) => ({ select: () => ({ lean: () => mocks.adFindOne(...a) }) }),
  },
}));
vi.mock('../models/GameSession', () => ({
  GameSession: { findOne: mocks.sessionFind, updateOne: mocks.sessionUpdate, updateMany: mocks.sessionUpdateMany, create: mocks.sessionCreate },
}));
vi.mock('../models/Settings', () => ({ getSettings: mocks.settings }));
vi.mock('../config/env', () => ({ env: mocks.env }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import {
  adsgramConfirmedSince,
  claimAdTask,
  finishFlappyRound,
  finishSnakeRound,
  finishTimerRound,
  finishZigguratRound,
  gamesAllowed,
  makeTimerTargets,
  recordAdsgramReward,
  startFlappyRound,
  startSnakeRound,
  startTimerRound,
  startZigguratRound,
  timerTryShare,
} from './games.service';

const settings = {
  gamesPublic: false,
  adsgramBlockId: '50375',
  adTaskReward: 0.2,
  snakePointsPerFood: 0.03,
  snakeFreeMaxFood: 7,
  snakeAdMaxFood: 4,
  snakeDurationSec: 30,
  snakeFreeCooldownHours: 12,
  zigguratPointsPerFloor: 0.02,
  zigguratMaxFloors: 100,
  flappyPointsPerPipe: 0.02,
  flappyMaxPipes: 50,
  timerPointsPerfect: 0.1,
  timerTries: 5,
};
const user = { _id: new mongoose.Types.ObjectId(), telegramId: 55 } as never;

function session(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status: 'playing',
    maxFood: 7,
    pointsPerFood: 0.03,
    durationSec: 30,
    startedAt: new Date(Date.now() - 20_000),
    ...overrides,
  };
}

describe('snake game & ads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.ADSGRAM_REWARD_KEY = '';
    mocks.settings.mockResolvedValue({ ...settings });
    mocks.sessionUpdate.mockResolvedValue({ modifiedCount: 1 });
    mocks.sessionCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.userUpdate.mockResolvedValue({ modifiedCount: 1 });
  });

  it('only admins can play while it is "coming soon"', async () => {
    expect(gamesAllowed({ gamesPublic: false }, null)).toBe(false);
    expect(gamesAllowed({ gamesPublic: false }, 'developer')).toBe(true);
    expect(gamesAllowed({ gamesPublic: true }, null)).toBe(true);
    await expect(startSnakeRound(user, null, 'free')).rejects.toMatchObject({ code: 'GAMES_COMING_SOON' });
  });

  it('pays 0.03 per apple, 7 apples = 0.21', async () => {
    mocks.sessionFind.mockResolvedValue(session());
    const res = await finishSnakeRound(user, { sessionId: String(new mongoose.Types.ObjectId()), food: 7, died: false });
    expect(res.reward).toBe(0.21);
    expect(mocks.userUpdate).toHaveBeenCalledWith({ _id: expect.anything() }, { $inc: { spinPoints: 0.21 } });
  });

  it('loses everything when the snake bites itself', async () => {
    mocks.sessionFind.mockResolvedValue(session());
    const res = await finishSnakeRound(user, { sessionId: String(new mongoose.Types.ObjectId()), food: 6, died: true });
    expect(res.reward).toBe(0);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('caps apples at the round maximum and at what was possible in the time played', async () => {
    mocks.sessionFind.mockResolvedValue(session({ maxFood: 4 }));
    expect((await finishSnakeRound(user, { sessionId: String(new mongoose.Types.ObjectId()), food: 99, died: false })).food).toBe(4);

    mocks.sessionFind.mockResolvedValue(session({ startedAt: new Date(Date.now() - 900) }));
    expect((await finishSnakeRound(user, { sessionId: String(new mongoose.Types.ObjectId()), food: 7, died: false })).food).toBe(3);
  });

  it('pays nothing for a round reported long after its clock ran out', async () => {
    mocks.sessionFind.mockResolvedValue(session({ startedAt: new Date(Date.now() - 5 * 60_000) }));
    const res = await finishSnakeRound(user, { sessionId: String(new mongoose.Types.ObjectId()), food: 7, died: false });
    expect(res.reward).toBe(0);
  });

  it('free round only once per cooldown', async () => {
    mocks.userUpdate.mockResolvedValueOnce({ modifiedCount: 0 });
    await expect(startSnakeRound(user, 'owner', 'free')).rejects.toMatchObject({ code: 'GAME_COOLDOWN' });
    const round = await startSnakeRound(user, 'owner', 'free');
    expect(round).toEqual(expect.objectContaining({ maxFood: 7, durationSec: 30 }));
  });

  it('ad round has its own apple limit', async () => {
    const round = await startSnakeRound(user, 'owner', 'ad');
    expect(round.maxFood).toBe(4);
  });

  it('with a Reward URL key, only pays for ads Adsgram confirmed', async () => {
    mocks.env.ADSGRAM_REWARD_KEY = 'secret';
    mocks.adFindUpdate.mockResolvedValue(null);
    await expect(claimAdTask(user, 'owner')).rejects.toMatchObject({ code: 'AD_NOT_CONFIRMED' });
    expect(mocks.userUpdate).not.toHaveBeenCalled();

    mocks.adFindUpdate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    expect(await claimAdTask(user, 'owner')).toEqual({ reward: 0.2 });
    expect(mocks.userUpdate).toHaveBeenCalledWith({ _id: expect.anything() }, { $inc: { spinPoints: 0.2 } });
  });

  it('rejects Reward URL calls with a wrong key', async () => {
    mocks.env.ADSGRAM_REWARD_KEY = 'secret';
    await expect(recordAdsgramReward('nope', '55')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await recordAdsgramReward('secret', '55');
    expect(mocks.adCreate).toHaveBeenCalledWith({ telegramId: 55, source: 'adsgram_callback' });
  });
});

describe('ziggurat game', () => {
  it('pays 0.02 for every brick on the tower', async () => {
    mocks.sessionFind.mockResolvedValue(session({ game: 'ziggurat', maxFood: 100, pointsPerFood: 0.02, durationSec: 1800 }));
    mocks.sessionUpdate.mockResolvedValue({ modifiedCount: 1 });
    const res = await finishZigguratRound(user, { sessionId: String(new mongoose.Types.ObjectId()), floors: 25 });
    expect(res.reward).toBe(0.5);
    expect(res.floors).toBe(25);
  });

  it('caps floors at what could be stacked in the time played', async () => {
    mocks.sessionFind.mockResolvedValue(session({ game: 'ziggurat', maxFood: 100, pointsPerFood: 0.02, durationSec: 1800, startedAt: new Date(Date.now() - 3000) }));
    mocks.sessionUpdate.mockResolvedValue({ modifiedCount: 1 });
    const res = await finishZigguratRound(user, { sessionId: String(new mongoose.Types.ObjectId()), floors: 90 });
    expect(res.floors).toBeLessThanOrEqual(10);
  });

  it('has its own free round, separate from the snake', async () => {
    mocks.settings.mockResolvedValue({ ...settings, gamesPublic: true });
    mocks.userUpdate.mockResolvedValue({ modifiedCount: 1 });
    mocks.sessionCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    const round = await startZigguratRound(user, null, 'free');
    expect(round.pointsPerFloor).toBe(0.02);
    expect(mocks.userUpdate.mock.calls[0][1]).toEqual({ $set: { lastFreeZigguratAt: expect.any(Date) } });
    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({ game: 'ziggurat' }));
  });

  it('ad check: tells whether Adsgram reported the admin\'s own view since the ad started', async () => {
    const since = new Date('2026-10-08T10:00:00Z');
    mocks.adFindOne.mockResolvedValueOnce({ createdAt: new Date('2026-10-08T10:00:07Z') });
    await expect(adsgramConfirmedSince(7, since)).resolves.toMatchObject({ confirmed: true });
    expect(mocks.adFindOne).toHaveBeenCalledWith({ telegramId: 7, source: 'adsgram_callback', createdAt: { $gte: since } });
    mocks.adFindOne.mockResolvedValueOnce(null);
    await expect(adsgramConfirmedSince(7, since)).resolves.toMatchObject({ confirmed: false });
  });
});

describe('flying game', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ ...settings, gamesPublic: true });
    mocks.sessionUpdate.mockResolvedValue({ modifiedCount: 1 });
    mocks.sessionCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.userUpdate.mockResolvedValue({ modifiedCount: 1 });
  });

  it('has its own free round, then one per ad', async () => {
    const round = await startFlappyRound(user, null, 'free');
    expect(round).toMatchObject({ pointsPerPipe: 0.02, maxPipes: 50, mode: 'free' });
    expect(mocks.userUpdate.mock.calls[0][1]).toEqual({ $set: { lastFreeFlappyAt: expect.any(Date) } });
    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({ game: 'flappy' }));
    // Only an unfinished Flying round is given up, not another game's.
    expect(mocks.sessionUpdateMany.mock.calls[0][0]).toMatchObject({ game: 'flappy', status: 'playing' });

    mocks.userUpdate.mockResolvedValueOnce({ modifiedCount: 0 });
    await expect(startFlappyRound(user, null, 'free')).rejects.toMatchObject({ code: 'GAME_COOLDOWN' });
  });

  it('pays per pipe, capped at the maximum and at what could fly by in the time played', async () => {
    mocks.sessionFind.mockResolvedValueOnce(session({ game: 'flappy', maxFood: 50, pointsPerFood: 0.02, durationSec: 1800, startedAt: new Date(Date.now() - 60_000) }));
    expect(await finishFlappyRound(user, { sessionId: String(new mongoose.Types.ObjectId()), pipes: 12 })).toMatchObject({ reward: 0.24, pipes: 12 });

    // 3 seconds of flight can't pass 40 pipes.
    mocks.sessionFind.mockResolvedValueOnce(session({ game: 'flappy', maxFood: 50, pointsPerFood: 0.02, durationSec: 1800, startedAt: new Date(Date.now() - 3000) }));
    expect((await finishFlappyRound(user, { sessionId: String(new mongoose.Types.ObjectId()), pipes: 40 })).pipes).toBeLessThanOrEqual(5);

    mocks.sessionFind.mockResolvedValueOnce(session({ game: 'flappy', maxFood: 50, pointsPerFood: 0.02, durationSec: 1800, startedAt: new Date(Date.now() - 600_000) }));
    expect((await finishFlappyRound(user, { sessionId: String(new mongoose.Types.ObjectId()), pipes: 999 })).pipes).toBe(50);
    expect(mocks.sessionFind.mock.calls[0][0]).toMatchObject({ game: 'flappy' });
  });

  it('a snake round can\'t be settled with another game\'s round', async () => {
    mocks.sessionFind.mockResolvedValueOnce(null);
    await expect(finishSnakeRound(user, { sessionId: String(new mongoose.Types.ObjectId()), food: 3, died: false })).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
    expect(mocks.sessionFind.mock.calls[0][0]).toMatchObject({ $or: [{ game: 'snake' }, { game: null }] });
  });
});

describe('timer game', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ ...settings, gamesPublic: true });
    mocks.sessionUpdate.mockResolvedValue({ modifiedCount: 1 });
    mocks.sessionCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    mocks.userUpdate.mockResolvedValue({ modifiedCount: 1 });
  });

  it('targets are whole hundredths between 3.00 and 9.99 seconds', () => {
    expect(makeTimerTargets(3, () => 0)).toEqual([3000, 3000, 3000]);
    expect(makeTimerTargets(1, () => 0.9999)).toEqual([9990]);
  });

  it('exact = the clock showed the target; close stops get part of it; a hidden clock counts double', () => {
    expect(timerTryShare(5370, 5370, false)).toBe(1);
    expect(timerTryShare(5379, 5370, false)).toBe(1); // still showed 5.37
    expect(timerTryShare(5369, 5370, false)).toBe(0.4); // showed 5.36
    expect(timerTryShare(5420, 5370, false)).toBe(0.4);
    expect(timerTryShare(5300, 5370, false)).toBe(0.15);
    expect(timerTryShare(5600, 5370, false)).toBe(0);
    expect(timerTryShare(5372, 5370, true)).toBe(2);
    expect(timerTryShare(0, 5370, false)).toBe(0);
  });

  it('a round: the last two tries hide the clock, and the stops are scored on the server', async () => {
    const round = await startTimerRound(user, null, 'free');
    expect(round.targets).toHaveLength(5);
    expect(round.blind).toEqual([false, false, false, true, true]);
    expect(mocks.userUpdate.mock.calls[0][1]).toEqual({ $set: { lastFreeTimerAt: expect.any(Date) } });

    mocks.sessionFind.mockResolvedValueOnce(
      session({ game: 'timer', maxFood: 5, pointsPerFood: 0.1, durationSec: 600, targets: [5000, 6000, 7000, 8000, 9000], blind: [false, false, false, true, true], startedAt: new Date(Date.now() - 120_000) })
    );
    // exact, 0.04 off, miss, hidden exact, hidden 0.08 off → 1 + 0.4 + 0 + 2 + 0.3 = 3.7 shares
    const res = await finishTimerRound(user, { sessionId: String(new mongoose.Types.ObjectId()), stops: [5004, 6040, 7500, 8001, 9080] });
    expect(res.reward).toBe(0.37);
    expect(res.tries.map((x) => x.share)).toEqual([1, 0.4, 0, 2, 0.3]);
    expect(mocks.userUpdate).toHaveBeenLastCalledWith({ _id: expect.anything() }, { $inc: { spinPoints: 0.37 } });
  });

  it('stops adding up to more time than the round took pay nothing', async () => {
    mocks.sessionFind.mockResolvedValueOnce(
      session({ game: 'timer', maxFood: 5, pointsPerFood: 0.1, durationSec: 600, targets: [5000, 6000, 7000, 8000, 9000], blind: [false, false, false, true, true], startedAt: new Date(Date.now() - 4000) })
    );
    const res = await finishTimerRound(user, { sessionId: String(new mongoose.Types.ObjectId()), stops: [5000, 6000, 7000, 8000, 9000] });
    expect(res.reward).toBe(0);
    expect(res.tooLate).toBe(true);
  });
});
