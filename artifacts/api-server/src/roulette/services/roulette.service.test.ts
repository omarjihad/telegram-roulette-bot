import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startSession: vi.fn(),
  getSettings: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  findPrizes: vi.fn(),
  canonical: vi.fn(),
  reservePrize: vi.fn(),
  eligible: vi.fn(),
  createSpin: vi.fn(),
  createUserPrize: vi.fn(),
  createTask: vi.fn(),
  notify: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('mongoose', () => ({ default: { startSession: mocks.startSession } }));
vi.mock('../models/User', () => ({ User: { findOne: mocks.findUser, updateOne: mocks.updateUser } }));
vi.mock('../models/Prize', () => ({ Prize: { find: mocks.findPrizes, updateOne: mocks.reservePrize } }));
vi.mock('../models/RouletteSpin', () => ({ RouletteSpin: { create: mocks.createSpin } }));
vi.mock('../models/UserPrize', () => ({ UserPrize: { create: mocks.createUserPrize } }));
vi.mock('../models/Settings', () => ({ getSettings: mocks.getSettings }));
vi.mock('./prize.service', () => ({
  getEligiblePrizes: mocks.eligible,
  getCanonicalPrizes: mocks.canonical,
  getPrizeWeight: (prize: { baseWeight: number; dailyWeight?: number | null; pointsWeight?: number | null }, mode: 'daily' | 'points') =>
    mode === 'daily' ? (prize.dailyWeight ?? prize.baseWeight) : (prize.pointsWeight ?? prize.baseWeight),
  prizeImageUrl: vi.fn(),
}));
vi.mock('./claimTask.service', () => ({
  buildTaskLink: vi.fn(),
  createClaimTaskForPrize: mocks.createTask,
}));
vi.mock('./notification.service', () => ({ createNotification: mocks.notify }));
vi.mock('../config/logger', () => ({ logger: { error: mocks.loggerError } }));

import { noPrizeWeight, performSpin } from './roulette.service';

describe('performSpin transactional regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canonical.mockResolvedValue([]);
  });

  it('aborts the cooldown and stock reservation together if award persistence fails', async () => {
    let rolledBack = false;
    const session = {
      withTransaction: async (work: () => Promise<void>) => {
        try {
          await work();
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
      endSession: vi.fn(),
    };
    mocks.startSession.mockResolvedValue(session);
    mocks.getSettings.mockResolvedValue({
      maintenanceMode: false,
      spinCooldownHours: 24,
      prizeExpiryHours: 24,
      claimReferralsRequired: 5,
    });
    const user = { _id: 'user-1', isBanned: false };
    mocks.findUser.mockReturnValue({ session: vi.fn().mockResolvedValue(user) });
    mocks.updateUser.mockResolvedValue({ modifiedCount: 1 });
    const prize = {
      _id: 'prize-1',
      key: 'last-item',
      name: 'Last item',
      icon: '🎁',
      hasImage: false,
      baseWeight: 100,
      isUnlimited: false,
    };
    mocks.eligible.mockResolvedValue([prize]);
    mocks.findPrizes.mockReturnValue({ session: vi.fn().mockResolvedValue([prize]) });
    mocks.reservePrize.mockResolvedValue({ modifiedCount: 1 });
    mocks.createSpin.mockRejectedValue(new Error('simulated insert failure'));

    await expect(performSpin(123)).rejects.toMatchObject({ code: 'SPIN_FAILED' });

    expect(rolledBack).toBe(true);
    expect(session.endSession).toHaveBeenCalledOnce();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does not award or substitute another prize when the last stock reservation loses its race', async () => {
    let rolledBack = false;
    const session = {
      withTransaction: async (work: () => Promise<void>) => {
        try {
          await work();
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
      endSession: vi.fn(),
    };
    mocks.startSession.mockResolvedValue(session);
    mocks.getSettings.mockResolvedValue({
      maintenanceMode: false,
      spinCooldownHours: 24,
      prizeExpiryHours: 24,
      claimReferralsRequired: 5,
    });
    const user = { _id: 'user-1', isBanned: false };
    const lastPrize = {
      _id: 'last-prize',
      key: 'only-prize',
      name: 'Only prize',
      icon: '🎁',
      hasImage: false,
      baseWeight: 100,
      isUnlimited: false,
      dailyStock: 1,
      dailyIsUnlimited: false,
      dailyPendingCount: 0,
    };
    mocks.findUser.mockReturnValue({ session: vi.fn().mockResolvedValue(user) });
    mocks.updateUser.mockResolvedValue({ modifiedCount: 1 });
    mocks.eligible.mockResolvedValue([lastPrize]);
    mocks.findPrizes.mockReturnValue({ session: vi.fn().mockResolvedValue([lastPrize]) });
    mocks.reservePrize.mockResolvedValue({ modifiedCount: 0 });

    await expect(performSpin(123)).rejects.toMatchObject({ code: 'SPIN_RETRY' });

    expect(rolledBack).toBe(true);
    expect(mocks.reservePrize).toHaveBeenCalledOnce();
    expect(mocks.createSpin).not.toHaveBeenCalled();
    expect(mocks.createUserPrize).not.toHaveBeenCalled();
    expect(mocks.updateUser).toHaveBeenCalledOnce(); // only the transactional cooldown claim
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('rejects a concurrent same-user request before any draw or award write', async () => {
    let rolledBack = false;
    const session = {
      withTransaction: async (work: () => Promise<void>) => {
        try {
          await work();
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
      endSession: vi.fn(),
    };
    mocks.startSession.mockResolvedValue(session);
    mocks.getSettings.mockResolvedValue({
      maintenanceMode: false,
      spinCooldownHours: 24,
      prizeExpiryHours: 24,
      claimReferralsRequired: 5,
    });
    mocks.findUser.mockReturnValue({ session: vi.fn().mockResolvedValue({ _id: 'user-1', isBanned: false }) });
    mocks.updateUser.mockResolvedValue({ modifiedCount: 0 });

    await expect(performSpin(123)).rejects.toMatchObject({ code: 'SPIN_COOLDOWN' });

    expect(rolledBack).toBe(true);
    expect(mocks.eligible).not.toHaveBeenCalled();
    expect(mocks.reservePrize).not.toHaveBeenCalled();
    expect(mocks.createSpin).not.toHaveBeenCalled();
    expect(mocks.createUserPrize).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe('direct prize probabilities', () => {
  it('keeps the remainder as a no-prize result instead of redistributing it', () => {
    expect(noPrizeWeight([{ baseWeight: 30 }])).toBe(70);
    expect(noPrizeWeight([{ baseWeight: 20 }, { baseWeight: 10 }])).toBe(70);
  });

  it('does not create a no-prize remainder when configured chances fill the draw', () => {
    expect(noPrizeWeight([{ baseWeight: 30 }, { baseWeight: 70 }])).toBe(0);
  });
});