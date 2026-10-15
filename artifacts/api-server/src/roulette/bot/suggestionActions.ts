import TelegramBot from 'node-telegram-bot-api';
import { getAdminRole } from '../services/admin.service';
import { logger } from '../config/logger';
import { Prize } from '../models/Prize';
import { decideSuggestion, markSuggestionDecided, RewardChoice, suggestionAdminKeyboard } from '../services/suggestion.service';

/*
 * The admins' buttons under a new suggestion: accept with no reward, points, a daily spin or a
 * prize from the stock, or reject. Whoever decides first wins; everyone's copy is then updated.
 */

// An admin who tapped "another number" for points: their next message is the number.
const awaitingPoints = new Map<number, { seq: number }>();

const nameOf = (u: TelegramBot.User) => (u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.id));

function pointsKeyboard(seq: number): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [1, 2, 5].map((n) => ({ text: `💎 ${n}`, callback_data: `sg:a:${seq}:pts:${n}` })),
      [10, 25, 50].map((n) => ({ text: `💎 ${n}`, callback_data: `sg:a:${seq}:pts:${n}` })),
      [{ text: '✏️ رقم ثاني', callback_data: `sg:pc:${seq}` }],
      [{ text: '↩ رجوع', callback_data: `sg:b:${seq}` }],
    ],
  };
}

async function prizesKeyboard(seq: number): Promise<TelegramBot.InlineKeyboardMarkup> {
  const prizes = await Prize.find({ isActive: true }).select('name icon stock isUnlimited').sort({ name: 1 }).limit(24).lean();
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let k = 0; k < prizes.length; k += 2) {
    rows.push(
      prizes.slice(k, k + 2).map((p) => ({
        text: `${p.icon ?? '🎁'} ${p.name}${p.isUnlimited ? '' : ` (${p.stock})`}`.slice(0, 60),
        callback_data: `sg:a:${seq}:pz:${String(p._id)}`,
      }))
    );
  }
  if (!rows.length) rows.push([{ text: 'ماكو جوائز مفعّلة', callback_data: `sg:b:${seq}` }]);
  rows.push([{ text: '↩ رجوع', callback_data: `sg:b:${seq}` }]);
  return { inline_keyboard: rows };
}

async function decide(bot: TelegramBot, from: TelegramBot.User, seq: number, accept: boolean, reward?: RewardChoice) {
  const s = await decideSuggestion({ seq, accept, reward, adminId: from.id, adminName: nameOf(from) });
  await markSuggestionDecided(bot, s);
  return s;
}

export function registerSuggestionActions(bot: TelegramBot) {
  bot.on('callback_query', async (query) => {
    const data = query.data ?? '';
    if (!data.startsWith('sg:')) return;
    const alert = (text: string) => bot.answerCallbackQuery(query.id, { text: text.slice(0, 200), show_alert: true }).catch(() => undefined);
    const msg = query.message;
    try {
      if (!(await getAdminRole(query.from.id))) return void (await alert('هذا للمطورين فقط 🔒'));
      const m = data.match(/^sg:(a|r|p|pc|g|b):(\d+)(?::(.+))?$/);
      if (!m) return void (await bot.answerCallbackQuery(query.id).catch(() => undefined));
      const [, action, seqText, arg] = m;
      const seq = Number(seqText);
      const target = msg ? { chat_id: msg.chat.id, message_id: msg.message_id } : null;

      if (action === 'p' || action === 'g' || action === 'b') {
        await bot.answerCallbackQuery(query.id).catch(() => undefined);
        if (!target) return;
        const markup = action === 'p' ? pointsKeyboard(seq) : action === 'g' ? await prizesKeyboard(seq) : suggestionAdminKeyboard(seq);
        await bot.editMessageReplyMarkup(markup, target).catch(() => undefined);
        return;
      }
      if (action === 'pc') {
        awaitingPoints.set(query.from.id, { seq });
        await bot.answerCallbackQuery(query.id).catch(() => undefined);
        await bot.sendMessage(query.from.id, `✏️ اكتب عدد النقاط لاقتراح #${seq}:`);
        return;
      }
      if (action === 'r') {
        await decide(bot, query.from, seq, false);
        return void (await alert(`❌ انرفض الاقتراح #${seq}`));
      }
      // accept
      let reward: RewardChoice = { type: 'none' };
      if (arg === 'spin') reward = { type: 'daily_spin' };
      else if (arg?.startsWith('pts:')) reward = { type: 'points', points: Number(arg.slice(4)) };
      else if (arg?.startsWith('pz:')) reward = { type: 'prize', prizeId: arg.slice(3) };
      await decide(bot, query.from, seq, true, reward);
      await alert(`✅ انقبل الاقتراح #${seq} ووصلت رسالة لصاحبه`);
    } catch (err) {
      logger.warn({ err, data }, 'suggestion button failed');
      await alert(err instanceof Error ? `⚠️ ${err.message}` : 'صار خطأ، حاول مرة ثانية');
    }
  });

  // The number typed after "another number".
  bot.on('message', async (msg) => {
    const from = msg.from;
    if (!from || msg.chat.type !== 'private') return;
    const wait = awaitingPoints.get(from.id);
    if (!wait) return;
    const text = (msg.text ?? '').trim();
    if (/^[/.]/.test(text)) return void awaitingPoints.delete(from.id);
    const points = Number(text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(',', '.'));
    if (!Number.isFinite(points) || points <= 0) {
      await bot.sendMessage(msg.chat.id, '⚠️ اكتب رقم أكبر من صفر، مثل 3 أو 0.5').catch(() => undefined);
      return;
    }
    awaitingPoints.delete(from.id);
    try {
      if (!(await getAdminRole(from.id))) return;
      const s = await decide(bot, from, wait.seq, true, { type: 'points', points });
      await bot.sendMessage(msg.chat.id, `✅ انقبل الاقتراح #${s.seq} وانضافت ${points} نقطة لصاحبه`);
    } catch (err) {
      await bot.sendMessage(msg.chat.id, `⚠️ ${err instanceof Error ? err.message : 'صار خطأ'}`).catch(() => undefined);
    }
  });
}
