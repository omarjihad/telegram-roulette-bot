import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import { Giveaway, GiveawayChat, GiveawayEntry, GiveawayWinner, IGiveaway, getGiveawayConfig } from '../models/Giveaway';
import { User } from '../models/User';
import { nextSequence } from '../models/Counter';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { checkMembershipStatus } from './forcedSub.service';

/*
 * Channel giveaways (سحوبات):
 *  - a developer writes the giveaway post in their channel and forwards it to the bot;
 *  - the bot adds the buttons to it and posts "write your username" under it: commenting there
 *    proves the person started this bot (condition 3);
 *  - "انقر للانضمام" checks the conditions (1: the channels, 3: the comment) and gives a number;
 *  - "تعزيز نسبة فوزك" gives a personal link: everyone who joins through it is an extra chance;
 *  - the developer stops joining and draws winners one by one (a winners post with "draw another").
 * Condition 2 (sharing with friends) is checked by hand by the developers.
 */

// ───────────── Buttons ─────────────

/** Telegram button colours (Bot API `style`). */
type ButtonStyle = 'success' | 'danger' | 'primary';
type StyledButton = TelegramBot.InlineKeyboardButton & { style?: ButtonStyle };

const botName = () => env.BOT_USERNAME || 'MfRuLiTbot';

/**
 * The giveaway post's buttons. Open: join green, draw red, stop blue, boost green, count red.
 * Stopped: join red, draw green, start blue, boost red, count red.
 */
