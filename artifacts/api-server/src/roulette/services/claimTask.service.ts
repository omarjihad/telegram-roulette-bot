import mongoose, { ClientSession, HydratedDocument } from 'mongoose';
import { nanoid } from 'nanoid';
import { ClaimTask, IClaimTask } from '../models/ClaimTask';
import { IUserPrize, UserPrize } from '../models/UserPrize';
import { getSettings } from '../models/Settings';
import { env } from '../config/env';
import { createNotification } from './notification.service';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { t } from '../i18n';
import { consumeAdView } from './games.service';

/** Friends the prize card must be shared with (step 2 of a step-by-step claim). */
export const CLAIM_SHARES_REQUIRED = 3;

/** The deadline of a task whose prize never expires. */
export const NO_DEADLINE = new Date('2100-01-01T00:00:00Z');

/**
 * Prizes that go through the claim steps (ad, share, invites) before they can be withdrawn:
 * wheel, daily-login, and gift-link prizes (source 'referral'). Store purchases don't.
 */
export function needsClaimTask(source: IUserPrize['source']) {
  return source === 'wheel' || source === 'daily' || source === 'referral';
}

type TaskLike = Pick<IClaimTask, 'steps' | 'adWatchedAt' | 'shareRequired' | 'sharedInlineIds' | 'shareConfirmedIds' | 'creditedCount' | 'requiredCount'> &
  Partial<Pick<IClaimTask, 'shareOpeners'>>;

/**
 * Friends the card reached, from whichever signal shows the most:
 * - each chat Telegram reports the prepared message was sent to (needs inline feedback
 *   on in @BotFather),
 * - each share the Mini App saw Telegram confirm,
 * - each different person who opened the card's link.
 */
export function shareCount(task: Pick<IClaimTask, 'sharedInlineIds' | 'shareConfirmedIds'> & Partial<Pick<IClaimTask, 'shareOpeners'>>) {
  return Math.max(task.sharedInlineIds?.length ?? 0, task.shareConfirmedIds?.length ?? 0, task.shareOpeners?.length ?? 0);
}

/** Someone opened a prize card's link (startapp/start task_<token>): counts as a friend reached. */
export async function recordShareOpener(token: string, openerTelegramId: number) {
  const task = await ClaimTask.findOne({ token, status: 'pending', steps: true });
  if (!task || task.referrerTelegramId === openerTelegramId || task.shareOpeners?.includes(openerTelegramId)) return false;
  task.shareOpeners = [...(task.shareOpeners ?? []), openerTelegramId];
  await task.save();
  await completeIfDone(task);
  return true;
}

/** Which step a task is on: 1 ad, 2 share, 3 invites, 4 all done. Old tasks start at 3. */
export function currentStep(task: TaskLike) {
  if (task.steps) {
    if (!task.adWatchedAt) return 1;
    if (shareCount(task) < (task.shareRequired ?? CLAIM_SHARES_REQUIRED)) return 2;
  }
  return task.creditedCount >= task.requiredCount ? 4 : 3;
}

/** Marks the task completed once every step is done, and tells the winner. */
async function completeIfDone(task: HydratedDocument<IClaimTask>) {
  if (task.status !== 'pending' || currentStep(task) !== 4) return false;
  task.status = 'completed';
  task.completedAt = new Date();
  await task.save();
  await createNotification({
    userId: task.user,
    telegramId: task.referrerTelegramId,
    type: 'referral_progress',
    title: { ar: '🎉 اكتملت مهام الاستلام', en: '🎉 Claim tasks complete' },
    body: {
      ar: 'أكملت كل مهام هذه الجائزة. تقدر الحين تروح للحقيبة وتضغط "استلام".',
      en: 'You finished every task for this prize. Go to your inventory and tap "Claim".',
    },
  }).catch((err) => logger.warn({ err }, 'failed to notify claim task completion'));
  return true;
}

/**
 * Called right after a wheel prize is granted. Creates the prize's own, unique
 * invite-link requirement: the referrer must bring in `requiredCount` qualified
 * friends through THIS link before they can withdraw THIS specific prize.
 */
export async function createClaimTaskForPrize(
  userPrize: HydratedDocument<IUserPrize>,
  options: { requiredCount?: number; session?: ClientSession; now?: Date; expiresAt?: Date } = {}
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
        expiresAt: options.expiresAt ?? userPrize.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
        steps: true,
        shareRequired: CLAIM_SHARES_REQUIRED,
      },
    ],
    { session: options.session }
  );

  return task;
}

