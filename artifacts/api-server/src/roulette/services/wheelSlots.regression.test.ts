import { describe, expect, it } from 'vitest';
// This is a pure client helper: importing it in the API test runner requires neither a
// browser nor a database and protects the server-result-to-pointer contract end to end.
// @ts-ignore The API's production rootDir intentionally excludes client source.
import { buildWheelSlots, findSlotIndexForKey } from '../../../../bounty-roulette/src/components/wheelSlots';

describe('wheel result slot regression', () => {
  const slots = buildWheelSlots([
    { key: 'available', name: 'Available', icon: '🎁', imageUrl: null, isAvailable: true, availability: 'available' },
    { key: 'sold-out', name: 'Sold out', icon: '💎', imageUrl: null, isAvailable: false, availability: 'out_of_stock' },
  ]);

  it('keeps exhausted prizes visible but preserves their unavailable state', () => {
    expect(slots.find((slot) => slot.key === 'sold-out')).toMatchObject({ isAvailable: false });
  });

  it('never substitutes an empty or unrelated slot for an unknown awarded key', () => {
    expect(findSlotIndexForKey(slots, 'available')).not.toBeNull();
    expect(findSlotIndexForKey(slots, 'server-awarded-after-list-refresh')).toBeNull();
    expect(findSlotIndexForKey(slots, null)).toBe(slots.findIndex((slot) => slot.key === '__empty__'));
  });
});