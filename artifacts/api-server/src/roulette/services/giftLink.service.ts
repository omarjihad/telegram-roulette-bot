import { nanoid } from 'nanoid';
import { GiftLink, GiftLinkRewardType } from '../models/GiftLink';
import { Prize } from '../models/Prize';
import { User } from '../models/User';
import { UserPrize } from '../models/UserPrize';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

export function parseGiftToken(value?: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^gift_([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

export function buildGiftLink(token: string): string | null {
  if (!env.BOT_USERNAME) return null;
  return `https://t.me/${env.BOT_USERNAME}?start=gift_${token}`;
}

export async function createGiftLink(params: {
  rewardType: GiftLinkRewardType;
  pointsAmount?: number;
  prizeKey?: string;
  createdByTelegramId: number;
  expiresInHours?: number | null;
  maxRedemptions?: number;
}) {
  let prize: { _id: unknown; name: string } | null = null;
  if (params.rewardType === 'points') {
    if (!Number.isFinite(params.pointsAmount) || (params.pointsAmount ?? 0) <= 0) {
      throw new AppError('pointsAmount must be positive', 422, 'VALIDATION_ERROR');
    }
  }
  if (params.rewardType === 'prize' || params.rewardType === 'guaranteed_daily_prize') {
    if (!params.prizeKey) throw new AppError('prizeKey is required', 422, 'VALIDATION_ERROR');
    prize = await Prize.findOne({ key: params.prizeKey, isActive: true }).select('_id name');
    if (!prize) throw new AppError('Prize not found or inactive', 404, 'PRIZE_NOT_FOUND');
  }

  const maxRedemptions = Number(params.maxRedemptions ?? 1);
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
    throw new AppError('maxRedemptions must be a positive integer', 422, 'VALIDATION_ERROR');
  }

  const hours = params.expiresInHours == null ? null : Number(params.expiresInHours);
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0)) {
    throw new AppError('expiresInHours must be positive or null', 422, 'VALIDATION_ERROR');
  }

  const gift = await GiftLink.create({
    token: nanoid(20),
    rewardType: params.rewardType,
    pointsAmount: params.rewardType === 'points' ? params.pointsAmount : null,
    prize: prize?._id ?? null,
    prizeNameSnapshot: prize?.name ?? null,
    maxRedemptions,
    createdByTelegramId: params.createdByTelegramId,
    expiresAt: hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000),
  });
  return { gift, link: buildGiftLink(gift.token) };
}

export async function listGiftLinks(limit = 100) {
  return GiftLink.find({}).sort({ createdAt: -1 }).limit(limit);
}

export async function revokeGiftLink(token: string) {
  const updated = await GiftLink.findOneAndUpdate(
    { token, status: 'unused' },
    { $set: { status: 'revoked' } },
    { new: true }
  );
  if (!updated) throw new AppError('Gift link is already used or unavailable', 409, 'GIFT_NOT_AVAILABLE');
  return updated;
}

export async function redeemGiftLink(token: string, telegramId: number) {
  const now = new Date();
  const claimed = await GiftLink.findOneAndUpdate(
    {
      token,
      status: 'unused',
      $expr: {
        $lt: [
          { $ifNull: ['$redemptionCount', 0] },
          { $ifNull: ['$maxRedemptions', 1] },
        ],
      },
      redeemedByTelegramIds: { $ne: telegramId },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    },
    {
      $inc: { redemptionCount: 1 },
      $addToSet: { redeemedByTelegramIds: telegramId },
      $set: { redeemedByTelegramId: telegramId, redeemedAt: now },
    },
    { new: true }
  );
  if (!claimed) {
    const expired = await GiftLink.findOne({ token, status: 'unused' });
    if (expired?.expiresAt && expired.expiresAt <= now) {
      await GiftLink.updateOne({ _id: expired._id, status: 'unused' }, { $set: { status: 'expired' } });
      throw new AppError('انتهت صلاحية رابط الهدية أو تم استخدامه.', 409, 'GIFT_NOT_AVAILABLE');
    }
    if (expired && expired.redeemedByTelegramIds.includes(telegramId)) {
      throw new AppError('استلمت هذه الهدية مسبقاً.', 409, 'GIFT_ALREADY_REDEEMED');
    }
    if (expired && expired.redemptionCount >= expired.maxRedemptions) {
      throw new AppError('اكتمل عدد مستخدمي رابط الهدية.', 409, 'GIFT_NOT_AVAILABLE');
    }
    throw new AppError('رابط الهدية غير صالح أو تم استخدامه مسبقاً.', 409, 'GIFT_NOT_AVAILABLE');
  }

  if (claimed.redemptionCount >= claimed.maxRedemptions) {
    await GiftLink.updateOne({ _id: claimed._id, status: 'unused' }, { $set: { status: 'redeemed' } });
  }

  const user = await User.findOne({ telegramId });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  try {
    if (claimed.rewardType === 'points') {
      await User.updateOne({ _id: user._id }, { $inc: { spinPoints: claimed.pointsAmount ?? 0 } });
       return { message: `🎁 مبروك! استلمت هدية بقيمة ${claimed.pointsAmount} نقطة.\nتلقاها مضافة بحسابك، افتح البوت حتى تستخدمها.` };
    }
    if (claimed.rewardType === 'daily_spin') {
      await User.updateOne({ _id: user._id }, { $inc: { bonusDailySpins: 1 } });
       return { message: '🎁 مبروك! استلمت فرة يومية إضافية.\nافتح البوت وروح للعجلة حتى تستخدمها.' };
    }

    if (!claimed.prize) throw new AppError('Gift prize is missing', 500, 'GIFT_INVALID');
    const prize = await Prize.findById(claimed.prize);
    if (!prize) throw new AppError('Gift prize no longer exists', 409, 'GIFT_INVALID');
    if (claimed.rewardType === 'guaranteed_daily_prize') {
      await User.updateOne(
        { _id: user._id },
        { $inc: { bonusDailySpins: 1 }, $push: { guaranteedDailyPrizes: prize._id } },
      );
      return {
        message: `🎁 مبروك! استلمت فرة يومية مضمونة على جائزة: ${prize.name}.\nافتح العجلة، والفة القادمة راح تطلع لك هذه الجائزة حتى لو مخزونها صفر.`,
      };
    }

    if (!prize.isUnlimited) {
      const reserved = await Prize.updateOne({ _id: prize._id, stock: { $gt: 0 } }, { $inc: { stock: -1, pendingCount: 1 } });
      if (reserved.modifiedCount !== 1) throw new AppError('الجائزة نفدت حالياً.', 409, 'GIFT_OUT_OF_STOCK');
    } else {
      await Prize.updateOne({ _id: prize._id }, { $inc: { pendingCount: 1 } });
    }
    const userPrize = await UserPrize.create({
      user: user._id,
      telegramId,
      prize: prize._id,
      prizeNameSnapshot: prize.name,
      source: 'referral',
      wonAt: now,
      expiresAt: null,
      status: 'active',
    });
     return { message: `🎁 مبروك! استلمت الجائزة: ${prize.name}.\nتلقاها حالياً داخل المخزون/الحقيبة.` };
  } catch (err) {
    await GiftLink.updateOne(
      { _id: claimed._id },
      {
        $set: { status: 'unused', redeemedByTelegramId: null, redeemedAt: null },
        $inc: { redemptionCount: -1 },
        $pull: { redeemedByTelegramIds: telegramId },
      }
    );
    throw err;
  }
}