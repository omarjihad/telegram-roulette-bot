import { describe, expect, it } from 'vitest';
// @ts-ignore The API test runner intentionally imports this pure client math helper.
import { reelSpinPlan, reelTranslateX } from '../../../../bounty-roulette/src/components/reelGeometry';

describe('reel geometry regression', () => {
  it('puts the target card physical center exactly at the measured viewport center', () => {
    const metrics = { viewportWidth: 347, cardWidth: 92, pitch: 104 };
    const targetIndex = 37;
    const translate = reelTranslateX(targetIndex, metrics);
    expect(targetIndex * metrics.pitch + translate + metrics.cardWidth / 2).toBe(metrics.viewportWidth / 2);
  });

  it('ends on the exact requested slot after full visual laps and a bounded rebase', () => {
    const plan = reelSpinPlan(18, 3, 7, 4, 2);
    expect(plan.travelSlots).toBeGreaterThanOrEqual(28);
    expect(plan.settledAbsoluteIndex % 7).toBe(3);
  });
});