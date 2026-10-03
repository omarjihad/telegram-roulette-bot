import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { registerStartHandler } from './start';
import { registerAdminWithdrawalActions } from './adminWithdrawalActions';
import { registerMemberEventHandlers } from './memberEvents';
import { setBotInstance } from './instance';
import { attachBotInstance } from '../services/notification.service';
import { registerAdminCommands } from './adminCommands';
import { registerExchangeActions } from './exchangeActions';
import { attachExchangeBot } from '../services/exchange.service';
import { registerMediationActions } from './mediationActions';
import { recordSharedCard } from '../services/claimTask.service';
import { attachMediationBot } from '../services/mediation.service';

export function createBot(enablePolling = false): TelegramBot {
  // `allowed_updates` must be listed explicitly: Telegram only sends the classic update
  // types (message, callback_query, ...) by default over long polling. Newer types like
  // my_chat_member (needed to detect a user blocking the bot) are silently omitted unless
  // requested here.
  const bot = new TelegramBot(env.BOT_TOKEN, {
    polling: enablePolling ? {
      params: {
        allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request', 'chosen_inline_result'],
      },
    } : false,
  });

  bot.on('polling_error', (err) => {
    logger.error({ code: (err as { code?: string }).code }, 'Telegram polling error');
  });

  registerStartHandler(bot);
  registerAdminWithdrawalActions(bot);
  registerAdminCommands(bot);
  registerExchangeActions(bot);
  registerMediationActions(bot);
  // A shared prize card reached a chat (needs inline feedback on in @BotFather).
  bot.on('chosen_inline_result', (result) => {
    logger.info({ resultId: result.result_id, from: result.from.id, hasInlineId: Boolean(result.inline_message_id) }, 'chosen_inline_result');
    void recordSharedCard(result.result_id, result.from.id, result.inline_message_id).catch((err) =>
      logger.warn({ err }, 'failed to record shared prize card')
    );
  });
  registerMemberEventHandlers(bot);

  setBotInstance(bot);
  attachBotInstance(bot);
  attachExchangeBot(bot);
  attachMediationBot(bot);

  // Keep the chat menu button pointing at the current deployment. Without this it keeps
  // whatever URL was set earlier (e.g. an old, now-suspended host). Note: the Mini App
  // registered in @BotFather (t.me/<bot>/<short name>) can only be changed in BotFather.
  if (enablePolling && env.MINI_APP_URL) {
    bot
      .setChatMenuButton({ menu_button: { type: 'web_app', text: 'فتح البوت', web_app: { url: env.MINI_APP_URL } } })
      .then(() => logger.info({ url: env.MINI_APP_URL }, 'chat menu button synced'))
      .catch((err) => logger.warn({ err }, 'failed to sync chat menu button'));
  }
  if (enablePolling) {
    // Command list in the chat's "/" menu; Telegram shows the English one to English apps.
    bot
      .setMyCommands([
        { command: 'start', description: 'فتح البوت' },
        { command: 'language', description: 'تغيير اللغة / Change language' },
      ])
      .catch((err) => logger.warn({ err }, 'failed to set bot commands'));
    bot
      .setMyCommands(
        [
          { command: 'start', description: 'Open the bot' },
          { command: 'language', description: 'Change language / تغيير اللغة' },
        ],
        { language_code: 'en' } as never
      )
      .catch((err) => logger.warn({ err }, 'failed to set English bot commands'));
  }

  logger.info({ polling: enablePolling }, 'Telegram client initialized');
  return bot;
}
