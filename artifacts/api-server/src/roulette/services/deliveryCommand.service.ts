import { Referral } from '../models/Referral';
import { UserPrize } from '../models/UserPrize';
import { WithdrawalRequest } from '../models/WithdrawalRequest';
import { ClaimTask } from '../models/ClaimTask';
import { findUserByLookup } from './user.service';
import { findWithdrawalByIdentifier, markWithdrawalDelivered } from './withdrawal.service';

function formatDate(value?: Date | null) {
  return value ? new Date(value).toLocaleString('ar-IQ') : '-';
}

function parseCommand(text: string) {
  const match = text.trim().match(/^([/.])(فحص|تم|كشف|الاوامر)(?:@\w+)?(?:\s+(.+))?$/u);
  return match ? { command: match[2], argument: match[3]?.trim() || '' } : null;
}

function displayUser(user: { username?: string | null; firstName?: string | null; telegramId: number }) {
  return user.username ? `@${user.username}` : user.firstName || `ID ${user.telegramId}`;
}

async function inspectWithdrawal(identifier: string) {
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
  return (
    `🔎 معلومات طلب السحب\n\n` +
    `رقم الطلب: #${withdrawal._id}\n` +
    `الجائزة المسحوبة: ${withdrawal.prizeNameSnapshot}\n` +
    `الرابح: ${user ? displayUser(user) : withdrawal.username ? '@' + withdrawal.username : '-'}\n` +
    `أيدي الرابح: ${withdrawal.telegramId}\n` +
    `وقت السحب: ${formatDate(withdrawal.requestedAt)}\n` +
    `حالة السحب: ${status}\n` +
    (withdrawal.decidedAt ? `وقت القرار: ${formatDate(withdrawal.decidedAt)}\n` : '') +
    (withdrawal.deliveredAt ? `وقت التسليم: ${formatDate(withdrawal.deliveredAt)}\n` : '') +
    (withdrawal.rejectReason ? `سبب الرفض: ${withdrawal.rejectReason}\n` : '')
  );
}

async function inspectUser(lookup: string) {
  const user = await findUserByLookup(lookup);
  if (!user) return 'لم يتم العثور على هذا المستخدم. لازم يكون فاتح البوت سابقاً.';
  const [pendingReferrals, qualifiedReferrals, gifts, inventory, withdrawals, claimTasks] = await Promise.all([
    Referral.countDocuments({ referrer: user._id, status: 'pending' }),
    Referral.countDocuments({ referrer: user._id, status: 'qualified' }),
    UserPrize.countDocuments({ user: user._id }),
    UserPrize.countDocuments({ user: user._id, status: { $in: ['active', 'claim_requested', 'approved'] } }),
    WithdrawalRequest.countDocuments({ telegramId: user.telegramId }),
    ClaimTask.countDocuments({ user: user._id }),
  ]);
  return (
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

const COMMANDS_HELP =
  `🛠 أوامر الإدارة\n\n` +
  `• .فحص #رقم_الطلب أو /فحص #رقم_الطلب\nعرض الجائزة والرابح ووقت الطلب وحالة التسليم.\n\n` +
  `• .تم #رقم_الطلب أو /تم #رقم_الطلب\nتسجيل الطلب كمُسلّم بعد إرسال الجائزة.\n\n` +
  `• .كشف أو .كشف @username أو .كشف telegram_id\nداخل محادثة الشخص اكتب .كشف بدون أيدي، أو استخدم أيدي/يوزر.\n\n` +
  `• .الاوامر أو /الاوامر\nعرض هذه القائمة.\n\n` +
  `رقم الطلب يظهر في رسالة طلب السحب بعد علامة #.`;

/**
 * Handles commands typed by the logged-in delivery account (GramJS user session).
 * It deliberately listens only to outgoing command-shaped messages, never to normal
 * incoming messages, so the delivery account does not auto-reply or create spam.
 */
export async function handleDeliveryCommand(
  text: string,
  chatId: string,
  isPrivateChat: boolean,
  actingTelegramId: number,
) {
  const parsed = parseCommand(text);
  if (!parsed) return null;

  if (parsed.command === 'الاوامر') return COMMANDS_HELP;
  if (parsed.command === 'فحص') {
    if (!parsed.argument) return 'اكتب رقم الطلب، مثال:\n.فحص #65f1...';
    return inspectWithdrawal(parsed.argument);
  }
  if (parsed.command === 'تم') {
    if (!parsed.argument) return 'اكتب رقم الطلب، مثال:\n.تم #65f1...';
    const delivered = await markWithdrawalDelivered(parsed.argument, actingTelegramId, undefined);
    return `✅ تم تسجيل تسليم الطلب #${delivered._id}\nتهنّى صاحب الجائزة بـ ${delivered.prizeNameSnapshot} 🎉`;
  }
  if (parsed.command === 'كشف') {
    const lookup = parsed.argument || (isPrivateChat ? chatId : '');
    if (!lookup) return 'داخل محادثة الشخص الخاصة اكتب .كشف بدون أيدي، أو اكتب .كشف @username / telegram_id.';
    return inspectUser(lookup);
  }
  return null;
}