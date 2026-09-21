import { Prize, IPrize } from '../models/Prize';
import { writeAudit } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { notifyAllAdmins } from './notification.service';
import { ClientSession, HydratedDocument } from 'mongoose';

export type WheelMode = 'daily' | 'points';

function modeField(mode: WheelMode, field: 'weight' | 'stock' | 'unlimited' | 'pending') {
  return `${mode}${field === 'weight' ? 'Weight' : field === 'stock' ? 'Stock' : field === 'unlimited' ? 'IsUnlimited' : 'PendingCount'}`;
}

export function getPrizeWeight(prize: Pick<IPrize, 'baseWeight' | 'dailyWeight' | 'pointsWeight'>, mode: WheelMode) {
  return mode === 'daily' ? (prize.dailyWeight ?? prize.baseWeight) : (prize.pointsWeight ?? prize.baseWeight);
}

export function getPrizeStock(prize: Pick<IPrize, 'stock' | 'dailyStock' | 'pointsStock'>, mode: WheelMode) {
  return mode === 'daily' ? (prize.dailyStock ?? prize.stock) : (prize.pointsStock ?? prize.stock);
}

export function getPrizeUnlimited(prize: Pick<IPrize, 'isUnlimited' | 'dailyIsUnlimited' | 'pointsIsUnlimited'>, mode: WheelMode) {
  return mode === 'daily' ? (prize.dailyIsUnlimited ?? prize.isUnlimited) : (prize.pointsIsUnlimited ?? prize.isUnlimited);
}

/**
 * Collapses multiple Prize documents that share the same `key` down to one — keeping
 * whichever was updated most recently. `key` is supposed to be unique (enforced by a
 * schema index), but if that index ever failed to build on a database that already had a
 * duplicate (see scripts/fixDuplicatePrizes.ts for why that can happen silently), every
 * query in the app would otherwise see multiple documents for the same prize and could
 * inconsistently pick different ones in different places — e.g. the wheel's visual list
 * showing one duplicate's name/image while the actual spin draws from the other. This makes
 * every prize-reading code path safe regardless of whether that cleanup script has been run.
 */
function dedupeByKeyKeepingNewest<T extends { key: string; updatedAt: Date }>(prizes: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const p of prizes) {
    const existing = byKey.get(p.key);
    if (!existing || p.updatedAt > existing.updatedAt) byKey.set(p.key, p);
  }
  return Array.from(byKey.values());
}

/** Builds the served image URL for a prize that has a custom image, or null otherwise.
 * The actual bytes live in MongoDB (see Prize.imageData) and are streamed by the dedicated
 * /api/prizes/:key/image route — never written to local disk, which is not durable on
 * platforms like Render where the container's disk is wiped on every restart/redeploy. */
export function prizeImageUrl(key: string, hasImage: boolean): string | null {
  return hasImage ? `/api/prizes/${key}/image` : null;
}

export interface DuplicatePrizeReport {
  key: string;
  docs: { id: string; name: string; stock: number; isActive: boolean; updatedAt: Date }[];
}

export interface DuplicatePrizeFixResult {
  key: string;
  keptId: string;
  deletedCount: number;
  mergedStock: number;
}

/**
 * Finds Prize documents that share the same `key` (see the long comment in
 * scripts/fixDuplicatePrizes.ts for why this can happen and why it causes "wheel shows one
 * prize, delivers another"). Report-only — never modifies anything.
 */
export async function findDuplicatePrizes(): Promise<DuplicatePrizeReport[]> {
  const duplicates = await Prize.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$key', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  const reports: DuplicatePrizeReport[] = [];
  for (const dup of duplicates) {
    const docs = await Prize.find({ key: dup._id }).sort({ updatedAt: -1 });
    reports.push({
      key: dup._id,
      docs: docs.map((d) => ({ id: String(d._id), name: d.name, stock: d.stock, isActive: d.isActive, updatedAt: d.updatedAt })),
    });
  }
  return reports;
}

/**
 * Actually merges/deletes the duplicates found by findDuplicatePrizes: keeps whichever
 * document was updated most recently per key, sums stock/deliveredCount/pendingCount from
 * all duplicates into it (no inventory count is silently lost), deletes the rest, and
 * ensures the unique index on Prize.key actually exists afterward.
 */
