import TelegramBot from 'node-telegram-bot-api';
import mongoose, { HydratedDocument } from 'mongoose';
import { ISuggestion, Suggestion, SuggestionReward } from '../models/Suggestion';
import { IUser, User } from '../models/User';
import { Prize } from '../models/Prize';
import { UserPrize } from '../models/UserPrize';
import { nextSequence } from '../models/Counter';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
import { t } from '../i18n';
import { listAllAdminTelegramIds } from './admin.service';
import { createNotification } from './notification.service';
import { ensureClaimTask } from './claimTask.service';

/*
 * Feature suggestions: anyone sends an idea from the Mini App; every admin gets it in the bot
 * with buttons, and whoever accepts it picks the reward (or none). The person hears back either way.
 */

export const SUGGESTION_MIN = 10;
export const SUGGESTION_MAX = 1000;
/** Ideas waiting for an answer, per person. */
export const SUGGESTION_MAX_PENDING = 3;
/** Between two ideas from the same person. */
const SUGGESTION_GAP_MS = 2 * 60 * 1000;
/** A prize for a suggestion, like a gift-link prize, disappears if its claim steps aren't done in time. */
const SUGGESTION_PRIZE_EXPIRY_MS = 24 * 60 * 60 * 1000;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const nameOf = (u: Pick<IUser, 'firstName' | 'username' | 'telegramId'>) => u.firstName || (u.username ? `@${u.username}` : String(u.telegramId));

