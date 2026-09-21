import { connectDatabase, disconnectDatabase } from '../config/database';
import { Prize } from '../models/Prize';
import { logger } from '../config/logger';
import { PRIZES } from '../workers/seed';

/**
 * Run once after changing a prize's `name` text in seed.ts, on a database that was already
 * seeded before. seed.ts uses $setOnInsert, so it never touches an existing document — this
 * script is the deliberate, explicit way to push a text-only update (name) to prizes that
 * already exist. Note: the emoji is part of the `name` string itself (e.g. "💎 حساب 3000
 * جوهرة") — the separate `Prize.icon` field is admin-set independently (via the panel's
 * "تغيير الإيموجي" / image upload) and is intentionally left untouched here.
 * This never touches stock, baseWeight, isActive, or any custom imageUrl.
 *
 * Usage: npm run sync-prize-names   (see package.json)
 */
async function syncPrizeNames() {
  await connectDatabase();

  let updated = 0;
  for (const p of PRIZES) {
    const res = await Prize.updateOne({ key: p.key, name: { $ne: p.name } }, { $set: { name: p.name } });
    if (res.modifiedCount > 0) {
      updated += 1;
      logger.info({ key: p.key, name: p.name }, 'synced prize name');
    }
  }

  logger.info({ updated, checked: PRIZES.length }, '✅ Prize name sync complete');
  await disconnectDatabase();
  process.exit(0);
}

syncPrizeNames().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Sync failed:', err);
  process.exit(1);
});