export async function fixDuplicatePrizes(): Promise<DuplicatePrizeFixResult[]> {
  const duplicates = await Prize.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$key', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  const results: DuplicatePrizeFixResult[] = [];
  for (const dup of duplicates) {
    const docs = await Prize.find({ key: dup._id }).sort({ updatedAt: -1 });
    const [keep, ...rest] = docs;
    const mergedStock = keep.isUnlimited ? keep.stock : docs.reduce((sum, d) => sum + (d.isUnlimited ? 0 : d.stock), 0);
    const mergedDelivered = docs.reduce((sum, d) => sum + d.deliveredCount, 0);
    const mergedPending = docs.reduce((sum, d) => sum + d.pendingCount, 0);

    keep.stock = mergedStock;
    keep.deliveredCount = mergedDelivered;
    keep.pendingCount = mergedPending;
    await keep.save();

    for (const d of rest) {
      await Prize.deleteOne({ _id: d._id });
    }

    results.push({ key: dup._id, keptId: String(keep._id), deletedCount: rest.length, mergedStock });
  }

  if (duplicates.length > 0) {
    await Prize.collection.createIndex({ key: 1 }, { unique: true });
  }

  return results;
}

export async function listPrizes(): Promise<HydratedDocument<IPrize>[]> {
  return Prize.find({}).sort({ displayOrder: 1, createdAt: 1 });
}

/**
 * Fetches every Prize document and collapses duplicates down to one canonical document per
 * key (see dedupeByKeyKeepingNewest). This MUST run before any eligibility filtering
 * (isActive, stock, weight, etc.) — filtering first and deduping the filtered results, as
 * earlier code here did, lets two different callers with different filters resolve the same
 * key to two DIFFERENT documents when duplicates exist (e.g. the newest duplicate has 0
 * stock and gets filtered out of the draw pool, while an older duplicate with stock remains
 * and gets drawn from — meanwhile the unfiltered wheel-display query still shows the newest
 * one's name/image). Deduping first means every caller filters the exact same canonical set,
 * so this class of divergence is structurally impossible now, not just less likely.
 */
export async function getCanonicalPrizes(session?: ClientSession): Promise<HydratedDocument<IPrize>[]> {
  const query = Prize.find({});
  if (session) query.session(session);
  const all = await query;
  return dedupeByKeyKeepingNewest(all);
}

/** Public-safe view for the client wheel: no stock/weight/delivery counts — just what a
 * user is allowed to see. Exhausted prizes deliberately remain visible, but the explicit
 * availability flag makes it clear that they cannot be selected by the server. */
export async function listPublicWheelPrizes(mode: WheelMode = 'daily') {
  const canonical = await getCanonicalPrizes();
  const prizes = canonical
    .filter((p) => p.isActive && p.key !== 'referral_bonus')
    .sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt.getTime() - b.createdAt.getTime());
  return prizes.map((p) => ({
    key: p.key,
    name: p.name,
    icon: p.icon,
    imageUrl: prizeImageUrl(p.key, p.hasImage),
    isAvailable: isPrizeEligible(p, mode),
    availability: isPrizeEligible(p, mode)
      ? 'available'
      : !getPrizeUnlimited(p, mode) && getPrizeStock(p, mode) <= 0
      ? 'out_of_stock'
      : 'unavailable',
  }));
}

export async function getPrizeByKey(key: string) {
  return Prize.findOne({ key });
}

