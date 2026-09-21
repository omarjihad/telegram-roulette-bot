import mongoose from 'mongoose';
import { UserPrize } from '../models/UserPrize';
import { User } from '../models/User';
import { WithdrawalRequest } from '../models/WithdrawalRequest';
import { Prize } from '../models/Prize';
import { Referral } from '../models/Referral';
import { RouletteSpin } from '../models/RouletteSpin';
import { AppError } from '../utils/AppError';
import { createNotification, notifyAdminsNewWithdrawal, notifyDeliveryAccountNewWithdrawal } from './notification.service';
import { getClaimTaskForUserPrize } from './claimTask.service';
import { writeAudit } from '../models/AuditLog';
import { env } from '../config/env';
import { getDeliveryAccountStatus, getDeliveryContactLink, hasVerifiedDeliveryContact } from './deliveryAccount.service';

/**
 * User presses "استلام" on a won/bonus prize sitting in their inventory.
 * Server re-checks every condition itself — nothing here trusts the client.
 */
export async function requestClaim(telegramId: number, userPrizeId: string) {
  const user = await User.findOne({ telegramId });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (user.isBanned) throw new AppError('User is banned', 403, 'BANNED');

  const deliveryAccount = await getDeliveryAccountStatus();
  if (deliveryAccount.configured && !(await hasVerifiedDeliveryContact(telegramId))) {
    throw new AppError(
      'قبل الاستلام أضف حساب التسليم إلى جهات اتصالك، ثم اضغط تحقق حتى نرسل لك رسالة التأكيد.',
      409,
      'DELIVERY_CONTACT_REQUIRED'
    );
  }

  const userPrize = await UserPrize.findOne({ _id: userPrizeId, user: user._id });
  if (!userPrize) throw new AppError('Prize not found', 404, 'NOT_FOUND');

  if (userPrize.status === 'claim_requested') {
    throw new AppError('Claim already requested', 409, 'ALREADY_REQUESTED');
  }
  if (userPrize.status === 'approved') {
    throw new AppError('Already approved', 409, 'ALREADY_APPROVED');
  }
  if (userPrize.status === 'delivered') {
    throw new AppError('Already delivered', 409, 'ALREADY_DELIVERED');
  }
  if (userPrize.status === 'rejected') {
    throw new AppError('This claim was rejected', 409, 'ALREADY_REJECTED');
  }
  if (userPrize.status === 'expired') {
    throw new AppError('This prize has expired', 410, 'EXPIRED');
  }
  if (userPrize.expiresAt && userPrize.expiresAt.getTime() < Date.now()) {
    userPrize.status = 'expired';
    await userPrize.save();
    throw new AppError('This prize has expired', 410, 'EXPIRED');
  }

  // Wheel and daily-login prizes require the winner to have completed this prize's own
  // invite task before a withdrawal can even be requested. Store purchases remain ungated.
  if (userPrize.source === 'wheel' || userPrize.source === 'daily') {
    const task = await getClaimTaskForUserPrize(userPrize._id as mongoose.Types.ObjectId);
    if (!task || task.status !== 'completed') {
      const remaining = task ? Math.max(0, task.requiredCount - task.creditedCount) : null;
      throw new AppError(
        remaining !== null
          ? `You still need ${remaining} more qualified referral(s) to claim this prize`
          : 'This prize has no active invite task',
        409,
        'REFERRALS_REQUIRED'
      );
    }
  }

  // Idempotency guard: unique index on WithdrawalRequest.userPrize prevents duplicate requests
  // even under concurrent double-clicks.
  userPrize.claimAttempts += 1;
  userPrize.status = 'claim_requested';
  await userPrize.save();

  let withdrawal;
  try {
    withdrawal = await WithdrawalRequest.create({
      user: user._id,
      telegramId: user.telegramId,
      username: user.username,
      userPrize: userPrize._id,
      prizeNameSnapshot: userPrize.prizeNameSnapshot,
      status: 'pending',
    });
  } catch (err: unknown) {
    // Duplicate key error = a request already exists for this userPrize; treat as idempotent success.
    const existing = await WithdrawalRequest.findOne({ userPrize: userPrize._id });
    if (existing) return existing;
    throw err;
  }

  await createNotification({
    userId: user._id as mongoose.Types.ObjectId,
    telegramId: user.telegramId,
    type: 'claim_pending',
    title: '⏳ طلبك قيد المراجعة',
    body: 'تم تقديم طلب سحبك إلى دعم التسليم.\nإذا تأخر الطلب أكثر من 24 ساعة راسل الدعم.',
  });

  await notifyAdminsNewWithdrawal({
    withdrawalId: (withdrawal._id as mongoose.Types.ObjectId).toString(),
    prizeName: userPrize.prizeNameSnapshot,
    username: user.username,
    telegramId: user.telegramId,
  });

  return withdrawal;
}

export async function listPendingWithdrawals() {
  return WithdrawalRequest.find({ status: 'pending' }).sort({ requestedAt: 1 });
}

