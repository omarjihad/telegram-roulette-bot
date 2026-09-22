import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { registerStartHandler } from './start';
import { registerAdminWithdrawalActions } from './adminWithdrawalActions';
import { registerMemberEventHandlers } from './memberEvents';
import { setBotInstance } from './instance';
import { attachBotInstance } from '../services/notification.service';
import { registerAdminCommands } from './adminCommands';

export function createBot(enablePolling = false): TelegramBot {
  // `allowed_updates` must be listed explicitly: Telegram only sends the classic update
  // types (message, callback_query, ...) by default over long polling. Newer types like
  // my_chat_member (needed to detect a user blocking the bot) are silently omitted unless
  // requested here.
  const bot = new TelegramBot(env.BOT_TOKEN, {
    polling: enablePolling ? {
      params: {
        allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
      },
    } : false,
  });

  bot.on('polling_error', (err) => {
    logger.error({ code: (err as { code?: string }).code }, 'Telegram polling error');
  });

  registerStartHandler(bot);
  registerAdminWithdrawalActions(bot);
  registerAdminCommands(bot);
  registerMemberEventHandlers(bot);

  setBotInstance(bot);
  attachBotInstance(bot);

  // Keep the chat menu button pointing at the current deployment. Without this it keeps
  // whatever URL was set earlier (e.g. an old, now-suspended host). Note: the Mini App
  // registered in @BotFather (t.me/<bot>/<short name>) can only be changed in BotFather.
  if (enablePolling && env.MINI_APP_URL) {
    bot
      .setChatMenuButton({ menu_button: { type: 'web_app', text: 'فتح البوت', web_app: { url: env.MINI_APP_URL } } })
      .then(() => logger.info({ url: env.MINI_APP_URL }, 'chat menu button synced'))
      .catch((err) => logger.warn({ err }, 'failed to sync chat menu button'));
  }

  logger.info({ polling: enablePolling }, 'Telegram client initialized');
  return bot;
}