export async function createPrize(data: {
  key: string;
  name: string;
  icon: string;
  baseWeight: number;
  dailyWeight?: number;
  pointsWeight?: number;
  stock: number;
  dailyStock?: number;
  pointsStock?: number;
  isUnlimited?: boolean;
  dailyIsUnlimited?: boolean;
  pointsIsUnlimited?: boolean;
  displayOrder?: number;
  requiresManualDelivery?: boolean;
  actorId: number;
  actorUsername?: string;
}) {
  const existing = await Prize.findOne({ key: data.key });
  if (existing) throw new AppError('Prize key already exists', 409, 'PRIZE_EXISTS');
  const dailyWeight = data.dailyWeight ?? data.baseWeight;
  const pointsWeight = data.pointsWeight ?? data.baseWeight;
  const current = await Prize.aggregate<{ daily: number; points: number }>([
    {
      $group: {
        _id: null,
        daily: { $sum: { $ifNull: ['$dailyWeight', '$baseWeight'] } },
        // A legacy document has no pointsWeight and is normalized to the existing
        // 30% points-wheel cap at draw time. Only explicitly configured points
        // weights participate in this admin-side 30% validation.
        points: { $sum: { $ifNull: ['$pointsWeight', 0] } },
      },
    },
  ]);
  const currentDaily = current[0]?.daily ?? 0;
  const currentPoints = current[0]?.points ?? 0;
  if (currentDaily + dailyWeight > 100.001) {
    throw new AppError('مجموع نسب العجلة اليومية يجب ألا يتجاوز 100%.', 422, 'PRIZE_WEIGHT_LIMIT');
  }
  if (currentPoints + pointsWeight > 30.001) {
    throw new AppError('مجموع نسب عجلة النقاط يجب ألا يتجاوز 30%. حظ أوفر ثابت 70%.', 422, 'PRIZE_WEIGHT_LIMIT');
  }

  const prize = await Prize.create({
    key: data.key,
    name: data.name,
    icon: data.icon || '🎁',
    baseWeight: data.baseWeight,
    dailyWeight,
    pointsWeight,
    stock: data.isUnlimited ? -1 : data.stock,
    isUnlimited: !!data.isUnlimited,
    dailyStock: data.dailyIsUnlimited ? -1 : data.dailyStock ?? data.stock,
    pointsStock: data.pointsIsUnlimited ? -1 : data.pointsStock ?? data.stock,
    dailyIsUnlimited: data.dailyIsUnlimited ?? data.isUnlimited ?? false,
    pointsIsUnlimited: data.pointsIsUnlimited ?? data.isUnlimited ?? false,
    displayOrder: data.displayOrder ?? 0,
    requiresManualDelivery: data.requiresManualDelivery ?? true,
  });

  await writeAudit({
    actorId: data.actorId,
    actorUsername: data.actorUsername,
    action: 'prize.create',
    target: prize.key,
    metadata: { name: prize.name, baseWeight: prize.baseWeight, stock: prize.stock },
  });

  return prize;
}

