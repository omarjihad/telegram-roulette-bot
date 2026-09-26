import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../config/logger';
import { notifyAdminsBlockStatus } from '../services/notification.service';
import { revokeReferralForBlockedInvitee } from '../services/referral.service';
import { User } from '../models/User';

/**
 * Telegram sends a `my_chat_member` update whenever a user starts/stops/blocks the bot in
 * their private chat with it. For private chats, status flips to "kicked" when the user
 * blocks the bot, and back to "member" if they unblock it. This is the only reliable signal
 * Telegram gives for "someone blocked the bot" — there's no separate dedicated event.
 */
export function registerMemberEventHandlers(bot: TelegramBot) {
  bot.on('my_chat_member', async (update) => {
    try {
      if (update.chat.type !== 'private') return;

      const prevStatus = update.old_chat_member?.status;
      const newStatus = update.new_chat_member?.status;
      if (prevStatus === newStatus) return;

      const person = {
        telegramId: update.from.id,
        username: update.from.username,
        firstName: update.from.first_name,
      };

      if (newStatus === 'kicked') {
        await User.updateOne({ telegramId: person.telegramId }, { $set: { botBlocked: true } });
        await notifyAdminsBlockStatus(person, true);
        // Blocking the bot is against the referral rules: the invite no longer counts.
        await revokeReferralForBlockedInvitee(person.telegramId);
      } else if (newStatus === 'member' && prevStatus === 'kicked') {
        await User.updateOne({ telegramId: person.telegramId }, { $set: { botBlocked: false } });
        await notifyAdminsBlockStatus(person, false);
      }
    } catch (err) {
      logger.error({ err }, 'error handling my_chat_member update');
    }
  });
}
