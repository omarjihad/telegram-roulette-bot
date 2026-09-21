import TelegramBot from 'node-telegram-bot-api';
import { User } from '../models/User';
import { Referral } from '../models/Referral';
import { UserPrize } from '../models/UserPrize';
import { WithdrawalRequest } from '../models/WithdrawalRequest';
import { ClaimTask } from '../models/ClaimTask';
import { getAdminRole } from '../services/admin.service';
import { findUserByLookup } from '../services/user.service';
import { findWithdrawalByIdentifier, markWithdrawalDelivered } from '../services/withdrawal.service';
import { isDeliveryAccountTelegramId } from '../services/deliveryAccount.service';
import { logger } from '../config/logger';

function date(value?: Date | null) {
  return value ? new Date(value).toLocaleString('ar-IQ') : '-';
}

function parseCommand(text: string) {
  const match = text.trim().match(/^([/.])(فحص|تم|كشف|الاوامر)(?:@\w+)?(?:\s+(.+))?$/u);
  return match ? { command: match[2], argument: match[3]?.trim() || '' } : null;
}

function displayUser(user: { username?: string | null; firstName?: string | null; telegramId: number }) {
  return user.username ? `@${user.username}` : user.firstName || `ID ${user.telegramId}`;
}

async function sendCommands(bot: TelegramBot, chatId: number) {
  await bot.sendMessage(
    chatId,
    `🛠 أوامر الإدارة\n\n` +
      `• .فحص #رقم_الطلب أو /فحص #رقم_الطلب\nعرض الجائزة والرابح ووقت الطلب وحالة التسليم.\n\n` +
      `• .تم #رقم_الطلب أو /تم #رقم_الطلب\nتسجيل الطلب كمُسلّم بعد إرسال الجائزة.\n\n` +
      `• .كشف @username أو .كشف telegram_id\nعرض إحالات الشخص، الهدايا، الفرات، النقاط والمخزون.\n\n` +
      `• .الاوامر أو /الاوامر\nعرض هذه القائمة.\n\n` +
      `رقم الطلب يظهر في رسالة طلب السحب بعد علامة #.`
  );
}

async function inspectWithdrawal(bot: TelegramBot, chatId: number, identifier: string) {
  if (!identifier) {
    await bot.sendMessage(chatId, 'اكتب رقم الطلب، مثال:\n.فحص #65f1...'); 
    return;
  }
  const withdrawal = await findWithdrawalByIdentifier(identifier);
  const user = withdrawal.user as unknown as { username?: string; firstName?: string; telegramId: number } | null;
  const status =
    withdrawal.status === 'delivered'
      ? '✅ تم التسليم'
      : withdrawal.status === 'approved'
      ? '🟢 تمت الموافقة ولم يُسجّل التسليم بعد'
      : withdrawal.status === 'rejected'
      ? '❌ مرفوض'
      : '⏳ قيد المراجعة';
  await bot.sendMessage(
    chatId,
    `🔎 معلومات طلب السحب\n\n` +
      `رقم الطلب: #${withdrawal._id}\n` +
      `الجائزة المسحوبة: ${withdrawal.prizeNameSnapshot}\n` +
      `الرابح: ${user ? displayUser(user) : withdrawal.username ? '@' + withdrawal.username : '-'}\n` +
      `أيدي الرابح: ${withdrawal.telegramId}\n` +
      `وقت السحب: ${date(withdrawal.requestedAt)}\n` +
      `حالة السحب: ${status}\n` +
      (withdrawal.decidedAt ? `وقت القرار: ${date(withdrawal.decidedAt)}\n` : '') +
      (withdrawal.deliveredAt ? `وقت التسليم: ${date(withdrawal.deliveredAt)}\n` : '') +
      (withdrawal.rejectReason ? `سبب الرفض: ${withdrawal.rejectReason}\n` : '')
  );
}

