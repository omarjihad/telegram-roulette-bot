import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../config/logger';
import { getAdminRole } from '../services/admin.service';
import { banListingOwner, banOfferSender, decideOffer, mediationButton, removeListing, renewListing, reportOffer, reportButtons, resolveReport, setListingPinned } from '../services/exchange.service';
import { User } from '../models/User';
import { pick, runWithLang, userLang } from '../i18n';
import { ExchangeReport } from '../models/ExchangeReport';

/** Buttons under an exchange report alert: remove post, pin, ban owner, mark handled. */
export function registerExchangeActions(bot: TelegramBot) {
  registerOfferActions(bot);
  registerRenewAction(bot);

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
      } else if (action === 'bano') {
        const r = await banOfferSender(id, actor);
        note = `🚫 تم حظر صاحب العرض (${r.username ? '@' + r.username : r.telegramId}) بواسطة ${by}`;
      } else if (action === 'oko') {
        note = `✅ تمت معالجة البلاغ بواسطة ${by}`;
      } else {
        return;
      }
      await bot.answerCallbackQuery(query.id, { text: note });
      const msg = query.message;
      if (msg?.text) {
        // Keep the buttons that still make sense; a removed post or handled report loses them.
        const done = action !== 'pin';
        const listingId = action === 'ok' || action === 'bano' || action === 'oko' ? null : id;
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

/** Accept / decline buttons under an offer the bot delivered to a post's owner. */
function registerOfferActions(bot: TelegramBot) {
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || !data.startsWith('exo_')) return;
    const [, action, offerId] = data.split('_');
    const lang = userLang(await User.findOne({ telegramId: query.from.id }).select('language').lean());
    try {
      if (action === 'rep') {
        const reported = await reportOffer(offerId, query.from.id);
        if (!reported) {
          await bot.answerCallbackQuery(query.id, { text: pick({ ar: 'تم الرد على هذا العرض مسبقاً', en: 'This offer was already answered' }, lang) });
          return;
        }
        const note = pick({ ar: '🚩 تم إرسال البلاغ للمطورين وإلغاء العرض. شكراً لك', en: '🚩 Reported to the developers and the offer was dropped. Thank you' }, lang);
        await bot.answerCallbackQuery(query.id, { text: note });
        const msg = query.message;
        if (msg?.text) {
          await bot
            .editMessageText(`${msg.text}\n\n━━━━━━━━━━\n${note}`, { chat_id: msg.chat.id, message_id: msg.message_id, disable_web_page_preview: true, reply_markup: { inline_keyboard: [] } })
            .catch(() => undefined);
        }
        return;
      }
      const result = await decideOffer(offerId, query.from.id, action === 'acc');
      if (!result) {
        await bot.answerCallbackQuery(query.id, { text: pick({ ar: 'تم الرد على هذا العرض مسبقاً', en: 'This offer was already answered' }, lang) });
        return;
      }
      const { offer, buyer, group } = result;
      const who = buyer?.username ? '@' + buyer.username : `tg://user?id=${offer.fromTelegramId}`;
      const accepted = action === 'acc';
      const medButton = accepted ? mediationButton(String(offer._id), pick({ ar: `🛡️ طلب وسيط ويّا ${who}`, en: `🛡️ Request a middleman with ${who}` }, lang)) : null;
      const note = accepted
        ? pick({
            ar: `✅ تم قبول العرض. تواصل ويّا صاحب العرض: ${who}\nوبعد التفاهم اطلب وسيط من الزر أدناه 👇` + (medButton ? '' : `\n🛡️ وسطاء MF: https://t.me/${group}`),
            en: `✅ Offer accepted. Contact the sender: ${who}\nOnce you agree, request a middleman with the button below 👇` + (medButton ? '' : `\n🛡️ MF middlemen: https://t.me/${group}`),
          }, lang)
        : pick({ ar: '❌ رفضت هذا العرض.', en: '❌ You declined this offer.' }, lang);
      await bot.answerCallbackQuery(query.id);
      const msg = query.message;
      if (msg?.text) {
        await bot
          .editMessageText(`${msg.text}\n\n━━━━━━━━━━\n${note}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: medButton ? [[medButton]] : [] },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ err, data }, 'exchange offer action failed');
      await bot.answerCallbackQuery(query.id, { text: '⚠️', show_alert: false }).catch(() => undefined);
    }
  });
}

/** "Renew for 4 days" under the expiry reminder. */
function registerRenewAction(bot: TelegramBot) {
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || !data.startsWith('exn_renew_')) return;
    const lang = userLang(await User.findOne({ telegramId: query.from.id }).select('language').lean());
    try {
      await runWithLang(lang, () => renewListing(query.from.id, data.slice('exn_renew_'.length)));
      const note = pick({ ar: '✅ تم التجديد، منشورك يبقى معروض 4 أيام ثانية', en: '✅ Renewed: your post stays up for another 4 days' }, lang);
      await bot.answerCallbackQuery(query.id, { text: note });
      const msg = query.message;
      if (msg?.text) {
        await bot
          .editMessageText(`${msg.text}\n\n━━━━━━━━━━\n${note}`, { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } })
          .catch(() => undefined);
      }
    } catch (err) {
      await bot
        .answerCallbackQuery(query.id, { text: `⚠️ ${err instanceof Error ? err.message : ''}`, show_alert: true })
        .catch(() => undefined);
    }
  });
}