export function giveawayKeyboard(g: Pick<IGiveaway, 'seq' | 'status' | 'count'>): TelegramBot.InlineKeyboardMarkup {
  const open = g.status === 'open';
  const rows: StyledButton[][] = [
    [{ text: `انقر للانضمام • ${g.count}`, callback_data: `gw:j:${g.seq}`, style: open ? 'success' : 'danger' }],
    [
      { text: 'سحب فائز', callback_data: `gw:d:${g.seq}`, style: open ? 'danger' : 'success' },
      { text: open ? 'إيقاف الانضمام' : 'تشغيل الانضمام', callback_data: `gw:s:${g.seq}`, style: 'primary' },
    ],
    [{ text: '⚡ تعزيز نسبة فوزك', url: `https://t.me/${botName()}?start=gwb_${g.seq}`, style: open ? 'success' : 'danger' }],
    [{ text: `عدد المنضمين : ${g.count}`, callback_data: `gw:c:${g.seq}`, style: 'danger' }],
  ];
  return { inline_keyboard: rows };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Seconds Telegram asked us to wait (429 Too Many Requests), or 0. */
export const retryAfter = (err: unknown) =>
  Number((err as { response?: { body?: { parameters?: { retry_after?: number } } } })?.response?.body?.parameters?.retry_after) || 0;

/** "الفائزون:" with each winner hidden under a spoiler inside a quote (tap to reveal). */
export function winnersText(winners: GiveawayWinner[]) {
  const lines = [...winners]
    .sort((a, b) => a.place - b.place)
    .map((w) => `${w.place}- <tg-spoiler><a href="tg://user?id=${w.telegramId}">${esc(w.name || String(w.telegramId))}</a></tg-spoiler>`);
  return `🏆 <b>الفائزون:</b>\n<blockquote>${lines.join('\n')}</blockquote>`;
}

/** A button per winner (opens their profile when they have a username) and "draw another". */
export function winnersKeyboard(seq: number, winners: GiveawayWinner[], profiles = true): TelegramBot.InlineKeyboardMarkup {
  const rows: StyledButton[][] = [];
  for (const w of [...winners].sort((a, b) => a.place - b.place)) {
    const url = w.username ? `https://t.me/${w.username}` : profiles ? `tg://user?id=${w.telegramId}` : null;
    if (url) rows.push([{ text: `${w.place}- ${w.name || w.username || w.telegramId}`, url }]);
  }
  rows.push([{ text: 'سحب فائز اخر', callback_data: `gw:n:${seq}`, style: 'primary' }]);
  return { inline_keyboard: rows };
}

// ───────────── Links ─────────────

/** A link to a channel post (public username, or the private t.me/c/ form). */
export function postLink(channel: { channelId: number; channelUsername?: string | null }, messageId: number) {
  if (channel.channelUsername) return `https://t.me/${channel.channelUsername}/${messageId}`;
  return `https://t.me/c/${String(channel.channelId).replace(/^-100/, '')}/${messageId}`;
}

/** "https://t.me/name/123" or "https://t.me/c/123456/789" → where the post is. */
export function parsePostLink(text: string): { username?: string; channelId?: number; messageId: number } | null {
  const m = text.trim().match(/(?:https?:\/\/)?t\.me\/(?:c\/(\d+)|([A-Za-z0-9_]{4,}))\/(\d+)/);
  if (!m) return null;
  return m[1] ? { channelId: Number(`-100${m[1]}`), messageId: Number(m[3]) } : { username: m[2], messageId: Number(m[3]) };
}

/** The channel post a forwarded message came from (Bot API's forward_origin, or the older fields). */
export function forwardedChannelPost(msg: TelegramBot.Message): { channelId: number; messageId: number } | null {
  const m = msg as TelegramBot.Message & {
    forward_origin?: { type?: string; chat?: { id: number }; message_id?: number };
    forward_from_chat?: { id: number; type?: string };
    forward_from_message_id?: number;
  };
  const o = m.forward_origin;
  if (o && o.type === 'channel' && o.chat && o.message_id) return { channelId: o.chat.id, messageId: o.message_id };
  if (m.forward_from_chat && m.forward_from_message_id) return { channelId: m.forward_from_chat.id, messageId: m.forward_from_message_id };
  return null;
}

// ───────────── The bot's rights ─────────────

let meCache: TelegramBot.User | null = null;
async function me(bot: TelegramBot) {
  if (!meCache) meCache = await bot.getMe();
  return meCache;
}

export interface RightsLine {
  label: string;
  ok: boolean;
  why?: string;
}

/** Is the bot an admin in this chat (and, for the giveaway channel, may it post and edit)? */
export async function botRightsIn(bot: TelegramBot, chatId: number | string, needPostAndEdit = false): Promise<{ ok: boolean; why?: string }> {
  try {
    const m = (await bot.getChatMember(chatId, (await me(bot)).id)) as TelegramBot.ChatMember & { can_post_messages?: boolean; can_edit_messages?: boolean };
    if (m.status !== 'administrator' && m.status !== 'creator') return { ok: false, why: 'البوت مو مشرف' };
    if (needPostAndEdit && m.status === 'administrator') {
      if (m.can_post_messages === false) return { ok: false, why: 'ما عنده صلاحية نشر الرسائل' };
      if (m.can_edit_messages === false) return { ok: false, why: 'ما عنده صلاحية تعديل رسائل الآخرين' };
    }
    return { ok: true };
  } catch {
    return { ok: false, why: 'البوت مو موجود بيها' };
  }
}

/** The channels of condition 1, each with whether the bot is an admin there. */
export async function requiredWithRights(bot: TelegramBot) {
  const config = await getGiveawayConfig();
  return Promise.all(config.required.map(async (c) => ({ chat: c, ...(await botRightsIn(bot, c.chatId)) })));
}

/** Everything a giveaway needs: its channel, the comments group, and the channels of condition 1. */
export async function giveawayRights(bot: TelegramBot, channelId: number, discussionId?: number | null): Promise<RightsLine[]> {
  const lines: RightsLine[] = [];
  const channel = await botRightsIn(bot, channelId, true);
  lines.push({ label: 'قناة السحب', ok: channel.ok, why: channel.why });
  if (discussionId) {
    const group = await botRightsIn(bot, discussionId);
    lines.push({ label: 'كروب التعليقات', ok: group.ok, why: group.why });
  } else {
    lines.push({ label: 'كروب التعليقات', ok: false, why: 'القناة ما مربوط بيها كروب تعليقات' });
  }
  for (const r of await requiredWithRights(bot)) lines.push({ label: r.chat.username ? `@${r.chat.username}` : r.chat.title, ok: r.ok, why: r.why });
  return lines;
}

export const rightsText = (lines: RightsLine[]) => lines.map((l) => `${l.ok ? '✅' : '❌'} ${l.label}${l.ok ? '' : ` — ${l.why}`}`).join('\n');

// ───────────── Condition 1 channels ─────────────

/** Adds a channel to condition 1 by @username, link, numeric id, or a post forwarded from it. */
export async function addRequiredChat(bot: TelegramBot, input: string | number): Promise<GiveawayChat> {
  let ref: string | number = input;
  if (typeof input === 'string') {
    const t = input.trim();
    const link = t.match(/t\.me\/([A-Za-z0-9_]{4,})/);
    ref = link ? `@${link[1]}` : /^-?\d+$/.test(t) ? Number(t) : t.startsWith('@') ? t : `@${t}`;
  }
  let chat: TelegramBot.Chat;
  try {
    chat = await bot.getChat(ref);
  } catch {
    throw new Error('ما لكيت هذي القناة. تأكد من المعرف وإن البوت مضاف بيها.');
  }
  const entry: GiveawayChat = { chatId: String(chat.id), title: chat.title || String(chat.id), username: chat.username || null };
  const config = await getGiveawayConfig();
  if (!config.required.some((c) => c.chatId === entry.chatId)) {
    config.required.push(entry);
    await config.save();
  }
  return entry;
}

export async function removeRequiredChat(chatId: string) {
  const config = await getGiveawayConfig();
  config.required = config.required.filter((c) => c.chatId !== chatId);
  await config.save();
}

async function channelStatus(bot: TelegramBot, telegramId: number) {
  const config = await getGiveawayConfig();
  return Promise.all(config.required.map(async (c) => ({ c, ...(await checkMembershipStatus(bot, { chatId: c.chatId }, telegramId)) })));
}

/** The channels of condition 1 this person hasn't joined (or Telegram couldn't confirm). */
export async function missingChannels(bot: TelegramBot, telegramId: number) {
  return (await channelStatus(bot, telegramId)).filter((r) => !r.isSubscribed).map((r) => r.c);
}

/** The channels this person surely left (a check Telegram failed doesn't count): for the draw. */
async function leftChannels(bot: TelegramBot, telegramId: number) {
  return (await channelStatus(bot, telegramId)).filter((r) => !r.isSubscribed && !r.unavailable).map((r) => r.c);
}

// ───────────── Creating a giveaway ─────────────

/**
 * Turns the developer's channel post into a giveaway: checks the bot's rights, adds the buttons,
 * and posts "write your username" (whose comments check condition 3). Refuses with the list of
 * what's missing when the bot can't do its job yet.
 */
export async function createGiveaway(bot: TelegramBot, adminId: number, channelId: number, postId: number) {
  const chat = await bot.getChat(channelId).catch(() => null);
  if (!chat || chat.type !== 'channel') return { ok: false as const, error: 'هذا مو منشور من قناة.' };
  const discussionId = ((chat as TelegramBot.Chat & { linked_chat_id?: number }).linked_chat_id) ?? null;
  const rights = await giveawayRights(bot, channelId, discussionId);
  // All of it is needed: the channel (buttons), the comments group (condition 3), and every
  // channel of condition 1 (the bot can only see who joined a channel where it's an admin).
  if (rights.some((l) => !l.ok)) return { ok: false as const, rights };
  const existing = await Giveaway.findOne({ channelId, postId });
  if (existing) return { ok: false as const, error: `هذا المنشور صار سحب من قبل (#${existing.seq}).` };

  const seq = await nextSequence('giveaway', 0);
  const g = await Giveaway.create({
    seq,
    channelId,
    channelTitle: chat.title || '',
    channelUsername: chat.username || null,
    postId,
    discussionId,
    createdBy: adminId,
  });
  forgetGiveawayGroups();
  try {
    await bot.editMessageReplyMarkup(giveawayKeyboard(g), { chat_id: channelId, message_id: postId });
  } catch (err) {
    await Giveaway.deleteOne({ _id: g._id });
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false as const, error: `ما كدرت أضيف الأزرار على المنشور: ${text}` };
  }
  // "Write your username" right after the giveaway post: its comments are condition 3.
  try {
    const post = await bot.sendMessage(
      channelId,
      `✍️ <b>اكتب يوزرك هنا بالتعليقات</b> 👇\n\nحتى نتحقق إنك فعّلت بوت @${botName()} (الشرط 3 من سحب #${seq}).`,
      { parse_mode: 'HTML' }
    );
    g.usernamePostId = post.message_id;
    await g.save();
  } catch (err) {
    logger.warn({ err, channelId }, 'giveaway username post failed');
  }
  return { ok: true as const, giveaway: g, rights };
}

