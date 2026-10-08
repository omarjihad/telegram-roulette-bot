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

import { adsgramConfirmedSince, claimAdTask, finishSnakeRound, finishZigguratRound, gamesAllowed, recordAdsgramReward, startSnakeRound, startZigguratRound } from './games.service';

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
