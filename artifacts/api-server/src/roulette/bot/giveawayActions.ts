import TelegramBot from 'node-telegram-bot-api';
import { getAdminRole } from '../services/admin.service';
import { logger } from '../config/logger';
import {
  addRequiredChat,
  boostMessage,
  createGiveaway,
  drawNext,
  forwardedChannelPost,
  giveawayBySeq,
  giveawayRights,
  joinGiveaway,
  parsePostLink,
  postLink,
  recentGiveaways,
  recordReferral,
  removeRequiredChat,
  replaceWinner,
  requiredWithRights,
  rightsText,
  toggleJoining,
  verifyComment,
  applyKeyboard,
  isGiveawayGroup,
  rememberUsernameThread,
  retryAfter,
  RightsLine,
} from '../services/giveaway.service';
import { GiveawayWinner } from '../models/Giveaway';

/*
 * Telegram side of the giveaways: the developer menu (.سحب), the buttons on the channel post,
 * the comments under "write your username", and the boost links (/start gwb_… / gwr_…).
 */

type Btn = TelegramBot.InlineKeyboardButton & { style?: 'success' | 'danger' | 'primary' };
const kb = (rows: Btn[][]): TelegramBot.InlineKeyboardMarkup => ({ inline_keyboard: rows });
const html = { parse_mode: 'HTML' as const, disable_web_page_preview: true };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// What a developer's next message in the bot's chat is for.
const pending = new Map<number, { kind: 'post' | 'chan' }>();
// A post that couldn't become a giveaway yet (bot rights missing): "re-check" tries it again.
const retryPost = new Map<number, { channelId: number; messageId: number }>();

// ───────────── Replies in the comments group, at Telegram's pace (≈20 a minute there) ─────────────
const groupQueues = new Map<number, Promise<void>>();
const queued = new Map<number, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function replyInGroup(bot: TelegramBot, chatId: number, replyTo: number, text: string) {
  const at = Date.now();
  queued.set(chatId, (queued.get(chatId) ?? 0) + 1);
  const prev = groupQueues.get(chatId) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      if (Date.now() - at > 10 * 60_000) return; // too late to help anyone
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await bot.sendMessage(chatId, text, { reply_to_message_id: replyTo, allow_sending_without_reply: true } as TelegramBot.SendMessageOptions);
          break;
        } catch (err) {
          const wait = retryAfter(err);
          if (!wait) break;
          await sleep(wait * 1000 + 300);
        }
      }
      await sleep(3100);
    } finally {
      queued.set(chatId, Math.max(0, (queued.get(chatId) ?? 1) - 1));
    }
  });
  groupQueues.set(chatId, next.catch(() => undefined));
}

// People often comment more than once: one answer each every few minutes.
const answered = new Map<string, number>();
function answerComment(bot: TelegramBot, msg: TelegramBot.Message, res: { verified: boolean; text: string; seq: number }) {
  const from = msg.from!;
  const now = Date.now();
  const key = `${msg.chat.id}:${from.id}:${res.verified ? 1 : 0}`;
  if ((answered.get(key) ?? 0) > now) return;
  answered.set(key, now + 3 * 60_000);
  if (answered.size > 5000) for (const [k, until] of answered) if (until <= now) answered.delete(k);
  // A long line in the group: those who started the bot hear back privately right away.
  if (res.verified && (queued.get(msg.chat.id) ?? 0) >= 8) {
    bot.sendMessage(from.id, `${res.text}\n(سحب #${res.seq})`).catch(() => replyInGroup(bot, msg.chat.id, msg.message_id, res.text));
    return;
  }
  replyInGroup(bot, msg.chat.id, msg.message_id, res.text);
}

// ───────────── Developer menu ─────────────

const statusLabel = (status: string) => (status === 'open' ? '🟢 مفتوح' : '⛔ متوقف');

