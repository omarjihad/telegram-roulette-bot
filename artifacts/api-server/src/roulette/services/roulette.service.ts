import mongoose, { ClientSession, HydratedDocument } from 'mongoose';
import { Prize, IPrize } from '../models/Prize';
import { User, IUser } from '../models/User';
import { UserPrize } from '../models/UserPrize';
import { RouletteSpin } from '../models/RouletteSpin';
import { getSettings } from '../models/Settings';
import { weightedPick } from '../utils/random';
import { AppError } from '../utils/AppError';
import { createNotification } from './notification.service';
import { createClaimTaskForPrize, buildTaskLink } from './claimTask.service';
import { getCanonicalPrizes, getEligiblePrizes, getPrizeWeight, prizeImageUrl, WheelMode } from './prize.service';
import { logger } from '../config/logger';

export type SpinResult =
  | {
      won: true;
      prizeName: string;
      prizeKey: string;
      prizeIcon: string;
      prizeImageUrl: string | null;
      userPrizeId: string;
      expiresAt: Date;
      nextSpinAt: Date;
    }
  | {
      won: false;
      nextSpinAt: Date;
    };

interface CommittedSpin {
  result: SpinResult;
  notification?: {
    userId: mongoose.Types.ObjectId;
    telegramId: number;
    prizeName: string;
    requiredCount: number;
    taskToken: string;
  };
}

/**
 * Prize weights are direct percentage points, not relative weights. This preserves the
 * configured chance when stock changes: if the remaining prizes total 30, the other 70%
 * is a real no-prize outcome instead of being redistributed to the last item.
 */
export function noPrizeWeight(
  prizes: Array<Pick<IPrize, 'baseWeight' | 'dailyWeight' | 'pointsWeight'>>,
  mode: WheelMode = 'points'
): number {
  const configuredWinWeight = prizes.reduce(
    (sum, prize) =>
      sum +
      Math.max(
        0,
        mode === 'daily' ? (prize.dailyWeight ?? prize.baseWeight) : (prize.pointsWeight ?? prize.baseWeight)
      ),
    0
  );
  return Math.max(0, 100 - configuredWinWeight);
}

export function getNextSpinAt(user: Pick<IUser, 'lastSpinAt'>, cooldownHours: number): Date {
  if (!user.lastSpinAt) return new Date(0);
  return new Date(user.lastSpinAt.getTime() + cooldownHours * 60 * 60 * 1000);
}

export async function checkCooldown(user: HydratedDocument<IUser>): Promise<{ ready: boolean; nextSpinAt: Date }> {
  const settings = await getSettings();
  const nextSpinAt = getNextSpinAt(user, settings.spinCooldownHours);
  return { ready: Date.now() >= nextSpinAt.getTime(), nextSpinAt };
}

/**
 * Reserves stock inside the same Mongo transaction that creates the UserPrize. A reservation
 * is never visible by itself: if any later write fails, Mongo rolls both stock and cooldown
 * back together. The stock predicate is still needed to protect finite inventory.
 */
async function tryReserveStock(
  prize: HydratedDocument<IPrize>,
  mode: WheelMode,
  session: ClientSession
): Promise<boolean> {
  const stockField = mode === 'daily' ? 'dailyStock' : 'pointsStock';
  const unlimitedField = mode === 'daily' ? 'dailyIsUnlimited' : 'pointsIsUnlimited';
  const pendingField = mode === 'daily' ? 'dailyPendingCount' : 'pointsPendingCount';
  const prizeData = prize as unknown as IPrize & Record<string, number | boolean | null | undefined>;
  const effectiveStock = (prizeData[stockField] as number | null | undefined) ?? prize.stock;
  const effectiveUnlimited = (prizeData[unlimitedField] as boolean | null | undefined) ?? prize.isUnlimited;
  const effectivePending = (prizeData[pendingField] as number | null | undefined) ?? prize.pendingCount ?? 0;
  if (prizeData[stockField] == null || prizeData[unlimitedField] == null || prizeData[pendingField] == null) {
    await Prize.updateOne(
      { _id: prize._id },
      {
        $set: {
          [stockField]: effectiveStock,
          [unlimitedField]: effectiveUnlimited,
          [pendingField]: effectivePending,
        },
      },
      { session }
    );
  }
  const isUnlimited = Boolean(effectiveUnlimited);
  const filter = isUnlimited ? { _id: prize._id } : { _id: prize._id, [stockField]: { $gt: 0 } };
  const update = isUnlimited
    ? { $inc: { [pendingField]: 1 } }
    : { $inc: { [stockField]: -1, [pendingField]: 1 } };
  const res = await Prize.updateOne(filter, update, { session });
  return res.modifiedCount === 1;
}

function weightsSnapshot(prizes: HydratedDocument<IPrize>[], mode: WheelMode): Record<string, number> {
  return Object.fromEntries(prizes.map((prize) => [prize.key, getPrizeWeight(prize, mode)]));
}

