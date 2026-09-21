import { connectDatabase, disconnectDatabase } from '../config/database';
import { findDuplicatePrizes, fixDuplicatePrizes } from '../services/prize.service';
import { logger } from '../config/logger';

/**
 * WHY THIS EXISTS
 * ----------------
 * `Prize.key` is declared `unique: true` in the schema, but Mongoose only builds that index
 * when the app starts (and only if `autoIndex` is on) — it does NOT retroactively fix data
 * that already violated uniqueness before the index existed. If two Prize documents ever
 * ended up with the same `key`, MongoDB keeps both forever, with no error raised anywhere.
 *
 * The practical symptom is "the wheel visually lands on one prize but the delivered prize is
 * different" — see the long comment on getCanonicalPrizes() in services/prize.service.ts.
 *
 * NOTE: there's also an admin-panel button that does exactly this (Settings tab) — this CLI
 * script is just an alternative for anyone who prefers a terminal (e.g. Render Shell) over
 * clicking a button in the app. Both call the same underlying functions.
 *
 * Usage:
 *   npm run fix-duplicate-prizes           (just reports — safe to run anytime)
 *   npm run fix-duplicate-prizes -- --fix  (actually merges/deletes duplicates)
 */
async function main() {
  const shouldFix = process.argv.includes('--fix');
  await connectDatabase();

  const duplicates = await findDuplicatePrizes();

  if (duplicates.length === 0) {
    logger.info('✅ No duplicate prize keys found — this was not the cause.');
    await disconnectDatabase();
    process.exit(0);
  }

  logger.warn({ duplicateKeyCount: duplicates.length }, `⚠️  Found ${duplicates.length} prize key(s) with duplicate documents:`);
  for (const dup of duplicates) {
    logger.warn({ key: dup.key, docs: dup.docs }, `Duplicates for key "${dup.key}":`);
  }

  if (!shouldFix) {
    logger.warn('This was a report-only run. Re-run with --fix to actually merge/delete the duplicates above.');
    await disconnectDatabase();
    process.exit(0);
  }

  const results = await fixDuplicatePrizes();
  for (const r of results) {
    logger.info(r, '✅ merged and cleaned duplicate');
  }
  logger.info('✅ Unique index on Prize.key confirmed — this class of bug cannot recur.');

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fix-duplicate-prizes failed:', err);
  process.exit(1);
});