async function homeView(bot: TelegramBot) {
  const [list, req] = await Promise.all([recentGiveaways(6), requiredWithRights(bot)]);
  const lines = [
    '🎁 <b>السحوبات</b>',
    '',
    `📢 قنوات الاشتراك الإجباري (الشرط 1): <b>${req.length}</b>${req.some((r) => !r.ok) ? ' ⚠️ البوت مو مشرف ببعضها' : ''}`,
    '',
    list.length ? '<b>آخر السحوبات:</b>' : 'ماكو سحوبات بعد.',
    ...list.map((g) => `#${g.seq} · ${esc(g.channelTitle)} · ${statusLabel(g.status)} · ${g.count} مشارك${g.winners.length ? ` · ${g.winners.length} فائز` : ''}`),
    '',
    '<b>سحب جديد:</b>',
    '1) انشر كليشة السحب بقناتك بنفسك (بالملصقات المميزة والاقتباسات).',
    '2) اضغط «➕ سحب جديد» وحوّل المنشور هنا (أو دز رابطه).',
    '3) البوت يضيف الأزرار وينشر رسالة «اكتب يوزرك» ويدزلك رابطها حتى تحطه بالشرط 3.',
  ];
  const rows: Btn[][] = [
    [{ text: '➕ سحب جديد', callback_data: 'gwa:new', style: 'success' }],
    [{ text: '📢 قنوات الاشتراك الإجباري', callback_data: 'gwa:ch', style: 'primary' }],
    ...list.map((g) => [{ text: `#${g.seq} · ${statusLabel(g.status)} · ${g.count} مشارك`, callback_data: `gwa:g:${g.seq}` }]),
    [{ text: '🔄 تحديث', callback_data: 'gwa:home' }],
  ];
  return { text: lines.join('\n'), markup: kb(rows) };
}

async function channelsView(bot: TelegramBot) {
  const req = await requiredWithRights(bot);
  const lines = [
    '📢 <b>قنوات الاشتراك الإجباري</b> (الشرط 1)',
    '',
    req.length ? req.map((r) => `${r.ok ? '✅' : '❌'} ${r.chat.username ? `@${esc(r.chat.username)}` : esc(r.chat.title)}${r.ok ? '' : ` — ${r.why}`}`).join('\n') : 'ماكو قنوات بعد.',
    '',
    'لازم البوت يكون <b>مشرف</b> بكل قناة حتى يكدر يشوف منو مشترك.',
  ];
  const rows: Btn[][] = [
    ...req.map((r) => [{ text: `🗑 حذف ${r.chat.username ? `@${r.chat.username}` : r.chat.title}`, callback_data: `gwa:rm:${r.chat.chatId}`, style: 'danger' as const }]),
    [{ text: '➕ إضافة قناة', callback_data: 'gwa:add', style: 'success' }, { text: '🔄 إعادة الفحص', callback_data: 'gwa:ch', style: 'primary' }],
    [{ text: '↩ رجوع', callback_data: 'gwa:home' }],
  ];
  return { text: lines.join('\n'), markup: kb(rows) };
}

const winnersLines = (winners: GiveawayWinner[]) =>
  [...winners].sort((a, b) => a.place - b.place).map((w) => `${w.place}- ${esc(w.name)}${w.username ? ` (@${esc(w.username)})` : ''} · #${w.number} · <code>${w.telegramId}</code>`);

async function giveawayView(bot: TelegramBot, seq: number) {
  const g = await giveawayBySeq(seq);
  if (!g) return { text: 'هذا السحب غير موجود.', markup: kb([[{ text: '↩ رجوع', callback_data: 'gwa:home' }]]) };
  const rights = await giveawayRights(bot, g.channelId, g.discussionId);
  const lines = [
    `🎁 <b>سحب #${g.seq}</b> · ${esc(g.channelTitle)}`,
    '',
    `الحالة: ${g.status === 'open' ? '🟢 الانضمام مفتوح' : '⛔ الانضمام متوقف'}`,
    `👥 المشاركين: <b>${g.count}</b>`,
    `🔗 <a href="${postLink(g, g.postId)}">منشور السحب</a>${g.usernamePostId ? ` · <a href="${postLink(g, g.usernamePostId)}">رسالة اكتب يوزرك</a>` : ''}`,
    '',
    g.winners.length ? `<b>الفائزين:</b>\n${winnersLines(g.winners).join('\n')}` : 'ماكو فائزين بعد.',
    '',
    '<b>صلاحيات البوت:</b>',
    rightsText(rights),
  ];
  const rows: Btn[][] = [
    [
      { text: g.status === 'open' ? '⛔ إيقاف الانضمام' : '▶️ تشغيل الانضمام', callback_data: `gwa:s:${g.seq}`, style: 'primary' },
      { text: '🎲 سحب فائز', callback_data: `gwa:d:${g.seq}`, style: g.status === 'open' ? 'danger' : 'success' },
    ],
    ...[...g.winners]
      .sort((a, b) => a.place - b.place)
      .map((w) => [{ text: `❌ استبعاد ${w.place}- ${w.name} وسحب بداله`, callback_data: `gwx:${g.seq}:${w.place}`, style: 'danger' as const }]),
    [{ text: '🔄 إعادة الفحص', callback_data: `gwa:g:${g.seq}` }, { text: '🔁 إعادة الأزرار', callback_data: `gwa:k:${g.seq}` }],
    [{ text: '↩ رجوع', callback_data: 'gwa:home' }],
  ];
  return { text: lines.join('\n'), markup: kb(rows) };
}

