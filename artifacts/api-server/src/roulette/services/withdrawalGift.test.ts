import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindOne: vi.fn(),
  prizeFindOne: vi.fn(),
  requestCreate: vi.fn(),
  taskFindOne: vi.fn(),
  taskCreate: vi.fn(),
}));

vi.mock('../models/User', () => ({ User: { findOne: mocks.userFindOne } }));
vi.mock('../models/UserPrize', () => ({ UserPrize: { findOne: mocks.prizeFindOne, findOneAndUpdate: vi.fn() } }));
vi.mock('../models/WithdrawalRequest', () => ({ WithdrawalRequest: { create: mocks.requestCreate, findOne: vi.fn() } }));
vi.mock('../models/ClaimTask', () => ({ ClaimTask: { findOne: mocks.taskFindOne, create: mocks.taskCreate, updateOne: vi.fn() } }));
vi.mock('../models/Prize', () => ({ Prize: {} }));
vi.mock('../models/Referral', () => ({ Referral: {} }));
vi.mock('../models/RouletteSpin', () => ({ RouletteSpin: {} }));
vi.mock('../models/AuditLog', () => ({ writeAudit: vi.fn() }));
vi.mock('../models/Settings', () => ({ getSettings: vi.fn(async () => ({ wheelClaimReferralsRequired: 5, claimReferralsRequired: 3 })) }));
vi.mock('./prizeReservation.service', () => ({ releasePrizeReservation: vi.fn() }));
vi.mock('./games.service', () => ({ consumeAdView: vi.fn() }));
vi.mock('./notification.service', () => ({
  createNotification: vi.fn(),
  markWithdrawalDecidedForAdmins: vi.fn(),
  notifyAdminsNewWithdrawal: vi.fn(),
  notifyDeliveryAccountNewWithdrawal: vi.fn(),
}));
vi.mock('./deliveryAccount.service', () => ({
  addDeliveryContact: vi.fn(),
  getDeliveryAccountStatus: vi.fn(async () => ({ configured: false })),
  getDeliveryContactLink: vi.fn(),
  hasVerifiedDeliveryContact: vi.fn(),
}));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { requestClaim } from './withdrawal.service';

const prize = (source: string) => ({ _id: 'UP1', user: 'U1', telegramId: 7, source, status: 'active', expiresAt: null, claimAttempts: 0, prizeNameSnapshot: 'لوفي', save: vi.fn() });

describe('withdrawing a gift-link prize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindOne.mockResolvedValue({ _id: 'U1', telegramId: 7, username: 'omar', isBanned: false });
    mocks.requestCreate.mockResolvedValue({ _id: 'W1' });
  });

  it('is refused until every claim step is done', async () => {
    mocks.prizeFindOne.mockResolvedValueOnce(prize('referral'));
    mocks.taskFindOne.mockResolvedValueOnce({ status: 'pending', requiredCount: 5, creditedCount: 2 });
    await expect(requestClaim(7, 'UP1')).rejects.toMatchObject({ code: 'REFERRALS_REQUIRED' });
    expect(mocks.requestCreate).not.toHaveBeenCalled();
  });

  it('a gift prize from before the rule gets its steps instead of going straight out', async () => {
    mocks.prizeFindOne.mockResolvedValueOnce(prize('referral'));
    mocks.taskFindOne.mockResolvedValueOnce(null);
    mocks.taskCreate.mockImplementationOnce(async (docs: unknown[]) => docs);
    await expect(requestClaim(7, 'UP1')).rejects.toMatchObject({ code: 'REFERRALS_REQUIRED' });
    expect(mocks.taskCreate).toHaveBeenCalledWith([expect.objectContaining({ userPrize: 'UP1', steps: true, requiredCount: 5 })], { session: undefined });
    expect(mocks.requestCreate).not.toHaveBeenCalled();
  });

  it('goes through once the steps are complete; store purchases never needed them', async () => {
    mocks.prizeFindOne.mockResolvedValueOnce(prize('referral'));
    mocks.taskFindOne.mockResolvedValueOnce({ status: 'completed', requiredCount: 5, creditedCount: 5 });
    expect(await requestClaim(7, 'UP1')).toEqual({ _id: 'W1' });

    mocks.prizeFindOne.mockResolvedValueOnce(prize('store'));
    expect(await requestClaim(7, 'UP1')).toEqual({ _id: 'W1' });
    expect(mocks.taskFindOne).toHaveBeenCalledTimes(1);
  });
});
