import crypto from 'crypto';

/**
 * Returns a cryptographically-secure random float in [0, 1).
 * Using crypto instead of Math.random() for fairness-critical selection (roulette outcome).
 */
export function secureRandomFloat(): number {
  const buf = crypto.randomBytes(4);
  const int = buf.readUInt32BE(0);
  return int / 0x100000000; // divide by 2^32
}

/** Validates a configured weight before it reaches fairness-critical draw logic. */
export function isValidWeight(weight: number): boolean {
  return Number.isFinite(weight) && weight >= 0;
}

/**
 * Weighted random pick. `items` must be a non-empty array of { weight } objects.
 * Weights don't need to sum to 1; they are normalized internally.
 */
export function weightedPickWithRandom<T extends { weight: number }>(items: readonly T[], random: () => number): T {
  if (items.length === 0 || items.some((item) => !isValidWeight(item.weight))) {
    throw new Error('weightedPick: weights must be finite non-negative numbers');
  }
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('weightedPick: total weight must be > 0');
  }
  const source = random();
  if (!Number.isFinite(source) || source < 0 || source >= 1) {
    throw new Error('weightedPick: random source must return a number in [0, 1)');
  }
  const r = source * total;
  let acc = 0;
  for (const item of items) {
    acc += item.weight;
    if (r < acc) return item;
  }
  return items[items.length - 1];
}

export function weightedPick<T extends { weight: number }>(items: readonly T[]): T {
  return weightedPickWithRandom(items, secureRandomFloat);
}
