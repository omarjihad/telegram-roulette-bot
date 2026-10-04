import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { t } from '../i18n';
import { adsBlockId, consumeAdView } from './games.service';

/** Wheel spins anyone can get each day by watching an ad. They always land on "better luck". */
export const AD_SPINS_PER_DAY = 3;

/** Today's date in Baghdad (UTC+3), so the daily limit resets at local midnight. */
export function adSpinDay(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
}

export function adSpinsLeft(user: { adSpinDay?: string | null; adSpinCount?: number }, now = new Date()) {
  const used = user.adSpinDay === adSpinDay(now) ? user.adSpinCount ?? 0 : 0;
  return Math.max(0, AD_SPINS_PER_DAY - used);
}

/** One ad watched to the end buys one spin (max 3 a day). */
export async function spinWithAd(telegramId: number) {
  if (!(await adsBlockId())) throw new AppError(t('الإعلانات غير مفعّلة حالياً', 'Ads are not available right now'), 409, 'ADS_DISABLED');
  const today = adSpinDay();
  // Reserve today's slot first so a burst of requests can't pass the limit.
  const reserved = await User.findOneAndUpdate(
    {
      telegramId,
      $or: [{ adSpinDay: { $ne: today } }, { adSpinCount: { $lt: AD_SPINS_PER_DAY } }],
    },
    [
      {
        $set: {
          adSpinCount: { $cond: [{ $eq: ['$adSpinDay', today] }, { $add: [{ $ifNull: ['$adSpinCount', 0] }, 1] }, 1] },
          adSpinDay: today,
        },
      },
    ],
    { new: true }
  );
  if (!reserved) {
    throw new AppError(t('خلصت فرّات الإعلان لليوم (3 باليوم)', "You've used today's ad spins (3 a day)"), 429, 'AD_SPIN_LIMIT');
  }
  try {
    await consumeAdView(telegramId, 'wheel_ad_spin');
  } catch (err) {
    // Not confirmed (yet): give the slot back so the retry can use it.
    await User.updateOne({ telegramId, adSpinDay: today, adSpinCount: { $gt: 0 } }, { $inc: { adSpinCount: -1 } });
    throw err;
  }
  return { result: { won: false as const }, adSpinsLeft: adSpinsLeft(reserved) };
}
