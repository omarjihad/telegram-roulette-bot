import mongoose from 'mongoose';
import { Prize } from '../models/Prize';
import { User } from '../models/User';
import { UserPrize } from '../models/UserPrize';
import { AppError } from '../utils/AppError';
import { createNotification } from './notification.service';
import { prizeImageUrl } from './prize.service';
import { logger } from '../config/logger';

/** Public-safe list of everything currently buyable in the Store. */
export async function listStoreProducts() {
  const prizes = await Prize.find({ isActive: true, storePrice: { $ne: null, $gt: 0 } })
    .sort({ storePrice: 1, displayOrder: 1 })
    .select('key name icon hasImage storePrice');
  return prizes.map((p) => ({
    key: p.key,
    name: p.name,
    icon: p.icon,
    imageUrl: prizeImageUrl(p.key, p.hasImage),
    price: p.storePrice as number,
  }));
}

/**
 * Buys a prize directly with spin credits (the number of spins). Deliberately mirrors the same manual-fulfillment
 * path as a wheel win or referral bonus (UserPrize -> WithdrawalRequest -> admin
 * approve/reject) since these are the same non-automatable prizes either way — the only
 * difference is how the UserPrize was earned. No referral task, no 24h expiry: the user
 * already paid for it outright.
 *
 * Buying never touches the wheel's `stock`/`pendingCount` — the Store and the wheel are
 * independent inventories by design, so a purchase can never affect wheel odds and a busy
 * wheel prize can never sell out the store (or vice versa).
 */
export async function purchaseProduct(telegramId: number, prizeKey: string) {
  const user = await User.findOne({ telegramId });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (user.isBanned) throw new AppError('User is banned', 403, 'BANNED');

  const prize = await Prize.findOne({ key: prizeKey, isActive: true });
  if (!prize || !prize.storePrice || prize.storePrice <= 0) {
    throw new AppError('This item is not available in the store', 404, 'NOT_FOUND');
  }
  const price = prize.storePrice;

  // Atomic "only deduct if they can afford it" — the same anti-race pattern used for wheel
  // stock reservation. If two purchase requests land at once, at most one can succeed once
  // the balance would go negative.
  const debited = await User.findOneAndUpdate(
    { telegramId, spinCredits: { $gte: price } },
    { $inc: { spinCredits: -price, spinCreditsSpent: price } }
  );
  if (!debited) {
    throw new AppError('Not enough spins for this item', 402, 'INSUFFICIENT_BALANCE');
  }

  try {
    const userPrize = await UserPrize.create({
      user: user._id,
      telegramId,
      prize: prize._id,
      prizeNameSnapshot: prize.name,
      source: 'store',
      wonAt: new Date(),
      expiresAt: null,
      status: 'active',
    });

    await createNotification({
      userId: user._id as mongoose.Types.ObjectId,
      telegramId,
      type: 'prize_won',
      title: '🛍️ عملية شراء ناجحة',
      body: `اشتريت: ${prize.name} مقابل ${price} فرة. الجائزة الحين بالحقيبة، تكدر تستلمها متى ما تريد.`,
    });

    return {
      userPrizeId: (userPrize._id as mongoose.Types.ObjectId).toString(),
      prizeName: prize.name,
      spentCredits: price,
      remainingBalance: debited.spinCredits - price,
    };
  } catch (err) {
    // Never take someone's spin credits for an item they didn't actually receive.
    await User.updateOne({ telegramId }, { $inc: { spinCredits: price } });
    logger.error({ err, telegramId, prizeKey }, 'store purchase failed after debit, refunded');
    throw new AppError('Purchase failed, your spin credits were refunded', 500, 'PURCHASE_FAILED');
  }
}
