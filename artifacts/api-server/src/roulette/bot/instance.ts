import type TelegramBot from 'node-telegram-bot-api';

let bot: TelegramBot | null = null;

export function setBotInstance(instance: TelegramBot) {
  bot = instance;
}

export function getBotInstance(): TelegramBot {
  if (!bot) {
    throw new Error('Bot instance not initialized yet');
  }
  return bot;
}
