import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  giftCreate: vi.fn(),
  giftClaim: vi.fn(),
  giftUpdateOne: vi.fn(),
  giftFindOne: vi.fn(),
  prizeFindOne: vi.fn(),
  prizeFindById: vi.fn(),
  prizeUpdateOne: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
  userPrizeCreate: vi.fn(),
  userPrizeIds: vi.fn(),
  userPrizeUpdateMany: vi.fn(),
  taskUpdateMany: vi.fn(),
  ensureTask: vi.fn(),
}));

vi.mock('../models/GiftLink', () => ({
  GiftLink: { create: mocks.giftCreate, findOneAndUpdate: mocks.giftClaim, updateOne: mocks.giftUpdateOne, findOne: mocks.giftFindOne },
}));
vi.mock('../models/Prize', () => ({
  Prize: { findOne: (...a: unknown[]) => ({ select: () => mocks.prizeFindOne(...a) }), findById: mocks.prizeFindById, updateOne: mocks.prizeUpdateOne },
}));
vi.mock('../models/User', () => ({ User: { findOne: mocks.userFindOne, updateOne: mocks.userUpdateOne } }));
vi.mock('../models/UserPrize', () => ({
  UserPrize: { create: mocks.userPrizeCreate, find: (...a: unknown[]) => ({ distinct: () => mocks.userPrizeIds(...a) }), updateMany: mocks.userPrizeUpdateMany },
}));
vi.mock('../models/ClaimTask', () => ({ ClaimTask: { updateMany: mocks.taskUpdateMany } }));
vi.mock('./claimTask.service', () => ({ ensureClaimTask: mocks.ensureTask }));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { backfillGiftPrizeExpiry, createGiftLink, GIFT_PRIZE_EXPIRY_MS, redeemGiftLink } from './giftLink.service';

const link = (over: Record<string, unknown> = {}) => ({
  _id: 'G1',
  rewardType: 'points',
  pointsAmount: 10,
  prize: null,
  message: null,
  redemptionCount: 1,
  maxRedemptions: 5,
  ...over,
});

describe('gift links: the developer\'s own message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.giftCreate.mockImplementation(async (doc: Record<string, unknown>) => ({ ...doc, token: 'tok' }));
    mocks.userFindOne.mockResolvedValue({ _id: 'U1', telegramId: 7 });
  });

  it('keeps the message as written (trimmed); blank means the usual one; too long is refused', async () => {
    await createGiftLink({ rewardType: 'points', pointsAmount: 10, createdByTelegramId: 1, message: '  هدية خاصة 🎁\nكمّل المهام  ' });
    expect(mocks.giftCreate).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'هدية خاصة 🎁\nكمّل المهام' }));

    await createGiftLink({ rewardType: 'points', pointsAmount: 10, createdByTelegramId: 1, message: '   ' });
    expect(mocks.giftCreate).toHaveBeenLastCalledWith(expect.objectContaining({ message: null }));

    await expect(createGiftLink({ rewardType: 'points', pointsAmount: 10, createdByTelegramId: 1, message: 'x'.repeat(2001) })).rejects.toThrow();
  });

  it('opening the link sends the developer\'s message instead of the usual one', async () => {
    mocks.giftClaim.mockResolvedValueOnce(link({ message: 'هلا بيك! هاي هديتك من قناة MF 🎁' }));
    expect(await redeemGiftLink('tok', 7)).toEqual({ message: 'هلا بيك! هاي هديتك من قناة MF 🎁', custom: true });
    expect(mocks.userUpdateOne).toHaveBeenCalledWith({ _id: 'U1' }, { $inc: { spinPoints: 10 } });

    // A daily spin keeps its "spin now" button with a custom message too.
    mocks.giftClaim.mockResolvedValueOnce(link({ rewardType: 'daily_spin', message: 'فرتك الهدية 🎡' }));
    expect(await redeemGiftLink('tok', 7)).toEqual({ message: 'فرتك الهدية 🎡', custom: true, isSpin: true });

    // No message: the usual one.
    mocks.giftClaim.mockResolvedValueOnce(link());
    const usual = await redeemGiftLink('tok', 7);
    expect(usual.custom).toBe(false);
    expect(usual.message).toContain('10 نقطة');
  });

  it('a prize from a link goes to the bag with the full claim steps, and 24 hours to do them', async () => {
    mocks.giftClaim.mockResolvedValueOnce(link({ rewardType: 'prize', prize: 'P1', pointsAmount: null }));
    mocks.prizeFindById.mockResolvedValueOnce({ _id: 'P1', name: 'لوفي جير 5', isUnlimited: true });
    const userPrize = { _id: 'UP1', source: 'referral', expiresAt: null };
    mocks.userPrizeCreate.mockResolvedValueOnce(userPrize);
    mocks.ensureTask.mockResolvedValueOnce({ status: 'pending' });

    const before = Date.now();
    const res = await redeemGiftLink('tok', 7);
    expect(mocks.userPrizeCreate).toHaveBeenCalledWith(expect.objectContaining({ source: 'referral', status: 'active', prizeNameSnapshot: 'لوفي جير 5' }));
    const expiresAt = (mocks.userPrizeCreate.mock.calls[0][0] as { expiresAt: Date }).expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + GIFT_PRIZE_EXPIRY_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + GIFT_PRIZE_EXPIRY_MS);
    expect(GIFT_PRIZE_EXPIRY_MS).toBe(24 * 60 * 60 * 1000);
    expect(mocks.ensureTask).toHaveBeenCalledWith(userPrize);
    expect(res.custom).toBe(false);
    expect(res.message).toContain('لوفي جير 5');
    expect(res.message).toContain('كمّل مهام الاستلام كاملة');
    expect(res.message).toContain('خلال 24 ساعة');
  });

  it('gift prizes from before the deadline get 24 hours from now, and so do their tasks', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const deadline = new Date('2026-10-11T12:00:00Z');
    mocks.userPrizeIds.mockResolvedValueOnce(['UP1', 'UP2']);
    mocks.userPrizeUpdateMany.mockResolvedValueOnce({ modifiedCount: 2 });
    expect(await backfillGiftPrizeExpiry(now)).toBe(2);
    expect(mocks.userPrizeIds).toHaveBeenCalledWith({ source: 'referral', status: 'active', expiresAt: null });
    expect(mocks.userPrizeUpdateMany).toHaveBeenCalledWith({ _id: { $in: ['UP1', 'UP2'] }, expiresAt: null }, { $set: { expiresAt: deadline } });
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith({ userPrize: { $in: ['UP1', 'UP2'] } }, { $set: { expiresAt: deadline } });

    // Nothing left to do: nothing touched.
    mocks.userPrizeIds.mockResolvedValueOnce([]);
    mocks.userPrizeUpdateMany.mockClear();
    expect(await backfillGiftPrizeExpiry(now)).toBe(0);
    expect(mocks.userPrizeUpdateMany).not.toHaveBeenCalled();
  });
});
