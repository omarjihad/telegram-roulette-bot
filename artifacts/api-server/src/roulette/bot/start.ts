import TelegramBot from 'node-telegram-bot-api';
import { User } from '../models/User';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { findOrCreateUser } from '../services/user.service';
import { parseGeneralReferralToken, registerGeneralReferralIfNew, registerReferralIfNew } from '../services/referral.service';
import { getClaimTaskByToken, parseTaskTokenFromStartParam } from '../services/claimTask.service';
import { checkAllForcedChats } from '../services/forcedSub.service';
import { getSettings } from '../models/Settings';
import { getAdminRole } from '../services/admin.service';
import { grantDemoAccess, parseDemoToken, hasDemoAccess } from '../services/demo.service';
import { parseGiftToken, redeemGiftLink } from '../services/giftLink.service';
import { parseContestToken, registerContestReferralIfNew } from '../services/contest.service';

export function buildMiniAppKeyboard(label = '🚀 فتح البوت', tab?: string): TelegramBot.SendMessageOptions {
  if (!env.MINI_APP_URL) return {};
  const url = tab ? `${env.MINI_APP_URL.replace(/\/$/, '')}/?tab=${tab}` : env.MINI_APP_URL;
  return {
    reply_markup: {
      inline_keyboard: [[{ text: label, web_app: { url } }]],
    },
  };
}

export function registerStartHandler(bot: TelegramBot) {
  bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
    try {
      const telegramUser = msg.from;
      if (!telegramUser) return;

      const { user, isNew } = await findOrCreateUser({
        id: telegramUser.id,
        username: telegramUser.username,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name,
        language_code: telegramUser.language_code,
      });

      if (user.isBanned) {
        await bot.sendMessage(msg.chat.id, '🚫 أنت محظور من استخدام هذا البوت.');
        return;
      }

      const settings = await getSettings();
      const role = await getAdminRole(user.telegramId);
      const startParam = match?.[1]?.trim();
      const demoAccess = await grantDemoAccess(user, parseDemoToken(startParam));
      if (settings.maintenanceMode && !role && !demoAccess && !hasDemoAccess(user)) {
        await bot.sendMessage(msg.chat.id, '🔧 البوت في وضع الصيانة حالياً. حاول لاحقاً.');
        return;
      }

      const taskToken = parseTaskTokenFromStartParam(startParam);
      const generalReferralToken = parseGeneralReferralToken(startParam);
      if (generalReferralToken) {
        const outcome = await registerGeneralReferralIfNew({ newUser: user, referralToken: generalReferralToken, isBrandNewUser: isNew });
        logger.info({ outcome, generalReferralToken, newUserId: user.telegramId }, 'general referral registration attempt');
      }

      const contestToken = parseContestToken(startParam);
      if (contestToken) {
        const outcome = await registerContestReferralIfNew({ newUser: user, token: contestToken, isBrandNewUser: isNew });
        logger.info({ outcome, contestToken, newUserId: user.telegramId }, 'invite race registration attempt');
      }

      if (taskToken) {
        const task = await getClaimTaskByToken(taskToken);
        if (task) {
          const outcome = await registerReferralIfNew({
            newUser: user,
            task,
            // The user record is created before this handler continues. Only the
            // first-ever /start may create a referral; an existing user opening a
            // task/gift link must never become a new invitee.
            isBrandNewUser: isNew,
            demoMode: settings.demoModeEnabled,
          });
          logger.info({ outcome, taskToken, newUserId: user.telegramId }, 'referral registration attempt');
        } else {
          logger.warn({ taskToken }, 'start param referenced an unknown claim task token');
        }
      }

      const { allOk, missing } = await checkAllForcedChats(bot, user.telegramId);

      if (!allOk) {
        const buttons: TelegramBot.InlineKeyboardButton[][] = missing.map((c) => [
          { text: `📢 ${c.title}`, url: c.inviteLink || `https://t.me/${c.chatId.replace('@', '')}` },
        ]);
        buttons.push([{ text: '✅ تحقق من الاشتراك', callback_data: 'check_forced_sub' }]);

        await bot.sendMessage(
          msg.chat.id,
          'قبل ما تكدر تستخدم البوت، لازم تشترك بالقنوات/الكروبات التالية:',
          { reply_markup: { inline_keyboard: buttons } }
        );
        return;
      }

      user.forcedSubOk = true;
      await user.save();

      const giftToken = parseGiftToken(startParam);
      if (giftToken) {
        try {
          const gift = await redeemGiftLink(giftToken, user.telegramId);
          const text = 'isSpin' in gift && gift.isSpin
            ? gift.message
            : `${gift.message}\n\nاضغط الزر حتى تفتح البوت وتشوف الهدية بحسابك 🎁`;
          await bot.sendMessage(msg.chat.id, text, buildMiniAppKeyboard('isSpin' in gift && gift.isSpin ? '🎡 أدر العجلة الآن' : undefined));
        } catch (err) {
          await bot.sendMessage(msg.chat.id, err instanceof Error ? `⚠️ ${err.message}` : '⚠️ رابط الهدية غير صالح.');
        }
        return;
      }

      // The race section link (?start=race) and race invite links open straight on the race tab.
      if (startParam === 'race' || contestToken) {
        await bot.sendMessage(
          msg.chat.id,
          '🏆 سباق الدعوات\n\nادعُ أصدقاءك، تصدّر القائمة، واربح هدية Santa Hat NFT 🎁\n\n👇 اضغط الزر وادخل السباق',
          buildMiniAppKeyboard('🏆 ادخل السباق', 'race')
        );
        return;
      }

      await bot.sendMessage(
        msg.chat.id,
        `أهلا بك ${telegramUser.username ? '@' + telegramUser.username : telegramUser.first_name || 'صديقنا'}${telegramUser.username && telegramUser.first_name ? ` (${telegramUser.first_name})` : ''} في بوت روليت MF\n\nافتح البوت واربح الجوائز 👇`,
        buildMiniAppKeyboard()
      );
    } catch (err) {
      logger.error({ err }, 'error handling /start');
    }
  });

  bot.on('callback_query', async (query) => {
    if (query.data !== 'check_forced_sub') return;
    try {
      const telegramId = query.from.id;
      const { allOk, missing } = await checkAllForcedChats(bot, telegramId);

      if (allOk) {
        await User.updateOne({ telegramId }, { forcedSubOk: true });
        await bot.answerCallbackQuery(query.id, { text: '✅ تم التحقق! تقدر تفتح البوت الحين.' });
        if (query.message) {
          await bot.sendMessage(query.message.chat.id, 'تم التحقق من اشتراكك ✅', buildMiniAppKeyboard());
        }
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ لسا ناقصك اشتراك ببعض القنوات.',
          show_alert: true,
        });
      }
    } catch (err) {
      logger.error({ err }, 'error handling check_forced_sub callback');
    }
  });
}
