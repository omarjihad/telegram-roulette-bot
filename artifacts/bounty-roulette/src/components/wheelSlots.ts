export interface WheelSlot {
  key: string;
  icon: string;
  imageUrl: string | null;
  label: string;
  isAvailable: boolean;
  availability: 'available' | 'out_of_stock' | 'unavailable';
}

export interface PublicPrize {
  key: string;
  name: string;
  icon: string;
  imageUrl: string | null;
  /** False means the prize remains on the reel for transparency, but has no stock. */
  isAvailable: boolean;
  availability: 'available' | 'out_of_stock' | 'unavailable';
}

const EMPTY_SLOT: WheelSlot = {
  key: '__empty__',
  icon: '🍀',
  imageUrl: null,
  label: 'حظ أوفر',
  isAvailable: true,
  availability: 'available',
};

// How many real prize cards appear between each neutral "حظ أوفر" card, purely visual.
const EMPTY_EVERY = 4;

/**
 * Builds the wheel's visual card list directly from the live prize list the server just
 * returned (GET /wheel/prizes) — the same Prize documents the spin itself draws from, so
 * there is no separate hardcoded copy that can ever drift out of sync (a mismatched/renamed
 * key used to make the wheel land on a random card unrelated to the real prize).
 *
 * '__empty__' is a dedicated "no prize this time" slot, interspersed at a fixed interval.
 * When a spin doesn't win anything, the wheel must land on one of THESE — never on a random
 * real prize card, which would look exactly like winning something and then being told
 * otherwise.
 */
export function buildWheelSlots(prizes: PublicPrize[]): WheelSlot[] {
  const slots: WheelSlot[] = [];
  prizes.forEach((p, i) => {
    slots.push({
      key: p.key,
      icon: p.icon,
      imageUrl: p.imageUrl,
      label: p.name,
      isAvailable: p.isAvailable,
      availability: p.availability,
    });
    if ((i + 1) % EMPTY_EVERY === 0) slots.push(EMPTY_SLOT);
  });
  if (slots.length === 0 || slots[slots.length - 1].key !== '__empty__') slots.push(EMPTY_SLOT);
  return slots;
}

/**
 * Finds the exact card to put under the pointer. A missing awarded key is intentionally
 * represented by null: callers must add the authoritative server prize to the reel instead
 * of silently substituting an empty or unrelated card.
 */
export function findSlotIndexForKey(slots: WheelSlot[], key: string | null | undefined): number | null {
  if (!key) return slots.findIndex((slot) => slot.key === '__empty__');
  const index = slots.findIndex((slot) => slot.key === key);
  return index === -1 ? null : index;
}
