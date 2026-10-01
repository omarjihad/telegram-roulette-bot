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
import { isContestEnabled, parseContestToken, registerContestReferralIfNew } from '../services/contest.service';
import { Lang, runWithLang, t, userLang } from '../i18n';

export function buildMiniAppKeyboard(label?: string, tab?: string): TelegramBot.SendMessageOptions {
  if (!env.MINI_APP_URL) return {};
  label = label ?? t('🚀 فتح البوت', '🚀 Open the bot');
  const url = tab ? `${env.MINI_APP_URL.replace(/\/$/, '')}/?tab=${tab}` : env.MINI_APP_URL;
  return {
    reply_markup: {
      inline_keyboard: [[{ text: label, web_app: { url } }]],
    },
  };
}

function welcomeName(u: TelegramBot.User, fallback: string) {
  const name = u.username ? '@' + u.username : u.first_name || fallback;
  return u.username && u.first_name ? `${name} (${u.first_name})` : name;
}

const LANG_LABEL: Record<Lang, string> = { ar: 'العربية 🇮🇶', en: 'English 🇬🇧' };

/** /language (or /lang): pick the bot's language with two buttons. */
function registerLanguageHandler(bot: TelegramBot) {
  bot.onText(/^\/(language|lang)(@\w+)?$/, async (msg) => {
    try {
      const user = await User.findOne({ telegramId: msg.from?.id }).select('language').lean();
      const lang = userLang(user);
      await bot.sendMessage(msg.chat.id, t('🌐 اختر لغة البوت:', '🌐 Choose the bot language:', lang), {
        reply_markup: {
          inline_keyboard: [[
            { text: LANG_LABEL.ar, callback_data: 'set_lang_ar' },
            { text: LANG_LABEL.en, callback_data: 'set_lang_en' },
          ]],
        },
      });
    } catch (err) {
      logger.error({ err }, 'error handling /language');
    }
  });

  bot.on('callback_query', async (query) => {
    if (query.data !== 'set_lang_ar' && query.data !== 'set_lang_en') return;
    try {
      const lang: Lang = query.data === 'set_lang_en' ? 'en' : 'ar';
      await User.updateOne({ telegramId: query.from.id }, { $set: { language: lang } });
      const done = t('✅ تم تغيير اللغة إلى العربية', '✅ Language changed to English', lang);
      await bot.answerCallbackQuery(query.id, { text: done });
      if (query.message) {
        await bot.editMessageText(done, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          reply_markup: runWithLang(lang, () => buildMiniAppKeyboard()).reply_markup as TelegramBot.InlineKeyboardMarkup | undefined,
        });
      }
    } catch (err) {
      logger.error({ err }, 'error handling language choice');
    }
  });
}

export function registerStartHandler(bot: TelegramBot) {
  registerLanguageHandler(bot);

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

      // Everything below (including errors thrown by services) uses the user's language.
      await runWithLang(userLang(user), async () => {
      if (user.isBanned) {
        await bot.sendMessage(msg.chat.id, t('🚫 أنت محظور من استخدام هذا البوت.', '🚫 You are banned from using this bot.'));
        return;
      }

      const settings = await getSettings();
      const role = await getAdminRole(user.telegramId);
      const startParam = match?.[1]?.trim();
      const demoAccess = await grantDemoAccess(user, parseDemoToken(startParam));
      if (settings.maintenanceMode && !role && !demoAccess && !hasDemoAccess(user)) {
        await bot.sendMessage(msg.chat.id, t('🔧 البوت في وضع الصيانة حالياً. حاول لاحقاً.', '🔧 The bot is under maintenance. Please try again later.'));
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
        buttons.push([{ text: t('✅ تحقق من الاشتراك', '✅ Check my subscriptions'), callback_data: 'check_forced_sub' }]);

        await bot.sendMessage(
          msg.chat.id,
          t('قبل ما تكدر تستخدم البوت، لازم تشترك بالقنوات/الكروبات التالية:', 'Before using the bot, please join the following channels/groups:'),
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
            : `${gift.message}\n\n${t('اضغط الزر حتى تفتح البوت وتشوف الهدية بحسابك 🎁', 'Tap the button to open the bot and see the gift in your account 🎁')}`;
          await bot.sendMessage(msg.chat.id, text, buildMiniAppKeyboard('isSpin' in gift && gift.isSpin ? t('🎡 أدر العجلة الآن', '🎡 Spin the wheel now') : undefined));
        } catch (err) {
          await bot.sendMessage(msg.chat.id, err instanceof Error ? `⚠️ ${err.message}` : t('⚠️ رابط الهدية غير صالح.', '⚠️ This gift link is not valid.'));
        }
        return;
      }

      // Exchange post links (sent to developers in report alerts) open straight on the post.
      const listingMatch = startParam?.match(/^listing_([a-f0-9]{24})$/);
      if (listingMatch) {
        await bot.sendMessage(
          msg.chat.id,
          t('🔄 قسم التبادل\n\n👇 اضغط الزر لفتح المنشور', '🔄 Exchange\n\n👇 Tap the button to open the post'),
          buildMiniAppKeyboard(t('🔄 فتح المنشور', '🔄 Open the post'), `exchange&listing=${listingMatch[1]}`)
        );
        return;
      }

      // The race section link (?start=race) and race invite links open straight on the race tab.
      if ((startParam === 'race' || contestToken) && (await isContestEnabled())) {
        await bot.sendMessage(
          msg.chat.id,
          t('🏆 سباق الدعوات\n\nادعُ أصدقاءك، تصدّر القائمة، واربح هدية Santa Hat NFT 🎁\n\n👇 اضغط الزر وادخل السباق', '🏆 Invite race\n\nInvite friends, top the leaderboard and win a Santa Hat NFT gift 🎁\n\n👇 Tap the button to join the race'),
          buildMiniAppKeyboard(t('🏆 ادخل السباق', '🏆 Join the race'), 'race')
        );
        return;
      }

      await bot.sendMessage(
        msg.chat.id,
        t(
          `أهلا بك ${welcomeName(telegramUser, 'صديقنا')} في بوت روليت MF\n\nافتح البوت واربح الجوائز 👇\n\n🌐 English: /language`,
          `Welcome ${welcomeName(telegramUser, 'friend')} to the MF Roulette bot\n\nOpen the bot and win prizes 👇\n\n🌐 العربية: /language`
        ),
        buildMiniAppKeyboard()
      );
      });
    } catch (err) {
      logger.error({ err }, 'error handling /start');
    }
  });

  bot.on('callback_query', async (query) => {
    if (query.data !== 'check_forced_sub') return;
    try {
      const telegramId = query.from.id;
      const lang = userLang(await User.findOne({ telegramId }).select('language').lean());
      const { allOk, missing } = await checkAllForcedChats(bot, telegramId);

      if (allOk) {
        await User.updateOne({ telegramId }, { forcedSubOk: true });
        await bot.answerCallbackQuery(query.id, { text: t('✅ تم التحقق! تقدر تفتح البوت الحين.', '✅ Verified! You can open the bot now.', lang) });
        if (query.message) {
          await bot.sendMessage(query.message.chat.id, t('تم التحقق من اشتراكك ✅', 'Your subscriptions are verified ✅', lang), runWithLang(lang, () => buildMiniAppKeyboard()));
        }
      } else {
        await bot.answerCallbackQuery(query.id, {
          text: t('❌ لسا ناقصك اشتراك ببعض القنوات.', '❌ You still need to join some channels.', lang),
          show_alert: true,
        });
      }
    } catch (err) {
      logger.error({ err }, 'error handling check_forced_sub callback');
    }
  });
}
