import cron from 'node-cron';
import { UserPrize } from '../models/UserPrize';
import { getSettings } from '../models/Settings';
import { createNotification } from '../services/notification.service';
import { expireClaimTaskForUserPrize } from '../services/claimTask.service';
import { writeAudit } from '../models/AuditLog';
import { logger } from '../config/logger';
import mongoose from 'mongoose';
import { Task } from '../models/Task';
import { UserTask } from '../models/UserTask';
import { User } from '../models/User';
import { verifyDeliveryProfile } from '../services/deliveryAccount.service';
import { releasePrizeReservation } from '../services/prizeReservation.service';

/**
 * Runs every 5 minutes. Because it re-derives everything from `expiresAt` timestamps stored
 * in MongoDB (not from in-memory timers), a server restart never loses a scheduled expiry or
 * a scheduled reminder — the next tick simply re-evaluates the current state of the world.
 */
export function startExpirationWorker() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      await processExpirations();
      await processExpiryReminders();
      await processProfileTaskVerification();
    } catch (err) {
      logger.error({ err }, 'expiration worker tick failed');
    }
  });
  logger.info('⏰ Expiration worker scheduled (every 5 minutes)');
}

/**
 * Re-checks profile requirements on the same five-minute cadence as prize expiry.
 * A failed Telegram read is ignored: only an explicit, successful read proving the
 * requirement is absent can revoke the previously awarded points.
 */
async function processProfileTaskVerification() {
  const tasks = await Task.find({
    isActive: true,
    taskType: { $in: ['profile_name', 'profile_bio'] },
  }).lean();
  if (tasks.length === 0) return;

  for (const task of tasks) {
    const claims = await UserTask.find({ task: task._id, isRevoked: false });
    for (const claim of claims) {
      try {
        const user = await User.findById(claim.user).select('firstName lastName username').lean();
        const stillValid = await verifyDeliveryProfile(
          claim.telegramId,
          task.taskType === 'profile_name' ? 'name' : 'bio',
          user ?? undefined,
        );
        if (stillValid) {
          await UserTask.updateOne({ _id: claim._id, isRevoked: false }, { $set: { lastVerifiedAt: new Date() } });
          continue;
        }

        const revoked = await UserTask.findOneAndUpdate(
          { _id: claim._id, isRevoked: false },
          { $set: { isRevoked: true, revokedAt: new Date() } },
          { new: true },
        );
        if (revoked) {
          await User.updateOne({ _id: claim.user }, { $inc: { spinPoints: -task.rewardPoints } });
          logger.info({ telegramId: claim.telegramId, taskId: task._id }, 'profile task reward revoked');
        }
      } catch (err) {
        logger.warn({ err, telegramId: claim.telegramId, taskId: task._id }, 'profile task verification unavailable; keeping reward');
      }
    }
  }
}

async function processExpirations() {
  const now = new Date();
  const expiring = await UserPrize.find({
    status: 'active',
    expiresAt: { $ne: null, $lte: now },
  });

  let processed = 0;
  for (const candidate of expiring) {
    try {
      // Flip the status atomically so a claim landing at the same moment can't also act on it.
      const item = await UserPrize.findOneAndUpdate(
        { _id: candidate._id, status: 'active' },
        { $set: { status: 'expired' } },
        { new: true }
      );
      if (!item) continue;
      processed += 1;

      // The winner didn't meet the conditions in time: the prize leaves their inventory
      // and goes back to the bot's stock so someone else can win it.
      await releasePrizeReservation(item);
      await expireClaimTaskForUserPrize(item._id as mongoose.Types.ObjectId);

      await createNotification({
        userId: item.user as mongoose.Types.ObjectId,
        telegramId: item.telegramId,
        type: 'prize_expiring',
        title: '⌛ انتهى وقت الجائزة',
        body: `انتهى وقت جائزتك [${item.prizeNameSnapshot}] لأن شروط الاستلام ما اكتملت، ورجعت لمخزون البوت.`,
      }).catch((err) => logger.warn({ err }, 'failed to notify user about expired prize'));

      await writeAudit({
        actorId: 0,
        actorUsername: 'system',
        action: 'prize.expired',
        target: String(item.telegramId),
        metadata: { prizeName: item.prizeNameSnapshot, userPrizeId: item._id, stockReturned: true },
      });
    } catch (err) {
      logger.error({ err, userPrizeId: candidate._id }, 'failed to expire user prize');
    }
  }

  if (processed > 0) {
    logger.info({ count: processed }, 'expired user prizes processed');
  }
}

async function processExpiryReminders() {
  const settings = await getSettings();
  const reminderIntervalMs = settings.expiryReminderIntervalHours * 60 * 60 * 1000;
  const now = new Date();

  const candidates = await UserPrize.find({
    status: 'active',
    expiresAt: { $ne: null, $gt: now },
  });

  for (const item of candidates) {
    if (!item.expiresAt) continue;
    const lastNotified = item.lastExpiryNotifiedAt ?? item.wonAt;
    const dueForReminder = now.getTime() - lastNotified.getTime() >= reminderIntervalMs;
    if (!dueForReminder) continue;

    const hoursLeft = Math.max(0, Math.round((item.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000)));

    await createNotification({
      userId: item.user as mongoose.Types.ObjectId,
      telegramId: item.telegramId,
      type: 'prize_expiring',
      title: '⚠️ تنبيه',
      body: `باقي على انتهاء جائزتك [${item.prizeNameSnapshot}] وقت محدود (${hoursLeft} ساعة تقريباً).\n\nأكمل الاستلام حتى لا تخسرها.`,
    });

    item.lastExpiryNotifiedAt = now;
    await item.save();
  }
}