export async function findWithdrawalByIdentifier(identifier: string) {
  const clean = identifier.trim().replace(/^#/, '');
  if (!mongoose.isValidObjectId(clean)) {
    throw new AppError('رقم الطلب غير صحيح. استخدم رقم الطلب الكامل بعد علامة #.', 422, 'INVALID_WITHDRAWAL_ID');
  }
  const withdrawal = await WithdrawalRequest.findById(clean).populate('user', 'telegramId username firstName');
  if (!withdrawal) throw new AppError('لم يتم العثور على طلب بهذا الرقم.', 404, 'NOT_FOUND');
  return withdrawal;
}

export async function markWithdrawalDelivered(
  withdrawalId: string,
  actingTelegramId: number,
  actingUsername?: string
) {
  const withdrawal = await findWithdrawalByIdentifier(withdrawalId);
  if (withdrawal.status !== 'approved') {
    throw new AppError(
      withdrawal.status === 'delivered' ? 'هذا الطلب مسجل كمُسلّم مسبقاً.' : 'لا يمكن تسجيل التسليم قبل موافقة الطلب.',
      409,
      'WITHDRAWAL_NOT_READY'
    );
  }

  const now = new Date();
  const updated = await WithdrawalRequest.findOneAndUpdate(
    { _id: withdrawal._id, status: 'approved' },
    {
      status: 'delivered',
      deliveredAt: now,
      deliveredByTelegramId: actingTelegramId,
      deliveredByUsername: actingUsername,
    },
    { new: true }
  );
  if (!updated) throw new AppError('تم تحديث الطلب من جهة أخرى.', 409, 'ALREADY_PROCESSED');

  const deliveredPrize = await UserPrize.findOneAndUpdate(
    { _id: updated.userPrize, status: 'approved' },
    { $set: { status: 'delivered' } },
    { new: true }
  );
  if (deliveredPrize?.prize) {
    await Prize.updateOne({ _id: deliveredPrize.prize }, { $inc: { deliveredCount: 1 } });
  }
  await writeAudit({
    actorId: actingTelegramId,
    actorUsername: actingUsername,
    action: 'withdrawal.deliver',
    target: String(updated._id),
    metadata: { prize: updated.prizeNameSnapshot, telegramId: updated.telegramId },
  });
  await createNotification({
    userId: updated.user,
    telegramId: updated.telegramId,
    type: 'claim_approved',
    title: '✅ تم تسليم جائزتك',
    body: `تم تسليم طلبك #${updated._id}\nتهنّى بـ ${updated.prizeNameSnapshot} 🎉`,
  });
  return updated;
}

export async function getReferralsForWithdrawal(withdrawalId: string) {
  const withdrawal = await WithdrawalRequest.findById(withdrawalId).populate('user');
  if (!withdrawal) throw new AppError('Withdrawal not found', 404, 'NOT_FOUND');
  return withdrawal;
}

/**
 * Shared by both the Mini App admin panel and the Telegram inline "جلب الاحالات" button:
 * returns the withdrawal plus the full referral history of whoever requested it, so an
 * admin can eyeball the invited accounts for signs of fraud before approving.
 */
export async function listReferralsForWithdrawal(withdrawalId: string) {
  const withdrawal = await getReferralsForWithdrawal(withdrawalId);
  // Scoped to the specific prize's claim task — a user with several prizes has a
  // separate set of 5 referrals per prize, so this must not show referrals made
  // for their other, unrelated prizes.
  const claimTask = await getClaimTaskForUserPrize(withdrawal.userPrize);
  const referrals = await Referral.find({
    referrer: withdrawal.user,
    ...(claimTask ? { creditedTaskId: claimTask._id } : {}),
  })
    .populate('invitee', 'username firstName telegramId')
    .sort({ createdAt: -1 });
  return { withdrawal, referrals };
}

export async function approveWithdrawal(
  withdrawalId: string,
  actingAdminTelegramId: number,
  actingAdminUsername?: string
) {
  const withdrawal = await WithdrawalRequest.findById(withdrawalId);
  if (!withdrawal) throw new AppError('Withdrawal not found', 404, 'NOT_FOUND');
  if (withdrawal.status !== 'pending') {
    throw new AppError('Withdrawal already processed', 409, 'ALREADY_PROCESSED');
  }

  // Atomic guard against double-processing (two admins clicking approve simultaneously).
  const updated = await WithdrawalRequest.findOneAndUpdate(
    { _id: withdrawalId, status: 'pending' },
    {
      status: 'approved',
      decidedAt: new Date(),
      decidedByTelegramId: actingAdminTelegramId,
      decidedByUsername: actingAdminUsername,
    },
    { new: true }
  );
  if (!updated) throw new AppError('Withdrawal already processed', 409, 'ALREADY_PROCESSED');

  const userPrize = await UserPrize.findById(updated.userPrize);
  if (userPrize) {
    userPrize.status = 'approved';
    await userPrize.save();

    if (userPrize.prize) {
      const prize = await Prize.findById(userPrize.prize);
      if (prize) {
        const spin = userPrize.spinId ? await RouletteSpin.findById(userPrize.spinId).select('mode isGiftGuaranteed') : null;
        if (!spin?.isGiftGuaranteed) {
          const pendingField = spin?.mode === 'daily' ? 'dailyPendingCount' : spin?.mode === 'points' ? 'pointsPendingCount' : 'pendingCount';
          const current = prize.get(pendingField) as number | null | undefined;
          prize.set(pendingField, Math.max(0, Number(current ?? 0) - 1));
          await prize.save();
        }
      }
    }
  }

  await writeAudit({
    actorId: actingAdminTelegramId,
    actorUsername: actingAdminUsername,
    action: 'withdrawal.approve',
    target: withdrawalId,
    metadata: { prize: updated.prizeNameSnapshot, telegramId: updated.telegramId },
  });

  const deliveryContact = await getDeliveryContactLink();
  const configuredDeliveryUsername = deliveryContact.username || env.DELIVERY_CONTACT_USERNAME;
  const deliveryHandle = configuredDeliveryUsername.startsWith('@')
    ? configuredDeliveryUsername
    : `@${configuredDeliveryUsername}`;
  const escalationGroupHandle = env.ESCALATION_GROUP_USERNAME.startsWith('@')
    ? env.ESCALATION_GROUP_USERNAME
    : `@${env.ESCALATION_GROUP_USERNAME}`;

  await createNotification({
    userId: updated.user,
    telegramId: updated.telegramId,
    type: 'claim_approved',
    title: '✅ تم قبول طلب سحبك',
    body:
      `أضف حساب التسليم ${deliveryHandle} إلى جهات اتصالك لتسليم حسابك.\n\n` +
      `إذا تأخر بالرد انتظر، ربما لديه أعمال.\n` +
      `إذا طال انتظارك أكثر من اللازم، قم بمنشنته في قروب MF ${escalationGroupHandle}.`,
  });
  await notifyDeliveryAccountNewWithdrawal({
    withdrawalId: String(updated._id),
    prizeName: updated.prizeNameSnapshot,
    username: updated.username,
    telegramId: updated.telegramId,
  });

  return updated;
}

export async function rejectWithdrawal(
  withdrawalId: string,
  reason: string,
  actingAdminTelegramId: number,
  actingAdminUsername?: string
) {
  if (!reason || !reason.trim()) throw new AppError('Rejection reason is required', 422, 'VALIDATION_ERROR');

  const updated = await WithdrawalRequest.findOneAndUpdate(
    { _id: withdrawalId, status: 'pending' },
    {
      status: 'rejected',
      decidedAt: new Date(),
      decidedByTelegramId: actingAdminTelegramId,
      decidedByUsername: actingAdminUsername,
      rejectReason: reason.trim(),
    },
    { new: true }
  );
  if (!updated) throw new AppError('Withdrawal already processed or not found', 409, 'ALREADY_PROCESSED');

  const userPrize = await UserPrize.findById(updated.userPrize);
  if (userPrize) {
    userPrize.status = 'rejected';
    await userPrize.save();

    if (userPrize.prize) {
      const prize = await Prize.findById(userPrize.prize);
      if (prize) {
        const spin = userPrize.spinId ? await RouletteSpin.findById(userPrize.spinId).select('mode isGiftGuaranteed') : null;
        if (!spin?.isGiftGuaranteed) {
          const mode = spin?.mode === 'daily' ? 'daily' : spin?.mode === 'points' ? 'points' : null;
          const stockField = mode === 'daily' ? 'dailyStock' : mode === 'points' ? 'pointsStock' : 'stock';
          const unlimitedField = mode === 'daily' ? 'dailyIsUnlimited' : mode === 'points' ? 'pointsIsUnlimited' : 'isUnlimited';
          const pendingField = mode === 'daily' ? 'dailyPendingCount' : mode === 'points' ? 'pointsPendingCount' : 'pendingCount';
          const current = prize as unknown as Record<string, number | boolean | null | undefined>;
          const isUnlimited = Boolean(current[unlimitedField] ?? current.isUnlimited);
          const update: Record<string, Record<string, number>> = {
            $inc: { [pendingField]: -1 },
          };
          if (!isUnlimited) update.$inc[stockField] = 1;
          await Prize.updateOne({ _id: prize._id }, update);
        }
      }
    }
  }

  await writeAudit({
    actorId: actingAdminTelegramId,
    actorUsername: actingAdminUsername,
    action: 'withdrawal.reject',
    target: withdrawalId,
    metadata: { reason: reason.trim(), prize: updated.prizeNameSnapshot, telegramId: updated.telegramId },
  });

  await createNotification({
    userId: updated.user,
    telegramId: updated.telegramId,
    type: 'claim_rejected',
    title: '❌ تم رفض طلبك',
    body: `تم رفض طلبك بواسطة ${actingAdminUsername ? '@' + actingAdminUsername : 'الإدارة'}\n\nالسبب:\n${reason.trim()}`,
  });

  return updated;
}
