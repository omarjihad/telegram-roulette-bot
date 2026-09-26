import mongoose, { HydratedDocument } from 'mongoose';
import { User, IUser } from '../models/User';
import { Referral } from '../models/Referral';
import { UserPrize } from '../models/UserPrize';
import { IClaimTask } from '../models/ClaimTask';
import { createNotification, notifyAdminsNewReferral } from './notification.service';
import { creditReferralToTask, uncreditReferralFromTask } from './claimTask.service';
import { listClaimTasksForUser } from './claimTask.service';
import { logger } from '../config/logger';
import { getSettings } from '../models/Settings';
import { env } from '../config/env';
import { nanoid } from 'nanoid';
import { checkAllForcedChats } from './forcedSub.service';
import { getBotInstance } from '../bot/instance';

/**
 * Registers a referral relationship when a brand-new user starts the bot via a prize's
 * own claim-task link (task_<token>). This ONLY records who invited whom — it never blocks
 * or gates anything for the invitee. The referral is permanently tied to that one task
 * (creditedTaskId), which is what stops the same invited friend from ever being reused to
 * unlock a second prize. The actual credit toward the task happens later, once qualification
 * conditions (forced-sub + captcha) are independently verified, via tryQualifyReferral().
 *
 * Rules enforced here:
 *  - a user can only ever be referred once, ever (unique index on invitee) — so they can
 *    only ever be credited toward the one task they first came in through
 *  - self-referral is rejected
 *  - referring an already-existing (pre-existing) user does NOT create a referral record
 *  - a task that's no longer pending (already completed/expired) can't accept new invitees
 */
export async function registerReferralIfNew(params: {
  newUser: HydratedDocument<IUser>;
  task: HydratedDocument<IClaimTask>;
  isBrandNewUser: boolean;
  demoMode?: boolean;
}): Promise<
  'registered' | 'demo_registered' | 'self_referral' | 'not_new' | 'already_referred' | 'referrer_not_found' | 'task_not_active'
> {
  const { newUser, task, isBrandNewUser, demoMode = false } = params;

  // Demo mode only relaxes the "brand-new user" rule so the flow can be tested with
  // existing accounts. It never credits the task directly: the referral is still recorded
  // as pending and only counts after forced-sub + captcha via tryQualifyReferral().
  if (!isBrandNewUser && !demoMode) return 'not_new';
  if (task.referrerTelegramId === newUser.telegramId) return 'self_referral';
  if (task.status !== 'pending' || task.expiresAt.getTime() < Date.now()) return 'task_not_active';

  const referrer = await User.findOne({ telegramId: task.referrerTelegramId });
  if (!referrer) return 'referrer_not_found';

  const existing = await Referral.findOne({ invitee: newUser._id });
  if (existing) return 'already_referred';

  await Referral.create({
    referrer: referrer._id,
    referrerTelegramId: referrer.telegramId,
    invitee: newUser._id,
    inviteeTelegramId: newUser.telegramId,
    status: 'pending',
    creditedTaskId: task._id,
  });

  newUser.referredBy = referrer._id as mongoose.Types.ObjectId;
  if (!isBrandNewUser) {
    // An existing (demo) account may have passed the captcha long ago; make it solve a new
    // one so the referral is only counted after the invitee goes through the gates again.
    newUser.captchaPassed = false;
    newUser.captchaPassedAt = undefined;
  }
  await newUser.save();

  await createNotification({
    userId: referrer._id as mongoose.Types.ObjectId,
    telegramId: referrer.telegramId,
    type: 'referral_progress',
    title: '👋 دعوة جديدة',
    body: `دخل ${newUser.username ? '@' + newUser.username : newUser.firstName || 'مستخدم'} إلى رابطك. راح تُحتسب بعد إكمال الاشتراك الإجباري والتحقق.`,
  });

  const wonPrize = await UserPrize.findById(task.userPrize).select('prizeNameSnapshot');
  notifyAdminsNewReferral({
    invitee: { telegramId: newUser.telegramId, username: newUser.username, firstName: newUser.firstName },
    referrer: { telegramId: referrer.telegramId, username: referrer.username, firstName: referrer.firstName },
    prizeName: wonPrize?.prizeNameSnapshot ?? 'غير معروف',
  }).catch((err) => logger.warn({ err }, 'failed to notify admins of new referral'));

  return isBrandNewUser ? 'registered' : 'demo_registered';
}

