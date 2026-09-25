import mongoose from 'mongoose';
import { Prize } from '../models/Prize';
import { UserPrize, IUserPrize } from '../models/UserPrize';
import { RouletteSpin } from '../models/RouletteSpin';

type StockFields = { stock: string; unlimited: string; pending: string };

function fieldsForMode(mode: 'daily' | 'points' | null): StockFields {
  if (mode === 'daily') return { stock: 'dailyStock', unlimited: 'dailyIsUnlimited', pending: 'dailyPendingCount' };
  if (mode === 'points') return { stock: 'pointsStock', unlimited: 'pointsIsUnlimited', pending: 'pointsPendingCount' };
  return { stock: 'stock', unlimited: 'isUnlimited', pending: 'pendingCount' };
}

/**
 * Gives a won-but-never-delivered prize back to the bot's inventory: the stock the spin
 * reserved goes back up by one and the pending counter comes down by one. Wheel prizes
 * reserve from the per-mode fields (dailyStock / pointsStock), everything else from the base
 * `stock`, so the release has to hit the same fields the reservation used.
 *
 * Guarded by `stockReleasedAt` so the same UserPrize can never return stock twice (e.g. the
 * expiry worker and a claim attempt racing on the same item).
 */
export async function releasePrizeReservation(userPrize: Pick<IUserPrize, 'prize' | 'spinId' | 'source'> & { _id: unknown }) {
  if (!userPrize.prize) return false;
  if (userPrize.source === 'store') return false; // store purchases never reserve wheel stock

  const marked = await UserPrize.updateOne(
    { _id: userPrize._id, stockReleasedAt: null },
    { $set: { stockReleasedAt: new Date() } }
  );
  if (marked.modifiedCount !== 1) return false;

  const spin = userPrize.spinId ? await RouletteSpin.findById(userPrize.spinId).select('mode isGiftGuaranteed') : null;
  // Guaranteed gifts are handed out without reserving stock, so there is nothing to return.
  if (spin?.isGiftGuaranteed) return false;

  const prize = await Prize.findById(userPrize.prize);
  if (!prize) return false;

  const mode = userPrize.source === 'wheel' && spin ? spin.mode : null;
  const fields = fieldsForMode(mode);
  const data = prize.toObject() as unknown as Record<string, number | boolean | null | undefined>;
  const isUnlimited = Boolean(data[fields.unlimited] ?? data.isUnlimited);

  const inc: Record<string, number> = {};
  if (!isUnlimited) inc[fields.stock] = 1;
  if (Number(data[fields.pending] ?? 0) > 0) inc[fields.pending] = -1;
  if (Object.keys(inc).length === 0) return true;

  await Prize.updateOne({ _id: prize._id as mongoose.Types.ObjectId }, { $inc: inc });
  return true;
}