export async function createSuggestion(user: HydratedDocument<IUser>, rawText: unknown) {
  if (user.isBanned) throw new AppError('User is banned', 403, 'BANNED');
  const text = String(rawText ?? '').trim();
  if (text.length < SUGGESTION_MIN) {
    throw new AppError(t(`اكتب اقتراحك بوضوح (${SUGGESTION_MIN} أحرف على الأقل)`, `Describe your idea (at least ${SUGGESTION_MIN} characters)`), 422, 'VALIDATION_ERROR');
  }
  if (text.length > SUGGESTION_MAX) {
    throw new AppError(t(`الاقتراح أطول من ${SUGGESTION_MAX} حرف`, `The suggestion is longer than ${SUGGESTION_MAX} characters`), 422, 'VALIDATION_ERROR');
  }
  const [pending, last] = await Promise.all([
    Suggestion.countDocuments({ telegramId: user.telegramId, status: 'pending' }),
    Suggestion.findOne({ telegramId: user.telegramId }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);
  if (pending >= SUGGESTION_MAX_PENDING) {
    throw new AppError(t('عندك اقتراحات بعدها تنتظر الرد، انتظر لحد ما نرد عليها', 'You already have suggestions waiting for an answer'), 429, 'SUGGESTION_LIMIT');
  }
  if (last && Date.now() - new Date(last.createdAt).getTime() < SUGGESTION_GAP_MS) {
    throw new AppError(t('انتظر شوية قبل ما ترسل اقتراح ثاني', 'Please wait a little before sending another suggestion'), 429, 'SUGGESTION_TOO_SOON');
  }
  const seq = await nextSequence('suggestion', 0);
  return Suggestion.create({
    seq,
    user: user._id,
    telegramId: user.telegramId,
    username: user.username ?? null,
    name: nameOf(user),
    text,
  });
}

export async function listMySuggestions(telegramId: number) {
  return Suggestion.find({ telegramId }).sort({ createdAt: -1 }).limit(20).lean();
}

export async function listSuggestions(status?: string) {
  const filter = status === 'pending' || status === 'accepted' || status === 'rejected' ? { status } : {};
  return Suggestion.find(filter).sort({ status: 1, createdAt: -1 }).limit(100).lean();
}

export async function suggestionBySeq(seq: number) {
  return Suggestion.findOne({ seq });
}

/** The reward as words, for the admins' messages and the person's notice. */
export function rewardText(r?: SuggestionReward | null, lang?: 'ar' | 'en') {
  if (!r || r.type === 'none') return t('بدون جائزة', 'No reward', lang);
  if (r.type === 'points') return t(`${r.points} نقطة 💎`, `${r.points} points 💎`, lang);
  if (r.type === 'daily_spin') return t('فرة يومية إضافية 🎡', 'An extra daily spin 🎡', lang);
  return t(`جائزة: ${r.prizeName}`, `Prize: ${r.prizeName}`, lang);
}

// ───────────── Deciding ─────────────

export type RewardChoice = { type: 'none' } | { type: 'points'; points: number } | { type: 'daily_spin' } | { type: 'prize'; prizeId: string };

export function parseRewardChoice(input: unknown): RewardChoice {
  const r = (input ?? { type: 'none' }) as { type?: string; points?: unknown; prizeId?: unknown };
  if (!r.type || r.type === 'none') return { type: 'none' };
  if (r.type === 'points') {
    const points = Number(r.points);
    if (!Number.isFinite(points) || points <= 0 || points > 10000) throw new AppError('عدد النقاط غير صالح', 422, 'VALIDATION_ERROR');
    return { type: 'points', points: Math.round(points * 1000) / 1000 };
  }
  if (r.type === 'daily_spin') return { type: 'daily_spin' };
  if (r.type === 'prize') {
    if (!mongoose.isValidObjectId(r.prizeId)) throw new AppError('اختر جائزة', 422, 'VALIDATION_ERROR');
    return { type: 'prize', prizeId: String(r.prizeId) };
  }
  throw new AppError('نوع الجائزة غير صالح', 422, 'VALIDATION_ERROR');
}

/** Gives the person what the admin picked. Throws (nothing given) when it can't. */
async function giveReward(s: ISuggestion, choice: RewardChoice): Promise<SuggestionReward> {
  if (choice.type === 'none') return { type: 'none' };
  const user = await User.findOne({ telegramId: s.telegramId });
  if (!user) throw new AppError('ما لكيت حساب صاحب الاقتراح', 404, 'USER_NOT_FOUND');
  if (choice.type === 'points') {
    await User.updateOne({ _id: user._id }, { $inc: { spinPoints: choice.points } });
    return { type: 'points', points: choice.points };
  }
  if (choice.type === 'daily_spin') {
    await User.updateOne({ _id: user._id }, { $inc: { bonusDailySpins: 1 } });
    return { type: 'daily_spin' };
  }
  const prize = await Prize.findOne({ _id: choice.prizeId, isActive: true });
  if (!prize) throw new AppError('الجائزة غير موجودة أو متوقفة', 404, 'PRIZE_NOT_FOUND');
  if (!prize.isUnlimited) {
    const reserved = await Prize.updateOne({ _id: prize._id, stock: { $gt: 0 } }, { $inc: { stock: -1, pendingCount: 1 } });
    if (reserved.modifiedCount !== 1) throw new AppError('الجائزة نفدت من المخزون', 409, 'OUT_OF_STOCK');
  } else {
    await Prize.updateOne({ _id: prize._id }, { $inc: { pendingCount: 1 } });
  }
  const now = new Date();
  // Like gift-link prizes: into the bag, withdrawn after every claim step, gone after 24 hours.
  const userPrize = await UserPrize.create({
    user: user._id,
    telegramId: s.telegramId,
    prize: prize._id,
    prizeNameSnapshot: prize.name,
    source: 'suggestion',
    wonAt: now,
    expiresAt: new Date(now.getTime() + SUGGESTION_PRIZE_EXPIRY_MS),
    status: 'active',
  });
  await ensureClaimTask(userPrize).catch((err) => logger.warn({ err, userPrize: userPrize._id }, 'suggestion prize task failed'));
  return { type: 'prize', prizeName: prize.name, userPrize: userPrize._id as mongoose.Types.ObjectId };
}

/**
 * Accepts (with the reward the admin picked) or rejects a suggestion. Only the first decision
 * counts; if the reward can't be given, the suggestion stays pending and nothing changes.
 */
export async function decideSuggestion(params: {
  seq: number;
  accept: boolean;
  reward?: RewardChoice;
  note?: string | null;
  adminId: number;
  adminName: string;
}) {
  const note = params.note?.trim() ? params.note.trim().slice(0, 500) : null;
  const decided = await Suggestion.findOneAndUpdate(
    { seq: params.seq, status: 'pending' },
    {
      $set: {
        status: params.accept ? 'accepted' : 'rejected',
        decidedBy: params.adminId,
        decidedByName: params.adminName,
        decidedAt: new Date(),
        note,
      },
    },
    { new: true }
  );
  if (!decided) {
    const s = await Suggestion.findOne({ seq: params.seq }).select('status decidedByName').lean();
    if (!s) throw new AppError('الاقتراح غير موجود', 404, 'NOT_FOUND');
    throw new AppError(`هذا الاقتراح انرد عليه من قبل${s.decidedByName ? ` (${s.decidedByName})` : ''}`, 409, 'ALREADY_DECIDED');
  }

  let reward: SuggestionReward | null = null;
  if (params.accept) {
    try {
      reward = await giveReward(decided, params.reward ?? { type: 'none' });
    } catch (err) {
      // Back to waiting, so another try (or another admin) can decide it.
      await Suggestion.updateOne(
        { _id: decided._id, status: 'accepted' },
        { $set: { status: 'pending', decidedBy: null, decidedByName: null, decidedAt: null, note: null } }
      );
      throw err;
    }
    await Suggestion.updateOne({ _id: decided._id }, { $set: { reward } });
    decided.reward = reward;
  }

  const user = await User.findOne({ telegramId: decided.telegramId }).select('_id').lean();
  if (user) {
    const quote = decided.text.length > 120 ? `${decided.text.slice(0, 120)}…` : decided.text;
    await createNotification({
      userId: user._id as mongoose.Types.ObjectId,
      telegramId: decided.telegramId,
      type: 'suggestion_decided',
      title: params.accept
        ? { ar: `🎉 انقبل اقتراحك #${decided.seq}`, en: `🎉 Your suggestion #${decided.seq} was accepted` }
        : { ar: `💡 اقتراحك #${decided.seq}`, en: `💡 Your suggestion #${decided.seq}` },
      body: params.accept
        ? {
            ar: `«${quote}»\n\nشكراً على فكرتك!${reward && reward.type !== 'none' ? `\nجائزتك: ${rewardText(reward, 'ar')}${reward.type === 'prize' ? '\nتلكاها بالحقيبة: كمّل مهام الاستلام خلال 24 ساعة حتى تسحبها.' : ''}` : ''}${note ? `\n\n${note}` : ''}`,
            en: `“${quote}”\n\nThanks for the idea!${reward && reward.type !== 'none' ? `\nYour reward: ${rewardText(reward, 'en')}${reward.type === 'prize' ? '\nIt’s in your inventory: finish its claim tasks within 24 hours to withdraw it.' : ''}` : ''}${note ? `\n\n${note}` : ''}`,
          }
        : {
            ar: `«${quote}»\n\nشكراً على فكرتك، بس ما راح نضيفها هسه.${note ? `\n\n${note}` : ''}`,
            en: `“${quote}”\n\nThanks for the idea, but we won’t add it for now.${note ? `\n\n${note}` : ''}`,
          },
    }).catch((err) => logger.warn({ err, seq: decided.seq }, 'suggestion notice failed'));
  }
  return decided;
}

// ───────────── The admins' messages in the bot ─────────────

export function suggestionAdminText(s: Pick<ISuggestion, 'seq' | 'name' | 'username' | 'telegramId' | 'text' | 'status' | 'decidedByName' | 'reward' | 'note'>) {
  const who = `${esc(s.name)}${s.username ? ` (@${esc(s.username)})` : ''} · <code>${s.telegramId}</code>`;
  const lines = [`💡 <b>اقتراح جديد #${s.seq}</b>`, who, '', `<blockquote>${esc(s.text)}</blockquote>`];
  if (s.status === 'accepted') lines.push('', `✅ قبله ${esc(s.decidedByName ?? '')} · ${esc(rewardText(s.reward, 'ar'))}`);
  if (s.status === 'rejected') lines.push('', `❌ رفضه ${esc(s.decidedByName ?? '')}`);
  if (s.status !== 'pending' && s.note) lines.push(`📝 ${esc(s.note)}`);
  return lines.join('\n');
}

export function suggestionAdminKeyboard(seq: number): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ قبول بدون جائزة', callback_data: `sg:a:${seq}:none` },
        { text: '❌ رفض', callback_data: `sg:r:${seq}` },
      ],
      [
        { text: '💎 قبول + نقاط', callback_data: `sg:p:${seq}` },
        { text: '🎡 قبول + فرة', callback_data: `sg:a:${seq}:spin` },
      ],
      [{ text: '🎁 قبول + جائزة', callback_data: `sg:g:${seq}` }],
    ],
  };
}

