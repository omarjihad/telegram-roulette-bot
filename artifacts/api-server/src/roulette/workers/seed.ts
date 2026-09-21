import { connectDatabase, disconnectDatabase } from '../config/database';
import { Prize } from '../models/Prize';
import { getSettings } from '../models/Settings';
import { logger } from '../config/logger';

// Exact percentages as specified. Note: they sum to 99.99, not precisely 100 —
// this is fine because the roulette engine always normalizes by the total weight
// of currently-eligible prizes (weight_i / sum_of_eligible_weights), so relative
// odds are unaffected either way. This is never shown to end users.
export const PRIZES = [
  { key: 'gems_3000', name: '💎 حساب 3000 جوهرة', baseWeight: 30, stock: 1000, displayOrder: 1 },
  { key: 'stars_15', name: '⭐ 15 نجمة', baseWeight: 30, stock: 1000, displayOrder: 2 },
  { key: 'asia_credit_1', name: '📱 رصيد آسيا 1', baseWeight: 24.8993, stock: 500, displayOrder: 3 },
  { key: 'gems_5000', name: '💎 5000 جوهرة', baseWeight: 9, stock: 500, displayOrder: 4 },
  { key: 'stars_25', name: '⭐ 25 نجمة', baseWeight: 5.9, stock: 500, displayOrder: 5 },
  { key: 'asia_credit_5', name: '📱 رصيد آسيا 5', baseWeight: 0.1, stock: 50, displayOrder: 6 },
  { key: 'extreme_account_20', name: '⚡ حساب 20 Extreme', baseWeight: 0.0001, stock: 2, displayOrder: 7 },
  { key: 'asia_credit_300', name: '📱 رصيد آسيا 300', baseWeight: 0.0001, stock: 2, displayOrder: 8 },
  { key: 'asia_credit_140', name: '📱 رصيد آسيا 140', baseWeight: 0.0005, stock: 3, displayOrder: 9 },
  { key: 'nft_normal', name: '🎁 NFT عادي', baseWeight: 0.01, stock: 10, displayOrder: 10 },
  { key: 'stars_200', name: '⭐ 200 نجمة', baseWeight: 0.05, stock: 20, displayOrder: 11 },
  { key: 'stars_400', name: '⭐ 400 نجمة', baseWeight: 0.01, stock: 10, displayOrder: 12 },
  { key: 'stars_1000', name: '⭐ 1000 نجمة', baseWeight: 0.005, stock: 5, displayOrder: 13 },
  { key: 'gems_7000', name: '💎 7000 جوهرة', baseWeight: 0.005, stock: 5, displayOrder: 14 },
  { key: 'nft_black', name: '🖤 NFT Black', baseWeight: 0.01, stock: 5, displayOrder: 15 },
];

// Independent, non-wheel bonus granted automatically for each qualified referral.
// Not part of the wheel's weight table — never drawn by the roulette, never gates a wheel prize.
const REFERRAL_BONUS = {
  key: 'referral_bonus',
  name: '🎁 مكافأة إحالة',
  baseWeight: 0,
  stock: -1,
  isUnlimited: true,
  displayOrder: 100,
  requiresManualDelivery: true,
};

async function seed() {
  await connectDatabase();

  for (const p of PRIZES) {
    await Prize.findOneAndUpdate(
      { key: p.key },
      { $setOnInsert: { ...p, deliveredCount: 0, pendingCount: 0, isActive: true, isUnlimited: false, requiresManualDelivery: true } },
      { upsert: true }
    );
  }

  await Prize.findOneAndUpdate(
    { key: REFERRAL_BONUS.key },
    { $setOnInsert: { ...REFERRAL_BONUS, deliveredCount: 0, pendingCount: 0, isActive: true } },
    { upsert: true }
  );

  const settings = await getSettings();
  if (!settings.referralBonusPrizeKey) {
    settings.referralBonusPrizeKey = REFERRAL_BONUS.key;
    await settings.save();
  }

  const totalWeight = PRIZES.reduce((s, p) => s + p.baseWeight, 0);
  logger.info({ totalWeight, prizeCount: PRIZES.length }, '✅ Seed complete');

  await disconnectDatabase();
  process.exit(0);
}

// Only auto-run when this file is executed directly (`npm run seed`), never when another
// module (like scripts/syncPrizeNames.ts) imports PRIZES from it — otherwise importing it
// would silently trigger a full re-seed and then process.exit(0) before the importer's own
// code ever runs.
if (require.main === module) {
  seed().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
