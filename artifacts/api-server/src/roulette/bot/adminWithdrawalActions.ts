import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../config/logger';
import { getAdminRole } from '../services/admin.service';
import {
  listReferralsForWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
} from '../services/withdrawal.service';

// Tracks admins who were just asked "why are you rejecting this?" so the next plain-text
// message they send in that chat gets picked up as the rejection reason instead of being
// treated as an unrelated message. Keyed by adminChatId.
const pendingRejections = new Map<number, { withdrawalId: string; promptMessageId: number }>();

function fmtDate(d?: Date | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('ar-EG');
}

function statusLabel(status: string): string {
  if (status === 'qualified') return '✅ مؤهلة';
  if (status === 'rejected') return '❌ مرفوضة';
  return '⏳ قيد الانتظار';
}

export function registerAdminWithdrawalActions(bot: TelegramBot) {
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data) return;
    if (!data.startsWith('wd_refs_') && !data.startsWith('wd_approve_') && !data.startsWith('wd_reject_')) return;

    const adminTelegramId = query.from.id;
    const role = await getAdminRole(adminTelegramId);
    if (!role) {
      await bot.answerCallbackQuery(query.id, { text: '🚫 هذا الزر للمطورين فقط.', show_alert: true });
      return;
    }

    const chatId = query.message?.chat.id;

    try {
      if (data.startsWith('wd_refs_')) {
        const withdrawalId = data.slice('wd_refs_'.length);
        await bot.answerCallbackQuery(query.id);
        if (!chatId) return;

        const { withdrawal, referrals } = await listReferralsForWithdrawal(withdrawalId);

        if (referrals.length === 0) {
          await bot.sendMessage(chatId, '⚠️ ماكو أي إحالات مسجلة لهذا الشخص إطلاقاً.');
        } else {
          const lines = referrals.map((r, i) => {
            const invitee = r.invitee as unknown as { username?: string; firstName?: string; telegramId?: number } | null;
            // Prefer @username, then their Telegram first name, and only fall back to the
            // bare numeric ID if the person has neither (no @username set, no first name on file).
            const who = invitee?.username
              ? '@' + invitee.username
              : invitee?.firstName
              ? `${invitee.firstName} (ID: ${invitee.telegramId})`
              : invitee?.telegramId
              ? `ID: ${invitee.telegramId}`
              : 'غير معروف';
            return (
              `${i + 1}. ${who}\n` +
              `   الحالة: ${statusLabel(r.status)}\n` +
              `   تاريخ الدخول: ${fmtDate(r.createdAt)}\n` +
              `   مؤهلة بتاريخ: ${fmtDate(r.qualifiedAt)}`
            );
          });
          await bot.sendMessage(chatId, `👥 إحالات هذا المستخدم (${referrals.length}):\n\n${lines.join('\n\n')}`);
        }

        // Only now — after the admin has actually seen the referral list — do the
        // accept/reject buttons appear.
        await bot.sendMessage(
          chatId,
          `المنتج:\n${withdrawal.prizeNameSnapshot}\n\nقرر:`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ قبول', callback_data: `wd_approve_${withdrawalId}` },
                  { text: '❌ رفض', callback_data: `wd_reject_${withdrawalId}` },
                ],
              ],
            },
          }
        );
        return;
      }

      if (data.startsWith('wd_approve_')) {
        const withdrawalId = data.slice('wd_approve_'.length);
        await approveWithdrawal(withdrawalId, adminTelegramId, query.from.username);
        await bot.answerCallbackQuery(query.id, { text: '✅ تم القبول' });
        if (chatId && query.message) {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: query.message.message_id }
          );
          await bot.sendMessage(chatId, `✅ تم قبول الطلب #${withdrawalId} بواسطة @${query.from.username ?? adminTelegramId}`);
        }
        return;
      }

      if (data.startsWith('wd_reject_')) {
        const withdrawalId = data.slice('wd_reject_'.length);
        if (!chatId) return;
        const prompt = await bot.sendMessage(chatId, '✍️ اكتب سبب الرفض بالرد على هذه الرسالة (أو أرسله كرسالة عادية):', {
          reply_markup: { force_reply: true },
        });
        pendingRejections.set(chatId, { withdrawalId, promptMessageId: prompt.message_id });
        await bot.answerCallbackQuery(query.id);
        return;
      }
    } catch (err) {
      logger.error({ err, data }, 'admin withdrawal callback failed');
      await bot.answerCallbackQuery(query.id, { text: '⚠️ صار خطأ، حاول مرة ثانية.', show_alert: true }).catch(() => {});
    }
  });

  // Captures the plain-text reply that follows a "wd_reject_" prompt as the rejection reason.
  bot.on('message', async (msg) => {
    if (!msg.text || msg.from?.is_bot) return;
    const chatId = msg.chat.id;
    const pending = pendingRejections.get(chatId);
    if (!pending) return;

    // If Telegram tells us this message is a reply, make sure it's a reply to our own prompt.
    if (msg.reply_to_message && msg.reply_to_message.message_id !== pending.promptMessageId) return;

    pendingRejections.delete(chatId);

    try {
      const adminTelegramId = msg.from!.id;
      const role = await getAdminRole(adminTelegramId);
      if (!role) return;

      await rejectWithdrawal(pending.withdrawalId, msg.text.trim(), adminTelegramId, msg.from?.username);
      await bot.sendMessage(chatId, `❌ تم رفض الطلب.\nالسبب: ${msg.text.trim()}`);
    } catch (err) {
      logger.error({ err }, 'failed to process withdrawal rejection reason');
      await bot.sendMessage(chatId, '⚠️ صار خطأ أثناء الرفض، حاول مرة ثانية.');
    }
  });
}
