import { User } from '../models/User';
import { getSettings } from '../models/Settings';
import { getBotInstance } from '../bot/instance';
import { buildMiniAppKeyboard } from '../bot/start';
import { logger } from '../config/logger';

const HOUR_MS = 60 * 60 * 1000;
// Only remind people who spun recently, so a first deploy doesn't message every dormant user.
const ACTIVE_WINDOW_MS = 7 * 24 * HOUR_MS;
const BATCH_SIZE = 200;
const SEND_GAP_MS = 50; // stays well under Telegram's ~30 messages/second limit

export const SPIN_READY_MESSAGE =
  '🎡 عادت إليك العجلة اليومية!\n\n' +
  'فرتك المجانية صارت جاهزة، جرّب حظك الآن وممكن تربح جائزة 🎁\n\n' +
  '👇 قم بإدارتها الآن';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one "your free daily spin is back" message per cooldown: a user is due when their
 * cooldown has passed and they haven't been told since their last spin.
 */
export async function processSpinReadyReminders() {
  const settings = await getSettings();
  const now = Date.now();
  const cooldownCutoff = new Date(now - settings.spinCooldownHours * HOUR_MS);
  const activeCutoff = new Date(now - settings.spinCooldownHours * HOUR_MS - ACTIVE_WINDOW_MS);

  const due = await User.find({
    isBanned: { $ne: true },
    botBlocked: { $ne: true },
    lastSpinAt: { $ne: null, $lte: cooldownCutoff, $gte: activeCutoff },
    $or: [{ spinReadyNotifiedAt: null }, { $expr: { $lt: ['$spinReadyNotifiedAt', '$lastSpinAt'] } }],
  })
    .select('telegramId lastSpinAt')
    .limit(BATCH_SIZE);
  if (due.length === 0) return;

  const bot = getBotInstance();
  let sent = 0;
  for (const user of due) {
    // Mark first so a slow send or a crash never produces a duplicate reminder.
    const marked = await User.updateOne(
      { _id: user._id, lastSpinAt: user.lastSpinAt },
      { $set: { spinReadyNotifiedAt: new Date() } }
    );
    if (marked.modifiedCount !== 1) continue;
    try {
      await bot.sendMessage(user.telegramId, SPIN_READY_MESSAGE, buildMiniAppKeyboard('🎡 أدر العجلة الآن'));
      sent += 1;
    } catch (err) {
      const code = (err as { response?: { statusCode?: number } }).response?.statusCode;
      if (code === 403) await User.updateOne({ _id: user._id }, { $set: { botBlocked: true } });
      else logger.warn({ err, telegramId: user.telegramId }, 'failed to send spin-ready reminder');
    }
    await sleep(SEND_GAP_MS);
  }
  logger.info({ due: due.length, sent }, 'spin-ready reminders processed');
}
