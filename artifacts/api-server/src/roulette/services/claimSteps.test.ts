import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), notify: vi.fn(), consumeAd: vi.fn() }));
vi.mock('../models/ClaimTask', () => ({ ClaimTask: { findOne: mocks.findOne } }));
vi.mock('../models/UserPrize', () => ({ UserPrize: {} }));
vi.mock('../models/Settings', () => ({ getSettings: vi.fn() }));
vi.mock('./notification.service', () => ({ createNotification: mocks.notify }));
vi.mock('./games.service', () => ({ consumeAdView: mocks.consumeAd }));
vi.mock('../config/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { completeClaimAdStep, confirmShareSent, currentStep, recordSharedCard, shareCount } from './claimTask.service';

function task(over: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    referrerTelegramId: 10,
    token: 'abcdefghij',
    status: 'pending',
    steps: true,
    adWatchedAt: null as Date | null,
    shareRequired: 3,
    sharedInlineIds: [] as string[],
    sharePreparedIds: ['p1', 'p2'] as string[],
    shareConfirmedIds: [] as string[],
    creditedCount: 0,
    requiredCount: 7,
    save: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockResolvedValue(undefined);
});

describe('claim steps', () => {
  it('goes ad -> share -> invites, and old tasks are invites only', () => {
    expect(currentStep(task() as never)).toBe(1);
    expect(currentStep(task({ adWatchedAt: new Date() }) as never)).toBe(2);
    expect(currentStep(task({ adWatchedAt: new Date(), sharedInlineIds: ['a', 'b', 'c'] }) as never)).toBe(3);
    expect(currentStep(task({ adWatchedAt: new Date(), sharedInlineIds: ['a', 'b', 'c'], creditedCount: 7 }) as never)).toBe(4);
    expect(currentStep(task({ steps: false, creditedCount: 2 }) as never)).toBe(3);
  });

  it('counts chats Telegram reports, or confirmed shares, whichever is more', () => {
    expect(shareCount({ sharedInlineIds: ['a', 'b', 'c'], shareConfirmedIds: ['p1'] })).toBe(3);
    expect(shareCount({ sharedInlineIds: [], shareConfirmedIds: ['p1', 'p2'] })).toBe(2);
  });

  it('marks the ad step once the ad view is confirmed', async () => {
    const tk = task();
    mocks.findOne.mockResolvedValue(tk);
    mocks.consumeAd.mockResolvedValue(undefined);
    const r = await completeClaimAdStep(10, String(new mongoose.Types.ObjectId()));
    expect(mocks.consumeAd).toHaveBeenCalledWith(10, 'claim_task');
    expect(r.step).toBe(2);
  });

  it('counts each confirmed share window once, only if we opened it', async () => {
    const tk = task({ adWatchedAt: new Date() });
    mocks.findOne.mockResolvedValue(tk);
    await confirmShareSent(10, String(new mongoose.Types.ObjectId()), 'p1');
    await confirmShareSent(10, String(new mongoose.Types.ObjectId()), 'p1');
    await confirmShareSent(10, String(new mongoose.Types.ObjectId()), 'forged');
    expect(tk.shareConfirmedIds).toEqual(['p1']);
  });

  it('records each chat from chosen_inline_result and completes when all is done', async () => {
    const tk = task({ adWatchedAt: new Date(), sharedInlineIds: ['a', 'b'], creditedCount: 7 });
    mocks.findOne.mockResolvedValue(tk);
    expect(await recordSharedCard('cs_abcdefghij_x1y2z3w4', 10, 'c')).toBe(true);
    expect(tk.sharedInlineIds).toEqual(['a', 'b', 'c']);
    expect(tk.status).toBe('completed');
    expect(mocks.notify).toHaveBeenCalled();
    expect(await recordSharedCard('something_else', 10, 'd')).toBe(false);
  });
});
