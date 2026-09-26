import { describe, expect, it, vi } from 'vitest';

vi.mock('../models/Prize', () => ({ Prize: {} }));
vi.mock('../models/User', () => ({ User: {} }));
vi.mock('../models/UserPrize', () => ({ UserPrize: {} }));
vi.mock('./prize.service', () => ({ prizeImageUrl: () => null }));
vi.mock('./claimTask.service', () => ({ createClaimTaskForPrize: vi.fn() }));

import { computeNextDay } from './dailyLogin.service';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-09-26T12:00:00Z');
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

describe('daily login streak', () => {
  it('starts at day 1 for a user who never collected', () => {
    expect(computeNextDay({ dailyLastClaimAt: null, dailyStreakDay: 0 }, now)).toEqual({ nextDay: 1, missedWindow: false });
  });

  it('continues the streak when collected within the next day', () => {
    expect(computeNextDay({ dailyLastClaimAt: ago(30), dailyStreakDay: 3 }, now)).toEqual({ nextDay: 4, missedWindow: false });
  });

  it('resets to day 1 after missing a full day', () => {
    expect(computeNextDay({ dailyLastClaimAt: ago(49), dailyStreakDay: 5 }, now)).toEqual({ nextDay: 1, missedWindow: true });
  });

  it('starts a new cycle after day 7', () => {
    expect(computeNextDay({ dailyLastClaimAt: ago(25), dailyStreakDay: 7 }, now).nextDay).toBe(1);
  });
});