/**
 * Called whenever an invitee's forced-sub or captcha status changes. Once BOTH are satisfied
 * for the first time, the referral flips to "qualified" and — if it was made through a prize's
 * claim task — that task's progress is credited by one. This never grants a standalone bonus
 * prize anymore; a qualified referral's only effect is moving its task closer to complete.
 */
export async function tryQualifyReferral(inviteeUserId: mongoose.Types.ObjectId): Promise<void> {
  const referral = await Referral.findOne({ invitee: inviteeUserId, status: 'pending' });
  if (!referral) return;

  const invitee = await User.findById(inviteeUserId);
  if (!invitee) return;

  if (!invitee.forcedSubOk || !invitee.captchaPassed || !invitee.captchaPassedAt) return;
  // The captcha must have been solved after the invitee arrived through the link, not
  // carried over from an earlier session.
  if (invitee.captchaPassedAt.getTime() < referral.createdAt.getTime()) return;

  // Never trust the cached flag alone: confirm live membership with Telegram right before
  // the referral counts.
  if (process.env.NODE_ENV !== 'test') {
    const { allOk } = await checkAllForcedChats(getBotInstance(), invitee.telegramId);
    if (!allOk) {
      invitee.forcedSubOk = false;
      await invitee.save();
      return;
    }
  }

  referral.status = 'qualified';
  referral.qualifiedAt = new Date();
  referral.forcedSubOkAt = referral.forcedSubOkAt ?? new Date();
  referral.captchaOkAt = referral.captchaOkAt ?? new Date();
  await referral.save();

  await createNotification({
    userId: referral.referrer,
    telegramId: referral.referrerTelegramId,
    type: 'referral_progress',
    title: '✅ إحالة مؤهلة',
    body: `أصبحت إحالتك من ${invitee.username ? '@' + invitee.username : invitee.firstName || 'المستخدم'} مؤهلة!`,
  });

  if (referral.creditedTaskId) {
    await creditReferralToTask(referral.creditedTaskId as mongoose.Types.ObjectId);
  } else {
    logger.warn({ referralId: referral._id }, 'qualified referral with no claim task attached');
  }
}

/**
 * An invited user who blocks the bot loses their referral for good: it is marked rejected,
 * taken off the prize task it counted toward, and the inviter is told why.
 */
export async function revokeReferralForBlockedInvitee(inviteeTelegramId: number) {
  const referral = await Referral.findOneAndUpdate(
    { inviteeTelegramId, status: { $in: ['pending', 'qualified'] } },
    { $set: { status: 'rejected', revokedReason: 'blocked_bot', revokedAt: new Date() } },
    { new: false }
  );
  if (!referral) return null;

  let remaining: number | null = null;
  if (referral.status === 'qualified' && referral.creditedTaskId) {
    remaining = await uncreditReferralFromTask(referral.creditedTaskId as mongoose.Types.ObjectId);
  }

  const invitee = await User.findOne({ telegramId: inviteeTelegramId }).select('username firstName');
  const name = invitee?.username ? '@' + invitee.username : invitee?.firstName || 'المستخدم';
  await createNotification({
    userId: referral.referrer,
    telegramId: referral.referrerTelegramId,
    type: 'referral_progress',
    title: '🚫 انحذفت دعوة',
    body:
      `${name} حظر البوت، فراحت دعوته وما تنحسب إلك.` +
      (remaining !== null ? `\nباقي عليك ${remaining} دعوة مؤهلة لهذه الجائزة.` : ''),
  });
  logger.info({ inviteeTelegramId, referralId: referral._id, wasQualified: referral.status === 'qualified' }, 'referral revoked: invitee blocked the bot');
  return { wasQualified: referral.status === 'qualified', remaining };
}

