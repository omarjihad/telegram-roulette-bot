import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  blockId: vi.fn(),
  consume: vi.fn(),
}));

vi.mock('../models/User', () => ({ User: { findOneAndUpdate: mocks.findOneAndUpdate, updateOne: mocks.updateOne } }));
vi.mock('./games.service', () => ({ adsBlockId: mocks.blockId, consumeAdView: mocks.consume }));

import { adSpinDay, adSpinsLeft, spinWithAd } from './adSpin.service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.blockId.mockResolvedValue('50375');
  mocks.consume.mockResolvedValue(undefined);
});

describe('wheel spins with an ad', () => {
  it('always lands on "better luck" and counts down the 3 daily spins', async () => {
    mocks.findOneAndUpdate.mockResolvedValue({ adSpinDay: adSpinDay(), adSpinCount: 1 });
    const res = await spinWithAd(5);
    expect(res.result.won).toBe(false);
    expect(res.adSpinsLeft).toBe(2);
    expect(mocks.consume).toHaveBeenCalledWith(5, 'wheel_ad_spin');
  });

  it('refuses a 4th spin the same day', async () => {
    mocks.findOneAndUpdate.mockResolvedValue(null);
    await expect(spinWithAd(5)).rejects.toMatchObject({ code: 'AD_SPIN_LIMIT' });
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it('gives the slot back when the ad is not confirmed yet', async () => {
    mocks.findOneAndUpdate.mockResolvedValue({ adSpinDay: adSpinDay(), adSpinCount: 1 });
    mocks.consume.mockRejectedValue(Object.assign(new Error('x'), { code: 'AD_NOT_CONFIRMED' }));
    await expect(spinWithAd(5)).rejects.toMatchObject({ code: 'AD_NOT_CONFIRMED' });
    expect(mocks.updateOne).toHaveBeenCalledWith(expect.objectContaining({ telegramId: 5 }), { $inc: { adSpinCount: -1 } });
  });

  it('resets the count on a new day', () => {
    expect(adSpinsLeft({ adSpinDay: '2000-01-01', adSpinCount: 3 })).toBe(3);
    expect(adSpinsLeft({ adSpinDay: adSpinDay(), adSpinCount: 3 })).toBe(0);
  });
});
