import { WithdrawalRequest, IWithdrawalRequest } from '../models/WithdrawalRequest';
import { Notification, NotificationType } from '../models/Notification';
import { Types } from 'mongoose';
import { listAllAdminTelegramIds } from './admin.service';
import { logger } from '../config/logger';
import type TelegramBot from 'node-telegram-bot-api';
import { DeliveryAccount } from '../models/DeliveryAccount';
import { User } from '../models/User';
import { Bilingual, pick, userLang } from '../i18n';

let botRef: TelegramBot | null = null;

/** Wired up once at startup so services can push Telegram messages without circular imports. */
export function attachBotInstance(bot: TelegramBot) {
  botRef = bot;
}

export async function createNotification(params: {
  userId: Types.ObjectId;
  telegramId: number;
  type: NotificationType;
  title: Bilingual;
  body: Bilingual;
  pushToTelegram?: boolean;
}) {
  // Written in the user's own language, both in the app's history and in the bot chat.
  const user = await User.findOne({ telegramId: params.telegramId }).select('language').lean();
  const lang = userLang(user);
  const title = pick(params.title, lang);
  const body = pick(params.body, lang);
  const notif = await Notification.create({
    user: params.userId,
    telegramId: params.telegramId,
    type: params.type,
    title,
    body,
  });

  if (params.pushToTelegram !== false && botRef) {
    try {
      await botRef.sendMessage(params.telegramId, `${title}\n\n${body}`);
    } catch (err) {
      logger.warn({ err, telegramId: params.telegramId }, 'failed to push telegram notification');
    }
  }

  return notif;
}

/** Broadcasts a system message to every owner/developer (used for stock alerts, withdrawal requests). */
export async function notifyAllAdmins(type: NotificationType, title: string, body: string) {
  const adminIds = await listAllAdminTelegramIds();
  if (botRef) {
    await Promise.all(
      adminIds.map((id) =>
        botRef!.sendMessage(id, `${title}\n\n${body}`).catch((err) => {
          logger.warn({ err, id }, 'failed to notify admin');
        })
      )
    );
  }
}

/**
 * Sends a new-withdrawal alert to every admin, with a single "📋 جلب الاحالات" button.
 * Pressing it (handled in bot/adminWithdrawalActions.ts) reveals the invitee list plus
 * Accept/Reject buttons — admins are never shown Accept/Reject before they've had a chance
 * to check the referrals for fraud.
 */
function buildWithdrawalAdminText(params: { withdrawalId: string; prizeName: string; username?: string; telegramId: number; requestedAt: Date }) {
  return (
    `🎁 طلب سحب جديد\n\n` +
    `رقم الطلب:\n#${params.withdrawalId}\n\n` +
    `المنتج:\n${params.prizeName}\n\n` +
    `الشخص:\n${params.username ? '@' + params.username : '-'}\n\n` +
    `أيدي الشخص:\n${params.telegramId}\n\n` +
    `وقت السحب:\n${params.requestedAt.toLocaleString('ar-EG')}`
  );
}

export async function notifyAdminsNewWithdrawal(params: {
  withdrawalId: string;
  prizeName: string;
  username?: string;
  telegramId: number;
}) {
  const { withdrawalId } = params;
  const adminIds = await listAllAdminTelegramIds();
  if (!botRef) return;

  const text = buildWithdrawalAdminText({ ...params, requestedAt: new Date() });

  const sent = await Promise.all(
    adminIds.map((id) =>
      botRef!
        .sendMessage(id, text, {
          reply_markup: {
            inline_keyboard: [[{ text: '📋 جلب الاحالات', callback_data: `wd_refs_${withdrawalId}` }]],
          },
        })
        .then((m) => ({ chatId: id, messageId: m.message_id }))
        .catch((err) => {
          logger.warn({ err, id }, 'failed to notify admin of new withdrawal');
          return null;
        })
    )
  );
  const adminMessages = sent.filter((m): m is { chatId: number; messageId: number } => m !== null);
  await WithdrawalRequest.updateOne({ _id: withdrawalId }, { $set: { adminMessages } }).catch((err) =>
    logger.warn({ err, withdrawalId }, 'failed to store admin withdrawal messages')
  );
}

/**
 * Once a request is decided, every admin's copy of the alert is edited to say who decided
 * it (and why, for a rejection) and loses its buttons, so nobody reviews it again.
 */
