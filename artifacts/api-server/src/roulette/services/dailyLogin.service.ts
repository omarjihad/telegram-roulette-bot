import mongoose from 'mongoose';
import { Prize, IPrize } from '../models/Prize';
import { User } from '../models/User';
import { UserPrize } from '../models/UserPrize';
import { AppError } from '../utils/AppError';
import { prizeImageUrl } from './prize.service';
import { createClaimTaskForPrize } from './claimTask.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const DAILY_REWARDS = [
  { day: 1, type: 'points' as const, points: 0.5 },
  { day: 2, type: 'points' as const, points: 1 },
  { day: 3, type: 'points' as const, points: 2 },
  { day: 4, type: 'points' as const, points: 3 },
  { day: 5, type: 'prize' as const, prizeKey: 'gems_3000' },
  { day: 6, type: 'points' as const, points: 5 },
  { day: 7, type: 'prize' as const, prizeKey: 'gems_5000' },
];

export function getDailyReward(day: number) {
  return DAILY_REWARDS.find((reward) => reward.day === day) ?? DAILY_REWARDS[0];
}

function rewardView(day: number, reward: ReturnType<typeof getDailyReward>, prize?: { name: string; key: string; icon: string; hasImage: boolean }) {
  return {
    day,
    type: reward.type,
    points: reward.type === 'points' ? reward.points : null,
    prizeKey: prize?.key ?? null,
    prizeName: prize?.name ?? null,
    prizeIcon: prize?.icon ?? null,
    prizeImageUrl: prize ? prizeImageUrl(prize.key, prize.hasImage) : null,
  };
}

/**
 * Claims one daily reward on the first app entry after its 24-hour window. Missing a full
 * window resets the cycle to day one without awarding the skipped day.
 */
export async function claimDailyLogin(telegramId: number) {
  const session = await mongoose.startSession();
  try {
    let response: Record<string, unknown> | null = null;
    await session.withTransaction(async () => {
      const user = await User.findOne({ telegramId }).session(session);
      if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      if (user.isBanned) throw new AppError('User is banned', 403, 'BANNED');

      const now = new Date();
      const lastClaim = user.dailyLastClaimAt?.getTime() ?? 0;
      const elapsed = lastClaim ? now.getTime() - lastClaim : Number.POSITIVE_INFINITY;
      if (lastClaim && elapsed < DAY_MS) {
        const nextClaimAt = new Date(lastClaim + DAY_MS);
        const currentReward = getDailyReward(user.dailyStreakDay || 1);
        const prize =
          currentReward.type === 'prize' && currentReward.prizeKey
            ? await Prize.findOne({ key: currentReward.prizeKey }).session(session)
            : undefined;
        response = {
          claimed: true,
          alreadyClaimed: true,
          streakDay: user.dailyStreakDay || 1,
          claimedDays: user.dailyClaimedDays ?? [],
          nextClaimAt,
          reward: rewardView(user.dailyStreakDay || 1, currentReward, prize ?? undefined),
          spinPoints: user.spinPoints,
          spinCredits: user.spinCredits ?? 0,
        };
        return;
      }

      const missedWindow = lastClaim && elapsed >= DAY_MS * 2;
      const nextDay = missedWindow || !lastClaim || user.dailyStreakDay >= 7 ? 1 : (user.dailyStreakDay || 0) + 1;
      const reward = getDailyReward(nextDay);
      let prizeDoc: mongoose.HydratedDocument<IPrize> | null = null;

      if (reward.type === 'prize' && reward.prizeKey) {
        prizeDoc = await Prize.findOne({ key: reward.prizeKey }).session(session);
        if (!prizeDoc || !prizeDoc.isActive) {
          throw new AppError('Daily reward is not available yet', 409, 'DAILY_REWARD_UNAVAILABLE');
        }
        const reserved = await Prize.updateOne(
          prizeDoc.isUnlimited ? { _id: prizeDoc._id } : { _id: prizeDoc._id, stock: { $gt: 0 } },
          prizeDoc.isUnlimited ? { $inc: { pendingCount: 1 } } : { $inc: { stock: -1, pendingCount: 1 } },
          { session }
        );
        if (reserved.modifiedCount !== 1) throw new AppError('Daily reward is out of stock', 409, 'DAILY_REWARD_UNAVAILABLE');
      }

      const claimedDays = missedWindow || nextDay === 1 ? [1] : [...(user.dailyClaimedDays ?? []), nextDay];
      user.dailyStreakDay = nextDay;
      user.dailyLastClaimAt = now;
      user.dailyClaimedDays = [...new Set(claimedDays)];

      if (reward.type === 'points') {
        user.spinPoints += reward.points;
      } else if (prizeDoc) {
        const [dailyPrize] = await UserPrize.create(
          [
            {
              user: user._id,
              telegramId,
              prize: prizeDoc._id,
              prizeNameSnapshot: prizeDoc.name,
              source: 'daily',
              wonAt: now,
              expiresAt: null,
              status: 'active',
            },
          ],
          { session }
        );
        await createClaimTaskForPrize(dailyPrize, {
          requiredCount: 5,
          session,
          now,
        });
      }

      await user.save({ session });
      response = {
        claimed: true,
        alreadyClaimed: false,
        streakDay: nextDay,
        claimedDays: user.dailyClaimedDays,
        nextClaimAt: new Date(now.getTime() + DAY_MS),
        reward: rewardView(nextDay, reward, prizeDoc ?? undefined),
        spinPoints: user.spinPoints,
        spinCredits: user.spinCredits ?? 0,
      };
    });
    return response;
  } finally {
    await session.endSession();
  }
}