export async function updatePrizeDetails(
  key: string,
  data: {
    name?: string;
    icon?: string;
    storePrice?: number | null;
    baseWeight?: number;
    dailyWeight?: number;
    pointsWeight?: number;
  },
  actorId: number,
  actorUsername?: string
) {
  const prize = await Prize.findOne({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  const weightUpdates: Array<{ field: 'baseWeight' | 'dailyWeight' | 'pointsWeight'; value: number; limit: number }> = [];
  if (data.baseWeight !== undefined) weightUpdates.push({ field: 'baseWeight', value: data.baseWeight, limit: 100 });
  if (data.dailyWeight !== undefined) weightUpdates.push({ field: 'dailyWeight', value: data.dailyWeight, limit: 100 });
  if (data.pointsWeight !== undefined) weightUpdates.push({ field: 'pointsWeight', value: data.pointsWeight, limit: 30 });
  for (const update of weightUpdates) {
    if (!Number.isFinite(update.value) || update.value < 0) {
      throw new AppError(`${update.field} must be a non-negative number`, 422, 'VALIDATION_ERROR');
    }
    const match: Record<string, unknown> = { _id: { $ne: prize._id } };
    if (update.field === 'pointsWeight') match.pointsWeight = { $ne: null };
    const current = await Prize.aggregate<{ total: number }>([
       { $match: match },
       {
         $group: {
           _id: null,
           total: {
             $sum:
               update.field === 'dailyWeight'
                 ? { $ifNull: ['$dailyWeight', '$baseWeight'] }
                 : `$${update.field}`,
           },
         },
       },
     ]);
    if ((current[0]?.total ?? 0) + update.value > update.limit + 0.001) {
      throw new AppError(
        update.field === 'dailyWeight'
          ? 'مجموع نسب العجلة اليومية يجب ألا يتجاوز 100%.'
          : 'مجموع نسب عجلة النقاط يجب ألا يتجاوز 30%. حظ أوفر ثابت 70%.',
        422,
        'PRIZE_WEIGHT_LIMIT'
      );
    }
    prize[update.field] = update.value;
  }

  if (data.name !== undefined && data.name.trim()) prize.name = data.name.trim();
  if (data.icon !== undefined && data.icon.trim()) prize.icon = data.icon.trim();
  // storePrice: undefined = leave unchanged, null = remove from store, number = set price
  if (data.storePrice !== undefined) prize.storePrice = data.storePrice;
  await prize.save();

  await writeAudit({
    actorId,
    actorUsername,
    action: 'prize.update',
    target: key,
    metadata: { name: prize.name, icon: prize.icon, storePrice: prize.storePrice },
  });

  return prize;
}

/** Stores the uploaded image's bytes directly on the Prize document in MongoDB. */
export async function setPrizeImage(
  key: string,
  buffer: Buffer,
  mimeType: string,
  actorId: number,
  actorUsername?: string
) {
  const prize = await Prize.findOne({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');

  prize.imageData = buffer;
  prize.imageMimeType = mimeType;
  prize.hasImage = true;
  await prize.save();

  await writeAudit({ actorId, actorUsername, action: 'prize.image.set', target: key, metadata: { sizeBytes: buffer.length, mimeType } });
  return prize;
}

export async function clearPrizeImage(key: string, actorId: number, actorUsername?: string) {
  const prize = await Prize.findOne({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');

  prize.imageData = null;
  prize.imageMimeType = null;
  prize.hasImage = false;
  await prize.save();

  await writeAudit({ actorId, actorUsername, action: 'prize.image.clear', target: key });
  return prize;
}

/** Loads the actual image bytes for serving — the only place that ever selects imageData. */
export async function getPrizeImageData(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const prize = await Prize.findOne({ key }).select('imageData imageMimeType hasImage');
  if (!prize || !prize.hasImage || !prize.imageData) return null;
  return { data: prize.imageData, mimeType: prize.imageMimeType || 'image/jpeg' };
}

export async function deletePrize(key: string, actorId: number, actorUsername?: string) {
  const prize = await Prize.findOneAndDelete({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  await writeAudit({
    actorId,
    actorUsername,
    action: 'prize.delete',
    target: key,
    metadata: { name: prize.name },
  });
  return prize;
}

export async function addStock(key: string, amount: number, actorId: number, actorUsername?: string, mode: WheelMode = 'daily') {
  if (amount <= 0) throw new AppError('Amount must be positive', 422, 'VALIDATION_ERROR');

  const prize = await Prize.findOne({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  const stockField = modeField(mode, 'stock') as 'dailyStock' | 'pointsStock';
  const unlimitedField = modeField(mode, 'unlimited') as 'dailyIsUnlimited' | 'pointsIsUnlimited';
  const oldStock = getPrizeStock(prize, mode);
  const isUnlimited = getPrizeUnlimited(prize, mode);
  if (isUnlimited) throw new AppError('This prize has unlimited stock', 400, 'UNLIMITED_PRIZE');

  (prize as any)[stockField] = oldStock + amount;
  const wasOutOfStock = oldStock <= 0;
  await prize.save();

  await writeAudit({
    actorId,
    actorUsername,
    action: 'prize.stock.add',
    target: key,
    metadata: { mode, oldStock, addedAmount: amount, newStock: (prize as any)[stockField] },
  });

   if (wasOutOfStock && (prize as any)[stockField] > 0 && !prize.isActive) {
    // Optionally re-activate if it was auto-disabled — left as explicit admin action instead of automatic,
    // to avoid surprising re-activation. See setActive().
  }

  return prize;
}

export async function removeStock(key: string, amount: number, actorId: number, actorUsername?: string, mode: WheelMode = 'daily') {
  if (amount <= 0) throw new AppError('Amount must be positive', 422, 'VALIDATION_ERROR');

  const prize = await Prize.findOne({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  const stockField = modeField(mode, 'stock') as 'dailyStock' | 'pointsStock';
  const isUnlimited = getPrizeUnlimited(prize, mode);
  if (isUnlimited) throw new AppError('This prize has unlimited stock', 400, 'UNLIMITED_PRIZE');

  const oldStock = getPrizeStock(prize, mode);
  (prize as any)[stockField] = Math.max(0, oldStock - amount);
  await prize.save();

  await writeAudit({
    actorId,
    actorUsername,
    action: 'prize.stock.remove',
    target: key,
    metadata: { mode, oldStock, removedAmount: amount, newStock: (prize as any)[stockField] },
  });

  if (oldStock > 0 && (prize as any)[stockField] === 0) {
    await notifyAllAdmins(
      'system_announcement',
      '⚠️ تنبيه مخزون',
      `الجائزة:\n${prize.name}\n\nنفد مخزونها بالكامل.`
    );
    await writeAudit({ actorId, actorUsername, action: 'prize.out_of_stock', target: key });
  }

  return prize;
}

export async function setStockExact(key: string, newStock: number, actorId: number, actorUsername?: string, mode: WheelMode = 'daily') {
  const prize = await Prize.findOne({ key });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  const stockField = modeField(mode, 'stock') as 'dailyStock' | 'pointsStock';
  const isUnlimited = getPrizeUnlimited(prize, mode);
  if (isUnlimited) throw new AppError('This prize has unlimited stock', 400, 'UNLIMITED_PRIZE');

  const oldStock = getPrizeStock(prize, mode);
  (prize as any)[stockField] = Math.max(0, newStock);
  await prize.save();

  await writeAudit({
    actorId,
    actorUsername,
    action: 'prize.stock.set',
    target: key,
    metadata: { mode, oldStock, newStock: (prize as any)[stockField] },
  });

  if (oldStock > 0 && (prize as any)[stockField] === 0) {
    await notifyAllAdmins(
      'system_announcement',
      '⚠️ تنبيه مخزون',
      `الجائزة:\n${prize.name}\n\nنفد مخزونها بالكامل.`
    );
  }

  return prize;
}

export async function setActive(key: string, isActive: boolean, actorId: number, actorUsername?: string) {
  const prize = await Prize.findOneAndUpdate({ key }, { isActive }, { new: true });
  if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  await writeAudit({
    actorId,
    actorUsername,
    action: isActive ? 'prize.activate' : 'prize.deactivate',
    target: key,
  });
  return prize;
}

/**
 * Returns the list of prizes currently eligible to be drawn:
 * active AND (unlimited OR stock > 0).
 */
export function isPrizeEligible(
  prize: Pick<IPrize, 'isActive' | 'baseWeight' | 'dailyWeight' | 'pointsWeight' | 'isUnlimited' | 'dailyIsUnlimited' | 'pointsIsUnlimited' | 'stock' | 'dailyStock' | 'pointsStock'>,
  mode: WheelMode = 'daily'
): boolean {
  const weight = getPrizeWeight(prize, mode);
  return prize.isActive && Number.isFinite(weight) && weight > 0 && (getPrizeUnlimited(prize, mode) || getPrizeStock(prize, mode) > 0);
}

export async function getEligiblePrizes(session?: ClientSession, mode: WheelMode = 'daily'): Promise<HydratedDocument<IPrize>[]> {
  const canonical = await getCanonicalPrizes(session);
  return canonical.filter((prize) => isPrizeEligible(prize, mode));
}

/**
 * Validates that configured prize probabilities fit inside the 100% draw.
 * Any remainder is intentionally the "حظ أوفر" probability.
 */
export async function validateWeightsAtMost100(tolerance = 0.001): Promise<{
  ok: boolean;
  sum: number;
  dailySum: number;
  pointsSum: number;
}> {
  const prizes = await Prize.find({});
  const dailySum = prizes.reduce((acc, p) => acc + getPrizeWeight(p, 'daily'), 0);
  const hasExplicitPointsWeights = prizes.some((p) => p.pointsWeight !== null && p.pointsWeight !== undefined);
  const pointsSum = hasExplicitPointsWeights
    ? prizes.reduce((acc, p) => acc + (p.pointsWeight ?? 0), 0)
    : Math.min(prizes.reduce((acc, p) => acc + p.baseWeight, 0), 30);
  return { ok: dailySum <= 100 + tolerance && pointsSum <= 30 + tolerance, sum: pointsSum, dailySum, pointsSum };
}
