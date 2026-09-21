import { describe, expect, it } from 'vitest';
import { isPrizeEligible } from './prize.service';

describe('isPrizeEligible', () => {
  it('keeps exhausted prizes out of the draw pool while unlimited prizes remain eligible', () => {
    expect(isPrizeEligible({ isActive: true, baseWeight: 1, isUnlimited: false, stock: 0 })).toBe(false);
    expect(isPrizeEligible({ isActive: true, baseWeight: 1, isUnlimited: false, stock: -3 })).toBe(false);
    expect(isPrizeEligible({ isActive: true, baseWeight: 1, isUnlimited: true, stock: -1 })).toBe(true);
    expect(isPrizeEligible({ isActive: true, baseWeight: 1, isUnlimited: false, stock: -1 })).toBe(false);
  });

  it('excludes inactive and zero-weight prizes regardless of stock', () => {
    expect(isPrizeEligible({ isActive: false, baseWeight: 1, isUnlimited: false, stock: 99 })).toBe(false);
    expect(isPrizeEligible({ isActive: true, baseWeight: 0, isUnlimited: false, stock: 99 })).toBe(false);
  });
});