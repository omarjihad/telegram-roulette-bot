import mongoose, { ClientSession, HydratedDocument } from 'mongoose';
import { nanoid } from 'nanoid';
import { ClaimTask, IClaimTask } from '../models/ClaimTask';
import { IUserPrize, UserPrize } from '../models/UserPrize';
import { getSettings } from '../models/Settings';
import { env } from '../config/env';
import { createNotification } from './notification.service';
import { logger } from '../config/logger';

/**
 * Called right after a wheel prize is granted. Creates the prize's own, unique
 * invite-link requirement: the referrer must bring in `requiredCount` qualified
 * friends through THIS link before they can withdraw THIS specific prize.
 */
export async function createClaimTaskForPrize(
  userPrize: HydratedDocument<IUserPrize>,
  options: { requiredCount?: number; session?: ClientSession; now?: Date } = {}
): Promise<HydratedDocument<IClaimTask>> {
  const settings = options.requiredCount === undefined ? await getSettings() : null;
  const now = options.now ?? new Date();
  const token = nanoid(10);

  const [task] = await ClaimTask.create(
    [
      {
        userPrize: userPrize._id,
        user: userPrize.user,
        referrerTelegramId: userPrize.telegramId,
        token,
        requiredCount: options.requiredCount ?? settings!.wheelClaimReferralsRequired ?? settings!.claimReferralsRequired,
        creditedCount: 0,
        status: 'pending',
        expiresAt: userPrize.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    ],
    { session: options.session }
  );

  return task;
}

export function buildTaskLink(token: string): string | null {
  if (!env.BOT_USERNAME) return null;
  // If a Mini App short name is configured (set once in @BotFather), link straight into the
  // app itself instead of the bot's chat — one tap fewer for the invited friend. Telegram
  // delivers whatever follows startapp= as signed start_param in the Mini App's initData,
  // so referral capture (registerReferralIfNew, wired in miniAppAuth) works identically.
  if (env.MINI_APP_SHORT_NAME) {
    return `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=task_${token}`;
  }
  return `https://t.me/${env.BOT_USERNAME}?start=task_${token}`;
}

/** Extracts the claim-task token from a start_param/start command payload like "task_XYZ". */
export function parseTaskTokenFromStartParam(startParam?: string | null): string | null {
  if (!startParam) return null;
  const match = startParam.match(/^task_([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export async function getClaimTaskByToken(token: string) {
  return ClaimTask.findOne({ token });
}

export async function getClaimTaskForUserPrize(userPrizeId: mongoose.Types.ObjectId | string) {
  return ClaimTask.findOne({ userPrize: userPrizeId });
}

export async function listClaimTasksForUser(userId: mongoose.Types.ObjectId | string) {
  return ClaimTask.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('userPrize', 'prizeNameSnapshot');
}

/**
 * Called whenever a referral tied to a task becomes qualified (forced-sub + captcha both
 * passed). Bumps that task's credited count and — once it hits the requirement — marks it
 * completed and lets the winner know their prize is now withdrawable.
 */
export async function creditReferralToTask(taskId: mongoose.Types.ObjectId) {
  const task = await ClaimTask.findById(taskId);
  if (!task) return;
  if (task.status !== 'pending') return; // already completed or expired — never re-credit

  task.creditedCount += 1;

  if (task.creditedCount >= task.requiredCount) {
    task.status = 'completed';
    task.completedAt = new Date();
    await task.save();

    await createNotification({
      userId: task.user,
      telegramId: task.referrerTelegramId,
      type: 'referral_progress',
      title: '🎉 اكتملت مهمة الدعوات',
      body: 'أكملت عدد الدعوات المطلوب لهذه الجائزة. تقدر الحين تروح للحقيبة وتضغط "استلام".',
    });
  } else {
    await task.save();
    const remaining = task.requiredCount - task.creditedCount;
    await createNotification({
      userId: task.user,
      telegramId: task.referrerTelegramId,
      type: 'referral_progress',
      title: '👍 إحالة مؤهلة لهذه الجائزة',
      body: `باقي عليك ${remaining} إحالة مؤهلة عشان تكدر تسحب هذي الجائزة.`,
    });
  }

  logger.info({ taskId: task._id, credited: task.creditedCount, required: task.requiredCount }, 'claim task credited');
}

/**
 * Takes one qualified referral back off a task (the invitee blocked the bot). A completed
 * task drops back to pending as long as its prize hasn't been claimed yet; once the winner
 * has requested the withdrawal the task is left alone.
 * Returns how many referrals are still missing, or null when nothing changed.
 */
export async function uncreditReferralFromTask(taskId: mongoose.Types.ObjectId): Promise<number | null> {
  const task = await ClaimTask.findById(taskId);
  if (!task || task.status === 'expired' || task.creditedCount <= 0) return null;

  if (task.status === 'completed') {
    const prize = await UserPrize.findById(task.userPrize).select('status');
    if (!prize || prize.status !== 'active') return null;
    task.status = 'pending';
    task.completedAt = null;
  }
  task.creditedCount -= 1;
  await task.save();
  return Math.max(0, task.requiredCount - task.creditedCount);
}

/** Marks a task expired (called from the expiration worker alongside its UserPrize). */
export async function expireClaimTaskForUserPrize(userPrizeId: mongoose.Types.ObjectId | string) {
  await ClaimTask.updateOne({ userPrize: userPrizeId, status: 'pending' }, { status: 'expired' });
}