function rightsFailView(rights: RightsLine[]) {
  return {
    text: [
      '⚠️ <b>البوت بعده ما يكدر يشغّل هذا السحب:</b>',
      '',
      rightsText(rights),
      '',
      '• قناة السحب: البوت مشرف ويكدر ينشر ويعدّل رسائل الآخرين.',
      '• كروب التعليقات (المربوط بالقناة): البوت مشرف حتى يقرا التعليقات.',
      '• قنوات الاشتراك: البوت مشرف بكل وحدة.',
      '',
      'صلّحها وبعدين اضغط «🔄 إعادة الفحص».',
    ].join('\n'),
    markup: kb([[{ text: '🔄 إعادة الفحص', callback_data: 'gwa:retry', style: 'primary' }], [{ text: '↩ رجوع', callback_data: 'gwa:home' }]]),
  };
}

async function show(bot: TelegramBot, chatId: number, view: { text: string; markup: TelegramBot.InlineKeyboardMarkup }, editId?: number) {
  if (editId) {
    try {
      await bot.editMessageText(view.text, { chat_id: chatId, message_id: editId, reply_markup: view.markup, ...html });
      return;
    } catch (err) {
      if (String((err as Error).message).includes('not modified')) return;
    }
  }
  await bot.sendMessage(chatId, view.text, { reply_markup: view.markup, ...html });
}

/** The developer forwarded (or linked) a channel post: make it a giveaway. */
async function tryCreate(bot: TelegramBot, chatId: number, adminId: number, post: { channelId: number; messageId: number }) {
  const res = await createGiveaway(bot, adminId, post.channelId, post.messageId);
  if (!res.ok) {
    if ('rights' in res && res.rights) {
      retryPost.set(adminId, post);
      await show(bot, chatId, rightsFailView(res.rights));
    } else {
      await bot.sendMessage(chatId, `⚠️ ${res.error}`);
    }
    return;
  }
  retryPost.delete(adminId);
  const g = res.giveaway;
  const usernameLink = g.usernamePostId ? postLink(g, g.usernamePostId) : null;
  await bot.sendMessage(
    chatId,
    [
      `✅ <b>تم! صار سحب #${g.seq}</b>`,
      '',
      `🔗 <a href="${postLink(g, g.postId)}">منشور السحب</a> (انضافت الأزرار عليه)`,
      usernameLink
        ? `✍️ رسالة «اكتب يوزرك»: ${usernameLink}\n\nحط هذا الرابط بالكليشة بالشرط 3 (عدّل منشور السحب من القناة). تكدر تعدّل الكليشة ورسالة «اكتب يوزرك» بأي وقت.`
        : '⚠️ ما كدرت أنشر رسالة «اكتب يوزرك».',
    ].join('\n'),
    { reply_markup: kb([[{ text: '⚙️ إدارة السحب', callback_data: `gwa:g:${g.seq}`, style: 'primary' }]]), ...html }
  );
}

// ───────────── The boost links (/start gwb_… and gwr_…) ─────────────

/** Handles /start gwb_<seq> (my boost link) and gwr_<seq>_<referrer> (came through a link). */
export async function handleGiveawayStart(bot: TelegramBot, chatId: number, from: TelegramBot.User, param: string): Promise<boolean> {
  const boost = param.match(/^gwb_(\d+)$/);
  if (boost) {
    const v = await boostMessage(Number(boost[1]), from.id);
    const rows: Btn[][] = [];
    if (v.link) rows.push([{ text: '📤 مشاركة رابطي', url: `https://t.me/share/url?url=${encodeURIComponent(v.link)}&text=${encodeURIComponent('🎁 ادخل السحب من رابطي!')}`, style: 'success' }]);
    if (v.post) rows.push([{ text: '🎁 منشور السحب', url: v.post }]);
    await bot.sendMessage(chatId, v.text, { reply_markup: kb(rows), ...html });
    return true;
  }
  const ref = param.match(/^gwr_(\d+)_(\d+)$/);
  if (ref) {
    const { g } = await recordReferral(Number(ref[1]), Number(ref[2]), from.id);
    if (!g) {
      await bot.sendMessage(chatId, 'هذا السحب غير موجود.');
      return true;
    }
    const rows: Btn[][] = [[{ text: '🎁 منشور السحب', url: postLink(g, g.postId), style: 'success' }]];
    if (g.usernamePostId) rows.push([{ text: '✍️ اكتب يوزرك هنا (الشرط 3)', url: postLink(g, g.usernamePostId) }]);
    await bot.sendMessage(
      chatId,
      [
        `🎁 <b>أهلاً بيك بسحب #${g.seq}</b>`,
        '',
        '✅ فعّلت البوت.',
        'هسه طبّق الشروط المكتوبة بمنشور السحب، واكتب يوزرك بتعليقات رسالة «اكتب يوزرك»، وبعدين اضغط «انقر للانضمام» 👇',
        g.status === 'open' ? '' : '\n⛔ الانضمام لهذا السحب متوقف حالياً.',
      ].join('\n'),
      { reply_markup: kb(rows), ...html }
    );
    return true;
  }
  return false;
}