// ───────────── Keeping the buttons' numbers fresh ─────────────

const refreshTimers = new Map<number, NodeJS.Timeout>();

/** Puts the buttons on the giveaway post. Returns the seconds Telegram asked to wait (0 when done). */
export async function applyKeyboard(bot: TelegramBot, g: IGiveaway): Promise<number> {
  try {
    await bot.editMessageReplyMarkup(giveawayKeyboard(g), { chat_id: g.channelId, message_id: g.postId });
  } catch (err) {
    const wait = retryAfter(err);
    if (wait) return wait;
    if (!String((err as Error).message).includes('not modified')) logger.warn({ err, seq: g.seq }, 'giveaway buttons update failed');
  }
  return 0;
}

/**
 * Updates the join / count buttons a moment later (many joins at once = one edit), and again
 * after the wait when Telegram says the post was edited too often.
 */
export function refreshKeyboardSoon(bot: TelegramBot, seq: number, delay = 3000) {
  if (refreshTimers.has(seq)) return;
  refreshTimers.set(
    seq,
    setTimeout(async () => {
      refreshTimers.delete(seq);
      const g = await Giveaway.findOne({ seq }).catch(() => null);
      const wait = g ? await applyKeyboard(bot, g) : 0;
      if (wait) refreshKeyboardSoon(bot, seq, wait * 1000 + 500);
    }, delay)
  );
}

