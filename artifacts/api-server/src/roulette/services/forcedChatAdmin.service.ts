import { ForcedChat } from '../models/ForcedChat';
import { resolveUserLookup } from './user.service';
import { fetchChatInfo } from './forcedSub.service';
import { writeAudit } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import type TelegramBot from 'node-telegram-bot-api';

export function normalizeChatIdentifier(input: string): string {
  const { byUsername, byTelegramId } = resolveUserLookup(input);
  if (byTelegramId !== undefined) return String(byTelegramId);
  if (byUsername) return `@${byUsername}`;
  return input.trim();
}

const BOT_ADMIN_STATUSES = new Set(['administrator', 'creator']);

/**
 * The forced-sub membership check (checkMembership in forcedSub.service) fails closed:
 * if the bot can't query a chat, every user gets treated as "not subscribed" — silently
 * locking everyone out with no way to ever pass. So we refuse to add a chat as forced-sub
 * in the first place unless the bot is already an admin there, catching the mistake at
 * add-time instead of leaving users stuck later.
 */
export async function assertBotIsAdminInChat(bot: TelegramBot, chatId: string): Promise<void> {
  let botId: number;
  try {
    botId = (await bot.getMe()).id;
  } catch (err) {
    throw new AppError('Could not verify the bot itself with Telegram, try again', 502, 'BOT_SELF_CHECK_FAILED');
  }

  let member: TelegramBot.ChatMember;
  try {
    member = await bot.getChatMember(chatId, botId);
  } catch (err) {
    throw new AppError(
      'Could not check this chat — make sure the bot has been added to it first',
      422,
      'BOT_NOT_IN_CHAT'
    );
  }

  if (!BOT_ADMIN_STATUSES.has(member.status)) {
    throw new AppError(
      'The bot must be an admin in this channel/group before it can be used for forced subscription',
      422,
      'BOT_NOT_ADMIN'
    );
  }
}

export async function addForcedChat(
  bot: TelegramBot,
  input: string,
  actorId: number,
  actorUsername?: string
) {
  const normalized = normalizeChatIdentifier(input);
  const existing = await ForcedChat.findOne({ chatId: normalized });
  if (existing) throw new AppError('Chat already added', 409, 'ALREADY_EXISTS');

  await assertBotIsAdminInChat(bot, normalized);

  const info = await fetchChatInfo(bot, normalized);

  const chat = await ForcedChat.create({
    chatId: normalized,
    title: info?.title ?? normalized,
    type: info?.type ?? 'unknown',
    inviteLink: info?.inviteLink,
    addedBy: actorId,
    isActive: true,
  });

  await writeAudit({ actorId, actorUsername, action: 'forcedchat.add', target: normalized, metadata: { title: chat.title } });
  return chat;
}

export async function removeForcedChat(input: string, actorId: number, actorUsername?: string) {
  const normalized = normalizeChatIdentifier(input);
  const chat = await ForcedChat.findOneAndDelete({ chatId: normalized });
  if (!chat) throw new AppError('Chat not found', 404, 'NOT_FOUND');
  await writeAudit({ actorId, actorUsername, action: 'forcedchat.remove', target: normalized });
  return chat;
}

export async function listForcedChats() {
  return ForcedChat.find({}).sort({ createdAt: -1 });
}

export async function clearAllForcedChats(actorId: number, actorUsername?: string) {
  await ForcedChat.deleteMany({});
  await writeAudit({ actorId, actorUsername, action: 'forcedchat.clear_all' });
}