export async function markWithdrawalDecidedForAdmins(
  withdrawal: IWithdrawalRequest,
  decision: { approved: boolean; byUsername?: string | null; byTelegramId: number; reason?: string }
) {
  if (!botRef || !withdrawal.adminMessages?.length) return;
  const by = decision.byUsername ? '@' + decision.byUsername : String(decision.byTelegramId);
  const status = decision.approved
    ? `✅ تم قبول الطلب بواسطة ${by}`
    : `❌ تم رفض الطلب بواسطة ${by}\nالسبب: ${decision.reason ?? '-'}`;
  const text =
    buildWithdrawalAdminText({
      withdrawalId: String(withdrawal._id),
      prizeName: withdrawal.prizeNameSnapshot,
      username: withdrawal.username,
      telegramId: withdrawal.telegramId,
      requestedAt: withdrawal.requestedAt,
    }) + `\n\n━━━━━━━━━━\n${status}`;

  await Promise.all(
    withdrawal.adminMessages.map((m) =>
      botRef!
        .editMessageText(text, { chat_id: m.chatId, message_id: m.messageId, reply_markup: { inline_keyboard: [] } })
        .catch((err) => logger.warn({ err, chatId: m.chatId }, 'failed to update admin withdrawal message'))
    )
  );
}

/** Sends the actionable delivery ticket to the logged-in delivery account itself. */
export async function notifyDeliveryAccountNewWithdrawal(params: {
  withdrawalId: string;
  prizeName: string;
  username?: string;
  telegramId: number;
}) {
  if (!botRef) return;
  const account = await DeliveryAccount.findOne({ singleton: 'main', isActive: true }).select('telegramId');
  if (!account) return;
  const { withdrawalId, prizeName, username, telegramId } = params;
  await botRef.sendMessage(
    account.telegramId,
    `📦 طلب تسليم جديد\n\n` +
      `رقم الطلب: #${withdrawalId}\n` +
      `الجائزة: ${prizeName}\n` +
      `الرابح: ${username ? '@' + username : '-'}\n` +
      `أيدي الرابح: ${telegramId}\n\n` +
      `بعد إكمال التسليم أرسل من حساب التسليم:\n.تم #${withdrawalId}`,
  ).catch((err) => logger.warn({ err, withdrawalId }, 'failed to notify delivery account'));
}

function fmtPerson(p: { telegramId: number; username?: string | null; firstName?: string | null }): string {
  const name = p.username ? '@' + p.username : p.firstName || 'بدون اسم';
  return `${name}\nID: ${p.telegramId}`;
}

/** New person opened the bot for the very first time (bot start or Mini App). */
export async function notifyAdminsNewUser(user: {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
}) {
  await notifyAllAdmins(
    'system_announcement',
    '🆕 مستخدم جديد',
    `انضم للبوت مستخدم جديد:\n\n${fmtPerson(user)}`
  );
}

/** Person blocked (or unblocked) the bot's private chat — detected via my_chat_member. */
export async function notifyAdminsBlockStatus(
  user: { telegramId: number; username?: string | null; firstName?: string | null },
  blocked: boolean
) {
  await notifyAllAdmins(
    'system_announcement',
    blocked ? '🚫 حظر البوت' : '✅ إلغاء حظر البوت',
    `${blocked ? 'قام بحظر البوت' : 'ألغى حظر البوت'}:\n\n${fmtPerson(user)}`
  );
}

/** Someone new joined through a referral link (before qualification, i.e. as soon as it's registered). */
export async function notifyAdminsNewReferral(params: {
  invitee: { telegramId: number; username?: string | null; firstName?: string | null };
  referrer: { telegramId: number; username?: string | null; firstName?: string | null };
  prizeName: string;
}) {
  const { invitee, referrer, prizeName } = params;
  await notifyAllAdmins(
    'system_announcement',
    '👥 إحالة جديدة',
    `دخل شخص عن طريق رابط إحالة:\n\n${fmtPerson(invitee)}\n\n` +
      `عن طريق:\n${fmtPerson(referrer)}\n\n` +
      `الجائزة المستهدفة:\n${prizeName}`
  );
}

export async function listUserNotifications(telegramId: number, limit = 50) {
  return Notification.find({ telegramId }).sort({ createdAt: -1 }).limit(limit);
}

export async function markNotificationsRead(telegramId: number, ids?: string[]) {
  const filter: Record<string, unknown> = { telegramId };
  if (ids && ids.length > 0) filter._id = { $in: ids };
  await Notification.updateMany(filter, { isRead: true });
}