// ───────────── Joining ─────────────

const nameOf = (u: TelegramBot.User) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || String(u.id);

/** The message a person sees after "انقر للانضمام" (a pop-up, at most 200 characters). */
export async function joinGiveaway(bot: TelegramBot, seq: number, from: TelegramBot.User): Promise<string> {
  const g = await Giveaway.findOne({ seq });
  if (!g) return 'هذا السحب غير موجود';
  const mine = await GiveawayEntry.findOne({ giveaway: g._id, telegramId: from.id });
  if (mine?.joinedAt) return `أنت مشارك بالفعل في هذا السحب مسبقاً ✅\nرقمك: #${mine.number}`;
  if (g.status !== 'open') return 'الانضمام متوقف حالياً ⛔';

  // Condition 1: every channel.
  const missing = await missingChannels(bot, from.id);
  if (missing.length) {
    const names = missing.map((c) => (c.username ? `@${c.username}` : c.title)).join(' ، ');
    return `عليك الاشتراك بالقنوات الإجبارية أولاً في الشرط 1:\n${names}`.slice(0, 200);
  }
  // Condition 3: started this bot and wrote their username under the post (when it has comments).
  const started = await User.exists({ telegramId: from.id });
  const commented = !g.usernamePostId || !g.discussionId || Boolean(mine?.verifiedAt);
  if (!started || !commented) return `عليك تطبيق الشرط 3 أولاً:\nفعّل بوت @${botName()} ثم اكتب يوزرك بتعليقات رسالة (اكتب يوزرك)`.slice(0, 200);

  // Claim the join first (only once per person), then take the next number.
  const claimed = await GiveawayEntry.findOneAndUpdate(
    { giveaway: g._id, telegramId: from.id, joinedAt: null },
    { $set: { joinedAt: new Date(), name: nameOf(from), username: from.username || null } },
    { new: true }
  ).catch(() => null);
  let entry = claimed;
  if (!entry) {
    // No row yet (never commented, comments off): make one, unless someone else just made it.
    try {
      entry = await GiveawayEntry.create({ giveaway: g._id, telegramId: from.id, name: nameOf(from), username: from.username || null, joinedAt: new Date() });
    } catch {
      const again = await GiveawayEntry.findOne({ giveaway: g._id, telegramId: from.id });
      if (!again?.joinedAt) return 'صار خطأ، حاول مرة ثانية';
      return `أنت مشارك بالفعل في هذا السحب مسبقاً ✅${again.number ? `\nرقمك: #${again.number}` : ''}`;
    }
  }
  const counted = await Giveaway.findOneAndUpdate({ _id: g._id }, { $inc: { count: 1 } }, { new: true });
  const number = counted?.count ?? g.count + 1;
  await GiveawayEntry.updateOne({ _id: entry._id }, { $set: { number } });

  // Whoever invited them gets an extra chance (and a note).
  if (entry.referredBy && entry.referredBy !== from.id) {
    const ref = await GiveawayEntry.findOneAndUpdate(
      { giveaway: g._id, telegramId: entry.referredBy },
      { $inc: { bonus: 1 } },
      { new: true, upsert: true }
    ).catch(() => null);
    if (ref) {
      bot
        .sendMessage(
          entry.referredBy,
          `⚡ ${nameOf(from)} دخل سحب #${g.seq} من رابطك!\nفرصك هسه: ${1 + (ref.bonus || 0)}${ref.joinedAt ? '' : '\n\n⚠️ انت بعدك مو مشارك: اضغط «انقر للانضمام» بمنشور السحب حتى تنحسبلك.'}`
        )
        .catch(() => undefined);
    }
  }
  refreshKeyboardSoon(bot, g.seq);
  return `تم تسجيل مشاركتك بنجاح، حظاً موفقاً ✅\nرقمك: #${number}`;
}

