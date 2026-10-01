import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../config/logger';
import { getAdminRole } from '../services/admin.service';
import { banListingOwner, removeListing, reportButtons, resolveReport, setListingPinned } from '../services/exchange.service';
import { ExchangeReport } from '../models/ExchangeReport';

/** Buttons under an exchange report alert: remove post, pin, ban owner, mark handled. */
export function registerExchangeActions(bot: TelegramBot) {
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || !data.startsWith('exr_')) return;

    const role = await getAdminRole(query.from.id);
    if (!role) {
      await bot.answerCallbackQuery(query.id, { text: '🚫 هذا الزر للمطورين فقط.', show_alert: true });
      return;
    }
    const actor = { telegramId: query.from.id, username: query.from.username ?? null };
    const by = actor.username ? '@' + actor.username : String(actor.telegramId);
    const [, action, id] = data.split('_');

    try {
      let note: string;
      if (action === 'rm') {
        await removeListing(id, { ...actor, isAdmin: true }, 'بلاغ من المستخدمين');
        await ExchangeReport.updateMany({ listing: id, status: 'open' }, { $set: { status: 'resolved', resolvedByTelegramId: actor.telegramId } });
        note = `🗑️ تم حذف المنشور بواسطة ${by}`;
      } else if (action === 'pin') {
        await setListingPinned(id, true, actor);
        note = `📌 تم تثبيت المنشور بواسطة ${by}`;
      } else if (action === 'ban') {
        const r = await banListingOwner(id, actor);
        await ExchangeReport.updateMany({ listing: id, status: 'open' }, { $set: { status: 'resolved', resolvedByTelegramId: actor.telegramId } });
        note = `🚫 تم حظر صاحب المنشور (${r.username ? '@' + r.username : r.telegramId}) وحذف ${r.removed} منشور بواسطة ${by}`;
      } else if (action === 'ok') {
        await resolveReport(id, actor);
        note = `✅ تمت معالجة البلاغ بواسطة ${by}`;
      } else {
        return;
      }
      await bot.answerCallbackQuery(query.id, { text: note });
      const msg = query.message;
      if (msg?.text) {
        // Keep the buttons that still make sense; a removed post or handled report loses them.
        const done = action !== 'pin';
        const listingId = action === 'ok' ? null : id;
        await bot
          .editMessageText(`${msg.text}\n\n━━━━━━━━━━\n${note}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: done || !listingId ? [] : (msg.reply_markup?.inline_keyboard ?? reportButtons(listingId, '')) },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ err, data }, 'exchange admin action failed');
      await bot
        .answerCallbackQuery(query.id, { text: `⚠️ ${err instanceof Error ? err.message : 'تعذر تنفيذ العملية'}`, show_alert: true })
        .catch(() => undefined);
    }
  });
}