/** Sends the new suggestion to every admin, and remembers the messages to update them later. */
export async function notifyAdminsNewSuggestion(bot: TelegramBot | null, s: HydratedDocument<ISuggestion>) {
  if (!bot) return;
  const ids = await listAllAdminTelegramIds();
  const sent = await Promise.all(
    ids.map((id) =>
      bot
        .sendMessage(id, suggestionAdminText(s), { parse_mode: 'HTML', reply_markup: suggestionAdminKeyboard(s.seq) })
        .then((m) => ({ chatId: id, messageId: m.message_id }))
        .catch((err) => {
          logger.warn({ err, id }, 'suggestion admin notice failed');
          return null;
        })
    )
  );
  const adminMessages = sent.filter((m): m is { chatId: number; messageId: number } => m !== null);
  await Suggestion.updateOne({ _id: s._id }, { $set: { adminMessages } }).catch(() => undefined);
}

/** Once decided, every admin's copy says who decided it and with what, without buttons. */
export async function markSuggestionDecided(bot: TelegramBot | null, s: ISuggestion) {
  if (!bot) return;
  const text = suggestionAdminText(s);
  await Promise.all(
    (s.adminMessages ?? []).map((m) =>
      bot
        .editMessageText(text, { chat_id: m.chatId, message_id: m.messageId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } })
        .catch(() => undefined)
    )
  );
}