async function inspectUser(bot: TelegramBot, chatId: number, lookup: string) {
  if (!lookup) {
    await bot.sendMessage(chatId, 'اكتب يوزر أو أيدي، مثال:\n.كشف @username\n.كشف 123456789');
    return;
  }
  const user = await findUserByLookup(lookup);
  if (!user) {
    await bot.sendMessage(chatId, 'لم يتم العثور على هذا المستخدم. لازم يكون فاتح البوت سابقاً.');
    return;
  }
  const [pendingReferrals, qualifiedReferrals, gifts, inventory, withdrawals, claimTasks] = await Promise.all([
    Referral.countDocuments({ referrer: user._id, status: 'pending' }),
    Referral.countDocuments({ referrer: user._id, status: 'qualified' }),
    UserPrize.countDocuments({ user: user._id }),
    UserPrize.countDocuments({ user: user._id, status: { $in: ['active', 'claim_requested', 'approved'] } }),
    WithdrawalRequest.countDocuments({ telegramId: user.telegramId }),
    ClaimTask.countDocuments({ user: user._id }),
  ]);
  await bot.sendMessage(
    chatId,
    `👤 كشف المستخدم\n\n` +
      `المستخدم: ${displayUser(user)}\n` +
      `الأيدي: ${user.telegramId}\n` +
      `الإحالات المؤهلة: ${qualifiedReferrals}\n` +
      `الإحالات المعلقة: ${pendingReferrals}\n` +
      `الهدايا/الجوائز المستلمة: ${gifts}\n` +
      `المخزون الحالي: ${inventory}\n` +
      `طلبات السحب: ${withdrawals}\n` +
      `مهام الجوائز: ${claimTasks}\n` +
      `الفرات المجانية: ${user.spinCredits ?? 0}\n` +
      `الفرات الإضافية: ${user.bonusDailySpins ?? 0}\n` +
      `نقاط عجلة النقاط: ${user.spinPoints ?? 0}\n` +
      `النقاط المصروفة: ${user.spinPointsSpent ?? 0}\n` +
      `مجموع الفرات: ${user.totalSpins ?? 0}\n` +
      `ستريك الدخول اليومي: ${user.dailyStreakDay ?? 0}`
  );
}

export function registerAdminCommands(bot: TelegramBot) {
  bot.on('message', async (msg) => {
    if (!msg.text || msg.from?.is_bot) return;
    const parsed = parseCommand(msg.text);
    if (!parsed) return;

    const telegramId = msg.from?.id;
    if (!telegramId) return;
    const role = await getAdminRole(telegramId);
    const canMarkDelivered = Boolean(role) || (await isDeliveryAccountTelegramId(telegramId));
    if (!role && parsed.command !== 'تم') {
      await bot.sendMessage(msg.chat.id, '🚫 هذا الأمر للمطورين فقط.');
      return;
    }
    if (!canMarkDelivered) {
      await bot.sendMessage(msg.chat.id, '🚫 هذا الأمر للمطورين أو حساب التسليم فقط.');
      return;
    }

    try {
      if (parsed.command === 'الاوامر') {
        await sendCommands(bot, msg.chat.id);
        return;
      }
      if (parsed.command === 'فحص') {
        await inspectWithdrawal(bot, msg.chat.id, parsed.argument);
        return;
      }
      if (parsed.command === 'كشف') {
        await inspectUser(bot, msg.chat.id, parsed.argument || (msg.chat.type === 'private' ? String(msg.chat.id) : ''));
        return;
      }
      if (parsed.command === 'تم') {
        if (!parsed.argument) {
          await bot.sendMessage(msg.chat.id, 'اكتب رقم الطلب، مثال:\n.تم #65f1...');
          return;
        }
        const delivered = await markWithdrawalDelivered(parsed.argument, telegramId, msg.from?.username);
        await bot.sendMessage(msg.chat.id, `✅ تم تسجيل تسليم الطلب #${delivered._id}\nتهنّى صاحب الجائزة بـ ${delivered.prizeNameSnapshot} 🎉`);
      }
    } catch (err) {
      logger.error({ err, command: parsed.command }, 'admin command failed');
      const message = err instanceof Error ? err.message : 'صار خطأ، حاول مرة ثانية.';
      await bot.sendMessage(msg.chat.id, `⚠️ ${message}`);
    }
  });
}