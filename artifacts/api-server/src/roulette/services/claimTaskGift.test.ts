import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), create: vi.fn(), settings: vi.fn() }));

vi.mock('../models/ClaimTask', () => ({ ClaimTask: { findOne: mocks.findOne, create: mocks.create } }));
vi.mock('../models/UserPrize', () => ({ UserPrize: {} }));
vi.mock('../models/Settings', () => ({ getSettings: mocks.settings }));
vi.mock('./notification.service', () => ({ createNotification: vi.fn() }));
vi.mock('./games.service', () => ({ consumeAdView: vi.fn() }));
vi.mock('../config/env', () => ({ env: { BOT_USERNAME: 'MfRuLiTbot' } }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { ensureClaimTask, needsClaimTask, NO_DEADLINE } from './claimTask.service';

const giftPrize = { _id: 'UP1', user: 'U1', telegramId: 7, source: 'referral', expiresAt: null } as never;

describe('gift-link prizes and the claim steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ wheelClaimReferralsRequired: 5, claimReferralsRequired: 3 });
  });

  it('wheel, daily and gift prizes need the steps; store purchases don\'t', () => {
    expect(needsClaimTask('wheel')).toBe(true);
    expect(needsClaimTask('daily')).toBe(true);
    expect(needsClaimTask('referral')).toBe(true);
    expect(needsClaimTask('store')).toBe(false);
  });

  it('a gift prize gets the same steps as a wheel prize, with no deadline', async () => {
    mocks.findOne.mockResolvedValueOnce(null);
    mocks.create.mockImplementationOnce(async (docs: unknown[]) => docs);
    const task = (await ensureClaimTask(giftPrize)) as unknown as Record<string, unknown>;
    expect(task).toMatchObject({ userPrize: 'UP1', referrerTelegramId: 7, requiredCount: 5, steps: true, shareRequired: 3, status: 'pending', expiresAt: NO_DEADLINE });
  });

  it('keeps the task it already has, and survives two requests making it at once', async () => {
    mocks.findOne.mockResolvedValueOnce({ _id: 'T1' });
    expect(await ensureClaimTask(giftPrize)).toEqual({ _id: 'T1' });
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'T2' });
    mocks.create.mockRejectedValueOnce(new Error('E11000 duplicate key'));
    expect(await ensureClaimTask(giftPrize)).toEqual({ _id: 'T2' });
  });
});
