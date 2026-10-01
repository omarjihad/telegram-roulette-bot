import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../config/logger';
import { getAdminRole } from '../services/admin.service';
import { completeByMediatorMessage, handleJoinRequest, linkMediationGroup, takeTicket } from '../services/mediation.service';

/** Mediation group: join requests from ticket sides, the "take ticket" button, setup and "م". */
export function registerMediationActions(bot: TelegramBot) {
  bot.on('chat_join_request', async (req) => {
    try {
      await handleJoinRequest(req);
    } catch (err) {
      logger.warn({ err }, 'mediation join request failed');
    }
  });

  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || !data.startsWith('med_take_')) return;
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    try {
      const result = await takeTicket(data.slice('med_take_'.length), query.from, chatId);
      if ('error' in result) {
        await bot.answerCallbackQuery(query.id, { text: result.error, show_alert: true });
        return;
      }
      const by = query.from.username ? '@' + query.from.username : query.from.first_name;
      await bot.answerCallbackQuery(query.id, { text: `✅ استلمت التذكرة #${result.ticket.number}` });
      const msg = query.message;
      if (msg?.text) {
        await bot
          .editMessageText(`${msg.text}\n\n━━━━━━━━━━\n✅ استلمها الوسيط ${by}`, {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: [] },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ err }, 'take mediation ticket failed');
      await bot.answerCallbackQuery(query.id, { text: '⚠️ تعذر استلام التذكرة', show_alert: true }).catch(() => undefined);
    }
  });

  bot.on('message', async (msg) => {
    const text = msg.text?.trim();
    if (!text || !msg.from || msg.chat.type === 'private') return;
    try {
      if (/^\/setmediation(@\w+)?$/.test(text)) {
        if (!(await getAdminRole(msg.from.id))) return;
        await linkMediationGroup(msg.chat.id);
        const me = await bot.getMe();
        const member = await bot.getChatMember(msg.chat.id, me.id).catch(() => null);
        const canInvite = member?.status === 'administrator' && (member as { can_invite_users?: boolean }).can_invite_users !== false;
        await bot.sendMessage(
          msg.chat.id,
          `✅ تم ربط هذا الكروب ككروب الوساطة.\n\n` +
            (canInvite
              ? '👍 البوت مشرف ويگدر يقبل طلبات الانضمام.'
              : '⚠️ لازم ترفع البوت مشرف وتنطيه صلاحية «إضافة أعضاء / دعوة مستخدمين» حتى يگدر يقبل الطلبات.') +
            `\n\nلا تنسى تحط رابط الكروب (رابط طلب الانضمام) من لوحة المطور ← 🔄 التبادل.`
        );
        return;
      }
      await completeByMediatorMessage(msg.chat.id, msg.from.id, text);
    } catch (err) {
      logger.warn({ err }, 'mediation group message failed');
    }
  });
}