export async function getReferralStats(telegramId: number) {
  const user = await User.findOne({ telegramId });
  if (!user) return null;

  const [pending, qualified] = await Promise.all([
    Referral.countDocuments({ referrer: user._id, status: 'pending' }),
    Referral.countDocuments({ referrer: user._id, status: 'qualified' }),
  ]);

  const list = await Referral.find({ referrer: user._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('invitee', 'username firstName telegramId photoUrl');

  const tasks = await listClaimTasksForUser(user._id as mongoose.Types.ObjectId);
  const milestoneCount = Math.floor(qualified / 20);
  const claimedMilestones = user.referralMilestoneClaims ?? 0;
  return {
    pending,
    qualified,
    total: pending + qualified,
    referrals: list,
    tasks,
    referralRewards: {
      rewardPoints: 1.2,
      requiredReferrals: 20,
      claimedMilestones,
      availableMilestones: Math.max(0, milestoneCount - claimedMilestones),
    },
  };
}

export async function getGeneralReferralLink(user: HydratedDocument<IUser>) {
  if (!env.BOT_USERNAME) return null;
  if (!user.generalReferralToken) {
    user.generalReferralToken = nanoid(12);
    await user.save();
  }
  const payload = `ref_${user.generalReferralToken}`;
  return env.MINI_APP_SHORT_NAME
    ? `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=${payload}`
    : `https://t.me/${env.BOT_USERNAME}?start=${payload}`;
}

export function parseGeneralReferralToken(startParam?: string | null): string | null {
  if (!startParam) return null;
  const match = startParam.match(/^ref_([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export async function registerGeneralReferralIfNew(params: {
  newUser: HydratedDocument<IUser>;
  referralToken: string;
  isBrandNewUser: boolean;
}): Promise<'registered' | 'not_new' | 'self_referral' | 'already_referred' | 'referrer_not_found'> {
  const { newUser, referralToken, isBrandNewUser } = params;
  if (!isBrandNewUser) return 'not_new';
  const referrer = await User.findOne({ generalReferralToken: referralToken });
  if (!referrer) return 'referrer_not_found';
  if (referrer.telegramId === newUser.telegramId) return 'self_referral';
  const existing = await Referral.findOne({ invitee: newUser._id });
  if (existing) return 'already_referred';

  await Referral.create({
    referrer: referrer._id,
    referrerTelegramId: referrer.telegramId,
    invitee: newUser._id,
    inviteeTelegramId: newUser.telegramId,
    status: 'pending',
  });
  newUser.referredBy = referrer._id as mongoose.Types.ObjectId;
  await newUser.save();
  await createNotification({
    userId: referrer._id as mongoose.Types.ObjectId,
    telegramId: referrer.telegramId,
    type: 'referral_progress',
    title: '👋 دعوة جديدة',
    body: `دخل ${newUser.username ? '@' + newUser.username : newUser.firstName || 'مستخدم'} إلى رابط إحالتك العامة. راح تُحتسب بعد إكمال الاشتراك الإجباري والتحقق.`,
  });
  return 'registered';
}

export async function claimReferralMilestone(telegramId: number) {
  const session = await mongoose.startSession();
  try {
    let result: { rewardPoints: number; qualified: number; availableMilestones: number } | null = null;
    await session.withTransaction(async () => {
      const user = await User.findOne({ telegramId }).session(session);
      if (!user) throw new Error('USER_NOT_FOUND');
      const qualified = await Referral.countDocuments({ referrer: user._id, status: 'qualified' }).session(session);
      const completedMilestones = Math.floor(qualified / 20);
      const claimedMilestones = user.referralMilestoneClaims ?? 0;
      if (claimedMilestones >= completedMilestones) {
        const error = new Error('REFERRAL_MILESTONE_NOT_READY');
        (error as Error & { code?: string }).code = 'REFERRAL_MILESTONE_NOT_READY';
        throw error;
      }
      const updated = await User.updateOne(
        { _id: user._id, referralMilestoneClaims: claimedMilestones },
        { $inc: { referralMilestoneClaims: 1, spinPoints: 1.2 } },
        { session }
      );
      if (updated.modifiedCount !== 1) throw new Error('REFERRAL_MILESTONE_RETRY');
      result = {
        rewardPoints: 1.2,
        qualified,
        availableMilestones: Math.max(0, completedMilestones - claimedMilestones - 1),
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}
