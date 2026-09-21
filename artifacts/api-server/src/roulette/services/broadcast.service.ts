import type TelegramBot from 'node-telegram-bot-api';
import { User } from '../models/User';
import { ForcedChat } from '../models/ForcedChat';
import { logger } from '../config/logger';
import { writeAudit } from '../models/AuditLog';

export interface BroadcastButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface BroadcastTarget {
  scope: 'all' | 'channels' | 'direct';
  telegramIds?: number[]; // used when scope === 'direct'
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  blocked: number;
  total: number;
}

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000; // stay well under Telegram's ~30 msg/sec global limit

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInlineKeyboard(buttons?: BroadcastButton[]) {
  if (!buttons || buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((b) => [
      b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callbackData || 'noop' },
    ]),
  };
}

export async function runBroadcast(
  bot: TelegramBot,
  message: string,
  target: BroadcastTarget,
  buttons: BroadcastButton[] | undefined,
  actorId: number,
  actorUsername?: string
): Promise<BroadcastResult> {
  let recipientIds: number[] = [];

  if (target.scope === 'direct') {
    recipientIds = target.telegramIds ?? [];
  } else if (target.scope === 'all') {
    const users = await User.find({ isBanned: false }, { telegramId: 1 });
    recipientIds = users.map((u) => u.telegramId);
  } else if (target.scope === 'channels') {
    const chats = await ForcedChat.find({ isActive: true }, { chatId: 1 });
    const result: BroadcastResult = { sent: 0, failed: 0, blocked: 0, total: chats.length };
    for (const chat of chats) {
      try {
        await bot.sendMessage(chat.chatId, message, { reply_markup: buildInlineKeyboard(buttons) });
        result.sent += 1;
      } catch (err) {
        logger.warn({ err, chatId: chat.chatId }, 'broadcast to channel failed');
        result.failed += 1;
      }
      await sleep(300);
    }
    await writeAudit({ actorId, actorUsername, action: 'broadcast.send', target: 'channels', metadata: { ...result } });
    return result;
  }

  const result: BroadcastResult = { sent: 0, failed: 0, blocked: 0, total: recipientIds.length };

  for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
    const batch = recipientIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (id) => {
        try {
          await bot.sendMessage(id, message, { reply_markup: buildInlineKeyboard(buttons) });
          result.sent += 1;
        } catch (err: unknown) {
          const description =
            typeof err === 'object' && err !== null && 'response' in err
              ? JSON.stringify((err as { response?: unknown }).response)
              : String(err);

          if (description.includes('bot was blocked') || description.includes('user is deactivated')) {
            result.blocked += 1;
          } else if (description.includes('retry_after') || description.includes('Too Many Requests')) {
            // Back off and retry this single recipient once.
            await sleep(2000);
            try {
              await bot.sendMessage(id, message, { reply_markup: buildInlineKeyboard(buttons) });
              result.sent += 1;
            } catch {
              result.failed += 1;
            }
          } else {
            result.failed += 1;
            logger.warn({ err, id }, 'broadcast send failed');
          }
        }
      })
    );
    await sleep(BATCH_DELAY_MS);
  }

  await writeAudit({
    actorId,
    actorUsername,
    action: 'broadcast.send',
    target: target.scope,
    metadata: { ...result },
  });

  return result;
}