/**
 * Performs one server-authoritative spin. All state that makes a spin real (cooldown,
 * inventory reservation, spin history, awarded UserPrize and its claim task) commits in one
 * transaction. Mongo retries a transaction on write conflicts, which makes simultaneous
 * same-user requests and last-stock requests safe without a compensating rollback race.
 */
export async function performSpin(telegramId: number, mode: 'daily' | 'points' = 'daily'): Promise<SpinResult> {
  const settings = await getSettings();
  if (settings.maintenanceMode) throw new AppError('Under maintenance', 503, 'MAINTENANCE');

  const session = await mongoose.startSession();
  let committed: CommittedSpin | null = null;

  try {
    await session.withTransaction(async () => {
      // Reset this on every transaction callback invocation. withTransaction may replay the
      // callback after a write conflict, and only its final successful invocation is valid.
      committed = null;
      const now = new Date();
      const cooldownCutoff = new Date(now.getTime() - settings.spinCooldownHours * 60 * 60 * 1000);

      const user = await User.findOne({ telegramId }).session(session);
      if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      if (user.isBanned) throw new AppError('User is banned', 403, 'BANNED');

      if (mode === 'daily') {
        const bonusClaim = await User.updateOne(
          { _id: user._id, bonusDailySpins: { $gt: 0 } },
          { $set: { lastSpinAt: now }, $inc: { bonusDailySpins: -1 } },
          { session }
        );
        if (bonusClaim.modifiedCount === 1) {
          // A gifted daily spin bypasses the normal cooldown and consumes exactly one gift.
        } else {
          const cooldownClaim = await User.updateOne(
          {
            _id: user._id,
            $or: [{ lastSpinAt: null }, { lastSpinAt: { $lte: cooldownCutoff } }],
          },
          { $set: { lastSpinAt: now } },
          { session }
          );
          if (cooldownClaim.modifiedCount !== 1) {
            throw new AppError('Spin not ready yet', 429, 'SPIN_COOLDOWN');
          }
        }
      } else {
        const pointsClaim = await User.updateOne(
          { _id: user._id, spinPoints: { $gte: 5 } },
          { $inc: { spinPoints: -5, spinPointsSpent: 5 } },
          { session }
        );
        if (pointsClaim.modifiedCount !== 1) {
          throw new AppError('Not enough spin-points', 402, 'INSUFFICIENT_POINTS');
        }
      }

       const guaranteedPrizeId = mode === 'daily' ? user.guaranteedDailyPrizes?.[0] : null;
       const guaranteedPrize = guaranteedPrizeId
         ? await Prize.findOne({ _id: guaranteedPrizeId, isActive: true }).session(session)
         : null;
       const eligible = await getEligiblePrizes(session, mode);
       const allPrizes = await getCanonicalPrizes(session);
        const snapshot = weightsSnapshot(allPrizes, mode);
        const maxWinWeight = mode === 'daily' ? 100 : 30;
        const configuredEligibleWeight = eligible.reduce((sum, prize) => sum + Math.max(0, getPrizeWeight(prize, mode)), 0);
        const eligibleScale = configuredEligibleWeight > maxWinWeight ? maxWinWeight / configuredEligibleWeight : 1;
        const noWinWeight = Math.max(0, 100 - configuredEligibleWeight * eligibleScale);
       const drawItems: Array<{ ref: HydratedDocument<IPrize> | null; weight: number }> = eligible.map((prize) => ({
         ref: prize,
         weight: getPrizeWeight(prize, mode) * eligibleScale,
       }));
       if (noWinWeight > 0) drawItems.push({ ref: null, weight: noWinWeight });
        const forceDailyNoPrize = mode === 'daily' && user.dailyPrizeBlockedNextSpin && !guaranteedPrize;
        const candidate = guaranteedPrize ?? (forceDailyNoPrize ? null : drawItems.length > 0 ? weightedPick(drawItems).ref : null);

      // If every prize is exhausted, this is a legitimate empty result, not a failed spin.
      // Exhausted cards remain public-visible but never enter `eligible`.
      if (!candidate) {
        await User.updateOne(
          { _id: user._id },
          {
            $inc: { totalSpins: 1, ...(mode === 'daily' ? { spinCredits: 1 } : {}) },
            $set: {
              lastSpinWon: false,
              lastSpinPrizeName: null,
              lastSpinPrizeIcon: null,
              lastSpinPrizeHasImage: null,
              lastSpinPrizeKey: null,
               ...(mode === 'daily' ? { dailyPrizeBlockedNextSpin: false } : {}),
            },
          },
          { session }
        );
        await RouletteSpin.create(
          [
           {
              user: user._id,
              telegramId,
              prize: null,
              prizeNameSnapshot: '',
              weightsSnapshot: snapshot,
              isEmptyResult: true,
              mode,
             isGiftGuaranteed: false,
            },
          ],
          { session }
        );
        committed = {
          result: {
            won: false,
            nextSpinAt: mode === 'daily' ? new Date(now.getTime() + settings.spinCooldownHours * 60 * 60 * 1000) : now,
          },
        };
        return;
      }

       const isGiftGuaranteed = Boolean(guaranteedPrize && String(candidate._id) === String(guaranteedPrize._id));
       const reserved = isGiftGuaranteed ? true : await tryReserveStock(candidate, mode, session);
      if (!reserved) {
        // A concurrent stock change can invalidate the candidate after the snapshot. Do not
        // swap it for a different prize. Throwing aborts the cooldown too; the caller may
        // safely retry and receive a fresh, authoritative result.
        throw new AppError('Prize availability changed, please try again', 409, 'SPIN_RETRY');
      }

      const [spin] = await RouletteSpin.create(
        [
          {
            user: user._id,
            telegramId,
            prize: candidate._id,
            prizeNameSnapshot: candidate.name,
            weightsSnapshot: snapshot,
            isEmptyResult: false,
            mode,
            isGiftGuaranteed,
          },
        ],
        { session }
      );
      const expiresAt = new Date(now.getTime() + settings.prizeExpiryHours * 60 * 60 * 1000);
      const [userPrize] = await UserPrize.create(
        [
          {
            user: user._id,
            telegramId,
            prize: candidate._id,
            prizeNameSnapshot: candidate.name,
            source: 'wheel',
            wonAt: now,
            expiresAt,
            status: 'active',
            spinId: spin._id,
          },
        ],
        { session }
      );
      const task = await createClaimTaskForPrize(userPrize, {
        requiredCount:
          mode === 'daily'
            ? settings.dailyClaimReferralsRequired ?? settings.claimReferralsRequired
            : settings.wheelClaimReferralsRequired ?? settings.claimReferralsRequired,
        session,
        now,
      });

      await User.updateOne(
        { _id: user._id },
        {
          $inc: { totalSpins: 1, ...(mode === 'daily' ? { spinCredits: 1 } : {}) },
          $set: {
            lastSpinWon: true,
            lastSpinPrizeName: candidate.name,
            lastSpinPrizeIcon: candidate.icon,
            lastSpinPrizeHasImage: candidate.hasImage,
            lastSpinPrizeKey: candidate.key,
            ...(mode === 'daily' ? { dailyPrizeBlockedNextSpin: true } : {}),
          },
          ...(isGiftGuaranteed ? { $pull: { guaranteedDailyPrizes: candidate._id } } : {}),
        },
        { session }
      );

      committed = {
        result: {
          won: true,
          prizeName: candidate.name,
          prizeKey: candidate.key,
          prizeIcon: candidate.icon,
          prizeImageUrl: prizeImageUrl(candidate.key, candidate.hasImage),
          userPrizeId: (userPrize._id as mongoose.Types.ObjectId).toString(),
          expiresAt,
          nextSpinAt: mode === 'daily' ? new Date(now.getTime() + settings.spinCooldownHours * 60 * 60 * 1000) : now,
        },
        notification: {
          userId: user._id as mongoose.Types.ObjectId,
          telegramId,
          prizeName: candidate.name,
          requiredCount: task.requiredCount,
          taskToken: task.token,
        },
      };
    });
  } catch (err) {
    // Keep operational errors intact. The structural check also covers errors crossing
    // transpilation/module boundaries in the test runner or bundled runtime.
    if (err instanceof AppError || (err && typeof err === 'object' && (err as { isOperational?: boolean }).isOperational)) {
      throw err;
    }
    logger.error({ err, telegramId }, 'roulette transaction failed; no spin state was committed');
    throw new AppError('Spin failed, please try again', 500, 'SPIN_FAILED');
  } finally {
    await session.endSession();
  }

  // TypeScript's control-flow analysis does not observe assignments made inside the
  // transaction callback, although withTransaction has completed synchronously here.
  const finalCommitted = committed as CommittedSpin | null;
  if (!finalCommitted) {
    throw new AppError('Spin failed, please try again', 500, 'SPIN_FAILED');
  }

  // Notifications are intentionally post-commit and best-effort. They must never decide
  // whether an awarded prize, its stock decrement, or a cooldown gets persisted.
  if (finalCommitted.notification) {
    const notification = finalCommitted.notification;
    const taskLink = buildTaskLink(notification.taskToken);
    createNotification({
      userId: notification.userId,
      telegramId: notification.telegramId,
      type: 'prize_won',
      title: '🎉 مبروك!',
      body:
        `ربحت: ${notification.prizeName}\n` +
        'لديك 24 ساعة لاستلامها من الحقيبة.\n\n' +
        `⚠️ عشان تكدر تسحبها لازم تدعو ${notification.requiredCount} أشخاص عن طريق رابطك الخاص بهذي الجائزة (تلقاه بالحقيبة).` +
        (taskLink ? `\n\n${taskLink}` : ''),
    }).catch((err) => logger.error({ err, telegramId }, 'failed to create prize-won notification'));
  }

  return finalCommitted.result;
}