/**
 * The prize's claim task, made now if it has none yet (gift-link prizes given before they
 * needed one). The task ends with its prize.
 */
export async function ensureClaimTask(userPrize: HydratedDocument<IUserPrize>): Promise<HydratedDocument<IClaimTask>> {
  const existing = await ClaimTask.findOne({ userPrize: userPrize._id });
  if (existing) return existing;
  try {
    return await createClaimTaskForPrize(userPrize, { expiresAt: userPrize.expiresAt ?? NO_DEADLINE });
  } catch (err) {
    // Made at the same moment by another request (one task per prize).
    const made = await ClaimTask.findOne({ userPrize: userPrize._id });
    if (made) return made;
    throw err;
  }
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

  if (currentStep(task) === 4) {
    await completeIfDone(task);
  } else if (task.creditedCount >= task.requiredCount) {
    // Invites are done but an earlier step (ad / share) isn't yet.
    await task.save();
  } else {
    await task.save();
    const remaining = task.requiredCount - task.creditedCount;
    await createNotification({
      userId: task.user,
      telegramId: task.referrerTelegramId,
      type: 'referral_progress',
      title: { ar: '👍 إحالة مؤهلة لهذه الجائزة', en: '👍 Qualified invite for this prize' },
      body: {
        ar: `باقي عليك ${remaining} إحالة مؤهلة عشان تكدر تسحب هذي الجائزة.`,
        en: `${remaining} more qualified invites and you can withdraw this prize.`,
      },
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

async function pendingTaskFor(telegramId: number, userPrizeId: string) {
  if (!mongoose.isValidObjectId(userPrizeId)) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  const task = await ClaimTask.findOne({ userPrize: userPrizeId, referrerTelegramId: telegramId });
  if (!task) throw new AppError(t('ما لگينا مهام هذي الجائزة', 'No tasks found for this prize'), 404, 'NOT_FOUND');
  if (task.status === 'expired') throw new AppError(t('انتهى وقت هذي الجائزة', 'This prize has expired'), 409, 'EXPIRED');
  return task;
}

/** Step 1: an ad watched to the end (confirmed by Adsgram when the reward key is set). */
export async function completeClaimAdStep(telegramId: number, userPrizeId: string) {
  const task = await pendingTaskFor(telegramId, userPrizeId);
  if (!task.adWatchedAt) {
    await consumeAdView(telegramId, 'claim_task');
    task.adWatchedAt = new Date();
    await task.save();
    await completeIfDone(task);
  }
  return { step: currentStep(task) };
}

/** Step 2 needs step 1 first; the share window itself is prepared by the inventory controller. */
export async function assertCanShare(telegramId: number, userPrizeId: string) {
  const task = await pendingTaskFor(telegramId, userPrizeId);
  if (task.steps && !task.adWatchedAt) {
    throw new AppError(t('كمّل المهمة الأولى أولاً', 'Finish the first task first'), 409, 'STEP_LOCKED');
  }
  return task;
}

export async function rememberSharePrepared(taskId: mongoose.Types.ObjectId, preparedId: string) {
  await ClaimTask.updateOne({ _id: taskId }, { $push: { sharePreparedIds: { $each: [preparedId], $slice: -30 } } });
}

/** The Mini App saw Telegram confirm a share window was sent. Each window counts once. */
export async function confirmShareSent(telegramId: number, userPrizeId: string, preparedId: string) {
  const task = await pendingTaskFor(telegramId, userPrizeId);
  if (task.sharePreparedIds.includes(preparedId) && !task.shareConfirmedIds.includes(preparedId)) {
    task.shareConfirmedIds.push(preparedId);
    await task.save();
    await completeIfDone(task);
  }
  return { shares: shareCount(task), required: task.shareRequired, step: currentStep(task) };
}

/**
 * Telegram's chosen_inline_result for a shared prize card (result id "cs_<token>_<nonce>"):
 * every chat it reached arrives as its own inline message.
 */
export async function recordSharedCard(resultId: string, fromId: number, inlineMessageId?: string) {
  const m = resultId.match(/^cs_([A-Za-z0-9_-]{10})_/);
  if (!m) return false;
  // Without an inline message id, each report is still one chat the card reached.
  const sentId = inlineMessageId || `${resultId}#${Date.now()}`;
  const task = await ClaimTask.findOne({ token: m[1], referrerTelegramId: fromId });
  if (!task || task.status !== 'pending') return false;
  if (!task.sharedInlineIds.includes(sentId)) {
    task.sharedInlineIds.push(sentId);
    await task.save();
    await completeIfDone(task);
  }
  return true;
}