// ───────────── Condition 3: comments under "write your username" ─────────────

type GroupMessage = TelegramBot.Message & {
  message_thread_id?: number;
  is_automatic_forward?: boolean;
  sender_chat?: TelegramBot.Chat;
};

/** The giveaway whose "write your username" post this comment belongs to, if any. */
export async function giveawayForComment(msg: GroupMessage) {
  const reply = msg.reply_to_message as GroupMessage | undefined;
  // The channel post's copy in the comments group (Telegram forwards it there by itself).
  if (reply && reply.is_automatic_forward) {
    const origin = forwardedChannelPost(reply);
    if (origin) {
      const g = await Giveaway.findOne({ channelId: origin.channelId, usernamePostId: origin.messageId });
      if (g) {
        if (g.usernameThreadId !== reply.message_id) {
          g.usernameThreadId = reply.message_id;
          await g.save();
        }
        return g;
      }
    }
  }
  // A reply to another comment in the same thread.
  if (msg.message_thread_id) return Giveaway.findOne({ discussionId: msg.chat.id, usernameThreadId: msg.message_thread_id });
  return null;
}

/** The comments group got its copy of a channel post: if it's a "write your username" post, remember its thread. */
export async function rememberUsernameThread(msg: GroupMessage) {
  const origin = forwardedChannelPost(msg);
  if (!origin) return;
  await Giveaway.updateOne({ channelId: origin.channelId, usernamePostId: origin.messageId }, { $set: { usernameThreadId: msg.message_id } });
}

/** Someone commented under "write your username": did they start this bot? Returns the reply. */
export async function verifyComment(msg: GroupMessage): Promise<{ verified: boolean; text: string; seq: number } | null> {
  const from = msg.from;
  if (!from || from.is_bot || msg.sender_chat) return null; // channels / anonymous admins
  const g = await giveawayForComment(msg);
  if (!g) return null;
  const started = await User.exists({ telegramId: from.id });
  if (!started) {
    return { verified: false, seq: g.seq, text: `لم تقم بالدخول إلى البوت بعد ❌\nقم بالدخول أولاً: @${botName()}\nثم اكتب يوزرك مرة أخرى` };
  }
  await GiveawayEntry.updateOne(
    { giveaway: g._id, telegramId: from.id },
    { $set: { verifiedAt: new Date(), name: nameOf(from), username: from.username || null } },
    { upsert: true }
  );
  return { verified: true, seq: g.seq, text: `تم التحقق من تفعيل بوت @${botName()} ✅\nالآن يمكنك المشاركة في السحب` };
}

// ───────────── Boost links ─────────────

export const boostLink = (seq: number, telegramId: number) => `https://t.me/${botName()}?start=gwr_${seq}_${telegramId}`;

