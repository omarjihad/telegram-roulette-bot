import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  markReleased: vi.fn(),
  findSpin: vi.fn(),
  findPrize: vi.fn(),
  updatePrize: vi.fn(),
  findExpired: vi.fn(),
}));

vi.mock('../models/UserPrize', () => ({ UserPrize: { updateOne: mocks.markReleased, find: mocks.findExpired } }));
vi.mock('../models/RouletteSpin', () => ({ RouletteSpin: { findById: mocks.findSpin } }));
vi.mock('../models/Prize', () => ({ Prize: { findById: mocks.findPrize, updateOne: mocks.updatePrize } }));

import { releasePrizeReservation, restoreStockForPreviouslyExpiredPrizes } from './prizeReservation.service';

function prizeDoc(data: Record<string, unknown>) {
  return { _id: new mongoose.Types.ObjectId(), toObject: () => data };
}

function wonPrize(source: 'wheel' | 'daily' | 'referral' | 'store' = 'wheel') {
  return {
    _id: new mongoose.Types.ObjectId(),
    prize: new mongoose.Types.ObjectId(),
    spinId: new mongoose.Types.ObjectId(),
    source,
  } as never;
}

describe('returning an expired prize to the bot inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markReleased.mockResolvedValue({ modifiedCount: 1 });
    mocks.updatePrize.mockResolvedValue({ modifiedCount: 1 });
  });

  it('returns stock to the same per-mode field the daily wheel reserved from', async () => {
    mocks.findSpin.mockReturnValue({ select: vi.fn().mockResolvedValue({ mode: 'daily', isGiftGuaranteed: false }) });
    mocks.findPrize.mockResolvedValue(prizeDoc({ dailyStock: 0, dailyIsUnlimited: false, dailyPendingCount: 1 }));

    expect(await releasePrizeReservation(wonPrize())).toBe(true);
    expect(mocks.updatePrize).toHaveBeenCalledWith(expect.anything(), { $inc: { dailyStock: 1, dailyPendingCount: -1 } });
  });

  it('uses the points wheel fields for points spins', async () => {
    mocks.findSpin.mockReturnValue({ select: vi.fn().mockResolvedValue({ mode: 'points', isGiftGuaranteed: false }) });
    mocks.findPrize.mockResolvedValue(prizeDoc({ pointsStock: 2, pointsIsUnlimited: false, pointsPendingCount: 3 }));

    await releasePrizeReservation(wonPrize());
    expect(mocks.updatePrize).toHaveBeenCalledWith(expect.anything(), { $inc: { pointsStock: 1, pointsPendingCount: -1 } });
  });

  it('does not add stock to unlimited prizes', async () => {
    mocks.findSpin.mockReturnValue({ select: vi.fn().mockResolvedValue({ mode: 'daily', isGiftGuaranteed: false }) });
    mocks.findPrize.mockResolvedValue(prizeDoc({ dailyStock: -1, dailyIsUnlimited: true, dailyPendingCount: 1 }));

    await releasePrizeReservation(wonPrize());
    expect(mocks.updatePrize).toHaveBeenCalledWith(expect.anything(), { $inc: { dailyPendingCount: -1 } });
  });

  it('never returns the same prize twice', async () => {
    mocks.markReleased.mockResolvedValue({ modifiedCount: 0 });
    expect(await releasePrizeReservation(wonPrize())).toBe(false);
    expect(mocks.updatePrize).not.toHaveBeenCalled();
  });

  it('skips guaranteed gifts and store purchases, which never reserved stock', async () => {
    mocks.findSpin.mockReturnValue({ select: vi.fn().mockResolvedValue({ mode: 'daily', isGiftGuaranteed: true }) });
    expect(await releasePrizeReservation(wonPrize())).toBe(false);
    expect(await releasePrizeReservation(wonPrize('store'))).toBe(false);
    expect(mocks.updatePrize).not.toHaveBeenCalled();
  });
});

describe('restoring prizes that expired before the fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markReleased.mockResolvedValue({ modifiedCount: 1 });
    mocks.updatePrize.mockResolvedValue({ modifiedCount: 1 });
  });

  it('returns stock for every old expired prize that was never released', async () => {
    mocks.findExpired.mockReturnValue({ select: vi.fn().mockResolvedValue([wonPrize(), wonPrize()]) });
    mocks.findSpin.mockReturnValue({ select: vi.fn().mockResolvedValue({ mode: 'daily', isGiftGuaranteed: false }) });
    mocks.findPrize.mockResolvedValue(prizeDoc({ dailyStock: 0, dailyIsUnlimited: false, dailyPendingCount: 2 }));

    expect(await restoreStockForPreviouslyExpiredPrizes()).toEqual({ checked: 2, restored: 2 });
    expect(mocks.findExpired).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired', stockReleasedAt: null, source: { $ne: 'store' } })
    );
    expect(mocks.updatePrize).toHaveBeenCalledTimes(2);
    expect(mocks.updatePrize).toHaveBeenCalledWith(expect.anything(), { $inc: { dailyStock: 1, dailyPendingCount: -1 } });
  });

  it('does not decrement the base pending count twice for legacy items', async () => {
    const legacy = { ...(wonPrize() as object), spinId: null };
    mocks.findExpired.mockReturnValue({ select: vi.fn().mockResolvedValue([legacy]) });
    mocks.findPrize.mockResolvedValue(prizeDoc({ stock: 0, isUnlimited: false, pendingCount: 4 }));

    await restoreStockForPreviouslyExpiredPrizes();
    expect(mocks.updatePrize).toHaveBeenCalledWith(expect.anything(), { $inc: { stock: 1 } });
  });
});