// ───────────── Wiring ─────────────

export function registerGiveawayActions(bot: TelegramBot) {
  // Developer menu.
  bot.on('message', async (msg) => {
    const text = msg.text?.trim() ?? '';
    const from = msg.from;
    if (!from || from.is_bot || msg.chat.type !== 'private') return;
    try {
      if (/^[/.](سحب|السحوبات|giveaway)(@\w+)?$/u.test(text)) {
        if (!(await getAdminRole(from.id))) {
          await bot.sendMessage(msg.chat.id, '🚫 هذا الأمر للمطورين فقط.');
          return;
        }
        pending.delete(from.id);
        await show(bot, msg.chat.id, await homeView(bot));
        return;
      }
      const wait = pending.get(from.id);
      if (!wait) return;
      if (/^[/.]/.test(text)) return void pending.delete(from.id); // another command: drop the question
      if (!(await getAdminRole(from.id))) return;
      if (wait.kind === 'post') {
        let post = forwardedChannelPost(msg);
        if (!post && text) {
          const link = parsePostLink(text);
          if (link) {
            let channelId = link.channelId;
            if (!channelId && link.username) channelId = (await bot.getChat(`@${link.username}`).catch(() => null))?.id;
            if (channelId) post = { channelId, messageId: link.messageId };
          }
        }
        if (!post) {
          await bot.sendMessage(msg.chat.id, 'حوّلي منشور السحب من القناة، أو دزلي رابطه (مثل https://t.me/channel/123).');
          return;
        }
        pending.delete(from.id);
        await tryCreate(bot, msg.chat.id, from.id, post);
        return;
      }
      if (wait.kind === 'chan') {
        const fwd = forwardedChannelPost(msg);
        const input = fwd ? fwd.channelId : text;
        if (!input) return;
        pending.delete(from.id);
        try {
          const chat = await addRequiredChat(bot, input);
          await bot.sendMessage(msg.chat.id, `✅ انضافت: ${chat.username ? `@${chat.username}` : chat.title}`);
        } catch (err) {
          await bot.sendMessage(msg.chat.id, `⚠️ ${(err as Error).message}`);
        }
        await show(bot, msg.chat.id, await channelsView(bot));
      }
    } catch (err) {
      logger.warn({ err }, 'giveaway admin message failed');
    }
  });

  // Comments under "write your username" (the channel's comments group).
  bot.on('message', async (msg) => {
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    const m = msg as TelegramBot.Message & { message_thread_id?: number; is_automatic_forward?: boolean };
    if (!m.reply_to_message && !m.message_thread_id && !m.is_automatic_forward) return;
    try {
      if (!(await isGiveawayGroup(msg.chat.id))) return;
      // The group's copy of a channel post: the comment thread of "write your username" starts here.
      if (m.is_automatic_forward) return void (await rememberUsernameThread(m));
      const res = await verifyComment(m);
      if (res) answerComment(bot, msg, res);
    } catch (err) {
      logger.warn({ err }, 'giveaway comment check failed');
    }
  });

  bot.on('callback_query', async (query) => {
    const data = query.data ?? '';
    if (!data.startsWith('gw')) return;
    const from = query.from;
    const alert = (text: string) => bot.answerCallbackQuery(query.id, { text: text.slice(0, 200), show_alert: true }).catch(() => undefined);
    try {
      // Buttons on the channel post.
      let m = data.match(/^gw:([jcsdn]):(\d+)$/);
      if (m) {
        const seq = Number(m[2]);
        if (m[1] === 'j') return void (await alert(await joinGiveaway(bot, seq, from)));
        if (m[1] === 'c') {
          const g = await giveawayBySeq(seq);
          return void (await alert(`عدد المنضمين: ${g?.count ?? 0}`));
        }
        if (!(await getAdminRole(from.id))) return void (await alert('هذا الزر للمطور فقط 🔒'));
        if (m[1] === 's') return void (await alert(await toggleJoining(bot, seq)));
        const res = await drawNext(bot, seq);
        await alert(res.text);
        if (res.winner && res.g) {
          // The details (and "exclude") go to the developer privately.
          bot
            .sendMessage(
              from.id,
              `🏆 <b>سحب #${seq}</b> · الفائز رقم ${res.winner.place}\n${winnersLines([res.winner]).join('\n')}\n\nإذا ما طبق الشرط 2 (التوجيه لـ +10)، استبعده ونسحب بداله:`,
              {
                reply_markup: kb([[{ text: `❌ استبعاد وسحب بداله`, callback_data: `gwx:${seq}:${res.winner.place}`, style: 'danger' }]]),
                ...html,
              }
            )
            .catch(() => undefined);
        }
        return;
      }
      // Exclude a winner and draw again for that place (from the developer's chat).
      m = data.match(/^gwx:(\d+):(\d+)$/);
      if (m) {
        if (!(await getAdminRole(from.id))) return void (await alert('هذا الزر للمطور فقط 🔒'));
        const res = await replaceWinner(bot, Number(m[1]), Number(m[2]));
        await alert(res.text);
        if (query.message && query.message.chat.type === 'private' && res.winner) {
          await bot
            .sendMessage(query.message.chat.id, `🔁 <b>سحب #${m[1]}</b> · الفائز رقم ${res.winner.place} الجديد\n${winnersLines([res.winner]).join('\n')}`, {
              reply_markup: kb([[{ text: `❌ استبعاد وسحب بداله`, callback_data: `gwx:${m[1]}:${res.winner.place}`, style: 'danger' }]]),
              ...html,
            })
            .catch(() => undefined);
        }
        return;
      }
      // The developer menu.
      m = data.match(/^gwa:(\w+)(?::(.+))?$/);
      if (!m) return;
      if (!(await getAdminRole(from.id))) return void (await alert('هذا للمطورين فقط 🔒'));
      const chatId = query.message?.chat.id ?? from.id;
      const editId = query.message?.message_id;
      const [, action, arg] = m;
      await bot.answerCallbackQuery(query.id).catch(() => undefined);
      if (action === 'home') return void (await show(bot, chatId, await homeView(bot), editId));
      if (action === 'ch') return void (await show(bot, chatId, await channelsView(bot), editId));
      if (action === 'new') {
        pending.set(from.id, { kind: 'post' });
        await bot.sendMessage(
          chatId,
          '📩 حوّلي منشور السحب هنا من قناتك (أو دز رابطه).\n\nانشره بالقناة بنفسك أول، بالملصقات المميزة والاقتباسات اللي تريدها، وتكدر تعدّله بعدين من القناة.'
        );
        return;
      }
      if (action === 'add') {
        pending.set(from.id, { kind: 'chan' });
        await bot.sendMessage(chatId, '📢 دز معرف القناة (مثل @mfbisnes) أو رابطها، أو حوّل منشور منها.\nوارفع البوت مشرف بيها.');
        return;
      }
      if (action === 'rm' && arg) {
        await removeRequiredChat(arg);
        return void (await show(bot, chatId, await channelsView(bot), editId));
      }
      if (action === 'retry') {
        const post = retryPost.get(from.id);
        if (!post) return void (await show(bot, chatId, await homeView(bot), editId));
        return void (await tryCreate(bot, chatId, from.id, post));
      }
      const seq = Number(arg);
      if (action === 'g') return void (await show(bot, chatId, await giveawayView(bot, seq), editId));
      if (action === 's') {
        await toggleJoining(bot, seq);
        return void (await show(bot, chatId, await giveawayView(bot, seq), editId));
      }
      if (action === 'k') {
        const g = await giveawayBySeq(seq);
        if (g) await applyKeyboard(bot, g);
        return void (await show(bot, chatId, await giveawayView(bot, seq), editId));
      }
      if (action === 'd') {
        const res = await drawNext(bot, seq);
        await bot.sendMessage(chatId, res.text).catch(() => undefined);
        return void (await show(bot, chatId, await giveawayView(bot, seq)));
      }
    } catch (err) {
      logger.warn({ err, data }, 'giveaway button failed');
      await alert('صار خطأ، حاول مرة ثانية');
    }
  });
}