/** "تعزيز نسبة فوزك" opened the bot: the person's own link and how many chances they have. */
export async function boostMessage(seq: number, telegramId: number) {
  const g = await Giveaway.findOne({ seq });
  if (!g) return { text: 'هذا السحب غير موجود.', post: null as string | null };
  const e = await GiveawayEntry.findOne({ giveaway: g._id, telegramId });
  const link = boostLink(seq, telegramId);
  const lines = [
    `⚡ <b>تعزيز نسبة فوزك</b> بسحب #${seq}`,
    '',
    'انشر رابطك الخاص 👇',
    `<code>${link}</code>`,
    '',
    'كل شخص يدخل من رابطك ويطبق الشروط ويشارك بالسحب = فرصة إضافية إلك بالسحب.',
    `🎟 فرصك هسه: <b>${1 + (e?.bonus ?? 0)}</b> (دخل من رابطك ${e?.bonus ?? 0})`,
  ];
  if (!e?.joinedAt) lines.push('', '⚠️ انت بعدك مو مشارك: اضغط «انقر للانضمام» بمنشور السحب حتى تنحسبلك الفرص.');
  if (g.status !== 'open') lines.push('', '⛔ الانضمام لهذا السحب متوقف حالياً.');
  return { text: lines.join('\n'), post: postLink(g, g.postId), link };
}

/** Someone opened a boost link: remember who invited them (once, and not themselves). */
export async function recordReferral(seq: number, referrer: number, telegramId: number) {
  const g = await Giveaway.findOne({ seq });
  if (!g) return { g: null, ok: false };
  if (referrer === telegramId) return { g, ok: false };
  const e = await GiveawayEntry.findOne({ giveaway: g._id, telegramId });
  if (e?.joinedAt || e?.referredBy) return { g, ok: false };
  await GiveawayEntry.updateOne({ giveaway: g._id, telegramId }, { $set: { referredBy: referrer } }, { upsert: true });
  return { g, ok: true };
}

// ───────────── The draw ─────────────

/** Picks one by weight (1 + bonus each). `rnd` returns [0, 1). */
export function pickWeighted<T extends { bonus?: number | null }>(list: T[], rnd = Math.random): T | null {
  if (!list.length) return null;
  const total = list.reduce((s, e) => s + 1 + Math.max(0, e.bonus ?? 0), 0);
  let r = rnd() * total;
  for (const e of list) {
    r -= 1 + Math.max(0, e.bonus ?? 0);
    if (r < 0) return e;
  }
  return list[list.length - 1];
}

/**
 * Draws a winner for `place` among the joined who haven't won and weren't dropped. Someone who
 * left a channel of condition 1 is dropped and another is drawn.
 */
export async function drawWinner(bot: TelegramBot, g: IGiveaway, place: number): Promise<GiveawayWinner | null> {
  const taken = new Set([...g.winners.map((w) => w.telegramId), ...g.dropped]);
  let pool = (await GiveawayEntry.find({ giveaway: g._id, joinedAt: { $ne: null } }).select('telegramId name username number bonus').lean()).filter(
    (e) => !taken.has(e.telegramId)
  );
  for (let tries = 0; tries < 40 && pool.length; tries++) {
    const pick = pickWeighted(pool);
    if (!pick) break;
    pool = pool.filter((e) => e.telegramId !== pick.telegramId);
    const left = await leftChannels(bot, pick.telegramId);
    if (left.length) {
      await Giveaway.updateOne({ _id: g._id }, { $addToSet: { dropped: pick.telegramId } });
      g.dropped.push(pick.telegramId);
      continue;
    }
    return { telegramId: pick.telegramId, name: pick.name, username: pick.username ?? null, number: pick.number ?? 0, place };
  }
  return null;
}

/** Posts the winners under the giveaway post, or updates that post. */
export async function publishWinners(bot: TelegramBot, g: IGiveaway) {
  const text = winnersText(g.winners);
  const send = async (profiles: boolean) => {
    const markup = winnersKeyboard(g.seq, g.winners, profiles);
    if (g.winnersPostId) {
      await bot
        .editMessageText(text, { chat_id: g.channelId, message_id: g.winnersPostId, parse_mode: 'HTML', reply_markup: markup })
        .catch((err) => {
          if (!String(err.message).includes('not modified')) throw err;
        });
      return;
    }
    const post = await bot.sendMessage(g.channelId, text, {
      parse_mode: 'HTML',
      reply_markup: markup,
      reply_to_message_id: g.postId,
      allow_sending_without_reply: true,
    } as TelegramBot.SendMessageOptions);
    g.winnersPostId = post.message_id;
    await Giveaway.updateOne({ _id: g._id }, { $set: { winnersPostId: post.message_id } });
  };
  try {
    await send(true);
  } catch (err) {
    // Someone's privacy forbids a profile button: post without those.
    if (/PRIVACY|BUTTON_USER/.test(String((err as Error).message))) await send(false);
    else throw err;
  }
}

