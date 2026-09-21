import { describe, expect, it } from 'vitest';
import { weightedPickWithRandom } from './random';

describe('weightedPickWithRandom', () => {
  it('honours boundaries without ever falling through to an unrelated item', () => {
    const items = [
      { key: 'first', weight: 2 },
      { key: 'second', weight: 3 },
    ];
    expect(weightedPickWithRandom(items, () => 0).key).toBe('first');
    expect(weightedPickWithRandom(items, () => 0.4).key).toBe('second');
    expect(weightedPickWithRandom(items, () => 0.999999).key).toBe('second');
  });

  it('rejects malformed weights rather than biasing a roulette result', () => {
    expect(() => weightedPickWithRandom([{ key: 'bad', weight: Number.NaN }], () => 0)).toThrow(/finite/i);
    expect(() => weightedPickWithRandom([{ key: 'bad', weight: -1 }], () => 0)).toThrow(/finite/i);
    expect(() => weightedPickWithRandom([{ key: 'zero', weight: 0 }], () => 0)).toThrow(/total weight/i);
  });
});