/** "سحب فائز" / "سحب فائز اخر": the next place. Joining must be stopped first. */
export async function drawNext(bot: TelegramBot, seq: number): Promise<{ text: string; winner?: GiveawayWinner; g?: IGiveaway }> {
  const g = await Giveaway.findOne({ seq });
  if (!g) return { text: 'هذا السحب غير موجود' };
  if (g.status === 'open') return { text: 'يجب إيقاف الانضمام أولاً قبل بدء السحب' };
  const places = new Set(g.winners.map((w) => w.place));
  let place = 1;
  while (places.has(place)) place++;
  const winner = await drawWinner(bot, g, place);
  if (!winner) return { text: 'ماكو مشاركين باقين للسحب' };
  const saved = await Giveaway.findOneAndUpdate({ _id: g._id, 'winners.place': { $ne: place } }, { $push: { winners: winner } }, { new: true });
  if (!saved) return { text: 'انسحب فائز هسه، جرّب مرة ثانية' };
  await publishWinners(bot, saved);
  return { text: `🏆 الفائز رقم ${place}: ${winner.name} (#${winner.number})`, winner, g: saved };
}

/** Takes a winner out (e.g. didn't do condition 2) and draws someone else for the same place. */
export async function replaceWinner(bot: TelegramBot, seq: number, place: number) {
  const g = await Giveaway.findOne({ seq });
  if (!g) return { text: 'هذا السحب غير موجود' };
  const old = g.winners.find((w) => w.place === place);
  if (!old) return { text: 'ماكو فائز بهذا المركز' };
  g.dropped.push(old.telegramId);
  const winner = await drawWinner(bot, g, place);
  const winners = g.winners.filter((w) => w.place !== place);
  if (winner) winners.push(winner);
  const saved = await Giveaway.findOneAndUpdate({ _id: g._id }, { $set: { winners }, $addToSet: { dropped: old.telegramId } }, { new: true });
  if (saved) await publishWinners(bot, saved);
  return winner
    ? { text: `🔁 بدال ${old.name}: الفائز رقم ${place} صار ${winner.name} (#${winner.number})`, winner, g: saved ?? g }
    : { text: `انشال ${old.name}، وماكو مشاركين باقين حتى ينسحب بداله`, g: saved ?? g };
}

/** Stops or reopens joining; the buttons change colour. */
export async function toggleJoining(bot: TelegramBot, seq: number) {
  const g = await Giveaway.findOne({ seq });
  if (!g) return 'هذا السحب غير موجود';
  g.status = g.status === 'open' ? 'stopped' : 'open';
  await g.save();
  const wait = await applyKeyboard(bot, g);
  if (wait) refreshKeyboardSoon(bot, g.seq, wait * 1000 + 500);
  return g.status === 'open' ? 'تم تشغيل الانضمام ✅' : 'تم إيقاف الانضمام ⛔';
}

// The comments groups of giveaways, so other groups' messages are skipped without a lookup.
let groupsCache = { ids: new Set<number>(), at: 0 };
export async function isGiveawayGroup(chatId: number) {
  if (Date.now() - groupsCache.at > 60000) {
    const ids = (await Giveaway.distinct('discussionId')).filter((x): x is number => typeof x === 'number');
    groupsCache = { ids: new Set(ids), at: Date.now() };
  }
  return groupsCache.ids.has(chatId);
}
export function forgetGiveawayGroups() {
  groupsCache = { ids: new Set(), at: 0 };
}

export async function giveawayBySeq(seq: number) {
  return Giveaway.findOne({ seq });
}

export async function recentGiveaways(limit = 6) {
  return Giveaway.find({}).sort({ seq: -1 }).limit(limit);
}

export const giveawayId = (g: { _id: unknown }) => String(g._id as Types.ObjectId);
