import mongoose, { HydratedDocument, Types } from 'mongoose';
import type TelegramBot from 'node-telegram-bot-api';
import { IUser, User } from '../models/User';
import { getSettings } from '../models/Settings';
import { IMediationTicket, MediationTicket, OPEN_MEDIATION_STATUSES } from '../models/MediationTicket';
import { ExchangeListing } from '../models/ExchangeListing';
import { nextSequence } from '../models/Counter';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
import { pick, t, userLang } from '../i18n';
import { exchangeAllowed } from './exchange.service';

/** Both sides must ask to join the mediation group within this time. */
export const MEDIATION_JOIN_WINDOW_MS = 15 * 60 * 1000;
/** What the middleman types in the group to finish a ticket. */
const COMPLETE_WORDS = new Set(['م', 'م2']);

let botRef: TelegramBot | null = null;
export function attachMediationBot(bot: TelegramBot) {
  botRef = bot;
}

async function assertAllowed(adminRole: string | null) {
  const settings = await getSettings();
  if (!exchangeAllowed(settings, adminRole)) throw new AppError(t('قريباً', 'Coming soon'), 403, 'EXCHANGE_COMING_SOON');
  if (!settings.mediationGroupLink || !settings.mediationChatId) {
    throw new AppError(t('الوساطة غير مفعّلة حالياً، حاول لاحقاً', 'Mediation is not available right now, try later'), 503, 'MEDIATION_OFF');
  }
  return settings;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mention(p: { telegramId: number; username?: string | null; name?: string | null }) {
  return p.username ? `@${p.username}` : `<a href="tg://user?id=${p.telegramId}">${escapeHtml(p.name || String(p.telegramId))}</a>`;
}

function plainName(p: { telegramId: number; username?: string | null; name?: string | null }) {
  return p.username ? `@${p.username}` : p.name || String(p.telegramId);
}

function normalizeUsername(raw: unknown) {
  return String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '')
    .trim();
}

function ticketView(tk: IMediationTicket, me: number, link: string) {
  const mine = tk.requester.telegramId === me ? tk.requester : tk.partner;
  const other = tk.requester.telegramId === me ? tk.partner : tk.requester;
  return {
    id: String(tk._id),
    number: tk.number,
    status: tk.status,
    isRequester: tk.requester.telegramId === me,
    expiresAt: tk.expiresAt,
    groupLink: tk.status === 'waiting_join' ? link : null,
    me: { requested: Boolean(mine.requestedAt) },
    other: { name: plainName(other), requested: Boolean(other.requestedAt) },
    mediator: tk.mediatorTelegramId ? plainName({ telegramId: tk.mediatorTelegramId, username: tk.mediatorUsername, name: tk.mediatorName }) : null,
    createdAt: tk.createdAt,
  };
}

/** "Is your other side: <name>?" — the person must have opened the bot before. */
export async function lookupPartner(user: HydratedDocument<IUser>, adminRole: string | null, rawUsername: unknown) {
  await assertAllowed(adminRole);
  const username = normalizeUsername(rawUsername);
  if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) throw new AppError(t('اكتب يوزر صحيح مثل @username', 'Enter a valid username like @username'), 422, 'VALIDATION_ERROR');
  const partner = await User.findOne({ username: new RegExp(`^${username}$`, 'i') }).select('telegramId username firstName lastName photoUrl isBanned');
  if (!partner) {
    throw new AppError(
      t('هذا الشخص ما دخل البوت بعد. خليه يفتح البوت مرة وحدة وبعدها حاول.', "This person hasn't opened the bot yet. Ask them to open it once, then try again."),
      404,
      'PARTNER_NOT_FOUND'
    );
  }
  if (partner.telegramId === user.telegramId) throw new AppError(t('ما تگدر تطلب وسيط ويّا نفسك', "You can't request a middleman with yourself"), 422, 'VALIDATION_ERROR');
  if (partner.isBanned) throw new AppError(t('هذا الشخص محظور من البوت', 'This person is banned from the bot'), 422, 'PARTNER_BANNED');
  return {
    partner: {
      telegramId: partner.telegramId,
      username: partner.username ?? null,
      name: [partner.firstName, partner.lastName].filter(Boolean).join(' ') || null,
      photoUrl: partner.photoUrl ?? null,
    },
  };
}

async function findOpenTicketFor(telegramId: number) {
  return MediationTicket.findOne({
    status: { $in: OPEN_MEDIATION_STATUSES },
    $or: [{ 'requester.telegramId': telegramId }, { 'partner.telegramId': telegramId }],
  });
}

export async function createTicket(
  user: HydratedDocument<IUser>,
  adminRole: string | null,
  input: { username?: unknown; listingId?: unknown }
) {
  const settings = await assertAllowed(adminRole);
  const { partner } = await lookupPartner(user, adminRole, input.username);

  // Waiting tickets block a new one; a ticket a middleman already took doesn't.
  for (const [who, id] of [['me', user.telegramId], ['partner', partner.telegramId]] as const) {
    const open = await MediationTicket.findOne({
      status: { $in: ['waiting_join', 'waiting_mediator'] },
      $or: [{ 'requester.telegramId': id }, { 'partner.telegramId': id }],
    });
    if (open) {
      throw new AppError(
        who === 'me'
          ? t(`عندك تذكرة مفتوحة #${open.number}. كمّلها أو انتظر تنتهي.`, `You already have an open ticket #${open.number}. Finish it or wait for it to end.`)
          : t('طرفك عنده تذكرة وساطة مفتوحة حالياً، حاول بعدين.', 'The other side already has an open mediation ticket, try later.'),
        409,
        'TICKET_OPEN'
      );
    }
  }

  let listing: Types.ObjectId | null = null;
  if (input.listingId && mongoose.isValidObjectId(String(input.listingId))) {
    const l = await ExchangeListing.findById(String(input.listingId)).select('_id');
    listing = l ? (l._id as Types.ObjectId) : null;
  }
  const partnerDoc = await User.findOne({ telegramId: partner.telegramId }).select('_id language');
  const ticket = await MediationTicket.create({
    number: await nextSequence('mediationTicket'),
    requester: {
      user: user._id,
      telegramId: user.telegramId,
      username: user.username ?? null,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    },
    partner: { user: partnerDoc!._id, telegramId: partner.telegramId, username: partner.username, name: partner.name },
    listing,
    expiresAt: new Date(Date.now() + MEDIATION_JOIN_WINDOW_MS),
    chatId: settings.mediationChatId,
  });

  // The other side also hears it from the bot, in case the link takes a while to reach them.
  if (botRef) {
    const lang = userLang(partnerDoc);
    const text = pick(
      {
        ar:
          `🛡️ طلب وساطة جديد #${ticket.number}\n\n` +
          `${plainName(ticket.requester)} طلب وسيط من وسطاء MF للتبادل وياك.\n\n` +
          `👇 اطلب انضمام للكروب من هذا الرابط خلال 15 دقيقة، وراح يستلمكم وسيط:\n${settings.mediationGroupLink}\n\n` +
          `⚠️ إذا ما تعرف هذا الشخص أو ما متفقين على تبادل، تجاهل الرسالة.`,
        en:
          `🛡️ New mediation request #${ticket.number}\n\n` +
          `${plainName(ticket.requester)} asked an MF middleman to handle a trade with you.\n\n` +
          `👇 Request to join the group with this link within 15 minutes, and a middleman will take you:\n${settings.mediationGroupLink}\n\n` +
          `⚠️ If you don't know this person or haven't agreed to a trade, ignore this message.`,
      },
      lang
    );
    await botRef.sendMessage(partner.telegramId, text, { disable_web_page_preview: true }).catch(() => undefined);
  }
  return { ticket: ticketView(ticket, user.telegramId, settings.mediationGroupLink) };
}

export async function listMyTickets(user: HydratedDocument<IUser>, adminRole: string | null) {
  const settings = await getSettings();
  if (!exchangeAllowed(settings, adminRole)) throw new AppError(t('قريباً', 'Coming soon'), 403, 'EXCHANGE_COMING_SOON');
  const tickets = await MediationTicket.find({ $or: [{ 'requester.telegramId': user.telegramId }, { 'partner.telegramId': user.telegramId }] })
    .sort({ createdAt: -1 })
    .limit(10);
  return {
    enabled: Boolean(settings.mediationGroupLink && settings.mediationChatId),
    windowMinutes: MEDIATION_JOIN_WINDOW_MS / 60000,
    tickets: tickets.map((tk) => ticketView(tk, user.telegramId, settings.mediationGroupLink)),
  };
}

export async function cancelTicket(user: HydratedDocument<IUser>, ticketId: string) {
  if (!mongoose.isValidObjectId(ticketId)) throw new AppError('Ticket not found', 404, 'NOT_FOUND');
  const ticket = await MediationTicket.findOneAndUpdate(
    { _id: ticketId, 'requester.telegramId': user.telegramId, status: 'waiting_join' },
    { $set: { status: 'cancelled', closedAt: new Date() } },
    { new: true }
  );
  if (!ticket) throw new AppError(t('ما تگدر تلغي هذي التذكرة', "This ticket can't be cancelled"), 409, 'CANNOT_CANCEL');
  await declinePending(ticket);
  return { ok: true };
}

async function declinePending(ticket: IMediationTicket) {
  if (!botRef || !ticket.chatId) return;
  for (const p of [ticket.requester, ticket.partner]) {
    if (p.requestedAt) await botRef.declineChatJoinRequest(ticket.chatId, p.telegramId).catch(() => undefined);
  }
}

async function dm(telegramId: number, text: { ar: string; en: string }) {
  if (!botRef) return;
  const u = await User.findOne({ telegramId }).select('language').lean();
  await botRef.sendMessage(telegramId, pick(text, userLang(u)), { disable_web_page_preview: true }).catch(() => undefined);
}

/** Pings the group's middlemen (its human admins) with a "take ticket" button. */
async function announceToMediators(ticket: IMediationTicket) {
  if (!botRef || !ticket.chatId) return;
  let mediators = '';
  try {
    const admins = await botRef.getChatAdministrators(ticket.chatId);
    mediators = admins
      .filter((a) => !a.user.is_bot)
      .map((a) => mention({ telegramId: a.user.id, username: a.user.username, name: a.user.first_name }))
      .join(' ');
  } catch (err) {
    logger.warn({ err }, 'failed to list mediation group admins');
  }
  const listing = ticket.listing ? await ExchangeListing.findById(ticket.listing).select('details') : null;
  const text =
    `🛡️ <b>تذكرة وساطة #${ticket.number}</b>\n\n` +
    `👤 الطرف الأول: ${mention(ticket.requester)}\n` +
    `👤 الطرف الثاني: ${mention(ticket.partner)}\n` +
    (listing ? `📄 الحساب: ${escapeHtml(listing.details.slice(0, 120))}\n` : '') +
    `\nالطرفين طلبوا انضمام وينتظرون وسيط.\n` +
    (mediators ? `\n📣 ${mediators}` : '');
  const sent = await botRef
    .sendMessage(ticket.chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: `✋ استلام التذكرة #${ticket.number}`, callback_data: `med_take_${ticket._id}` }]] },
    })
    .catch((err) => {
      logger.warn({ err }, 'failed to post mediation ticket to the group');
      return null;
    });
  if (sent) await MediationTicket.updateOne({ _id: ticket._id }, { $set: { groupMessageId: sent.message_id } });
}

/** A join request reached the mediation group. Returns true when it belonged to a ticket. */
export async function handleJoinRequest(req: TelegramBot.ChatJoinRequest) {
  const settings = await getSettings();
  if (!settings.mediationChatId || req.chat.id !== settings.mediationChatId) return false;
  const userId = req.from.id;
  const now = new Date();
  const base = { status: 'waiting_join' as const, expiresAt: { $gt: now } };
  let ticket =
    (await MediationTicket.findOneAndUpdate({ ...base, 'requester.telegramId': userId }, { $set: { 'requester.requestedAt': now } }, { new: true })) ??
    (await MediationTicket.findOneAndUpdate({ ...base, 'partner.telegramId': userId }, { $set: { 'partner.requestedAt': now } }, { new: true }));
  if (!ticket) return false;

  if (ticket.requester.requestedAt && ticket.partner.requestedAt) {
    ticket = await MediationTicket.findOneAndUpdate({ _id: ticket._id, status: 'waiting_join' }, { $set: { status: 'waiting_mediator' } }, { new: true });
    if (!ticket) return true;
    await announceToMediators(ticket);
    for (const p of [ticket.requester, ticket.partner]) {
      await dm(p.telegramId, {
        ar: `✅ الطرفين طلبوا انضمام للتذكرة #${ticket.number}.\nتم تنبيه الوسطاء، أول وسيط يستلمها راح يقبلكم بالكروب.`,
        en: `✅ Both sides asked to join for ticket #${ticket.number}.\nThe middlemen were notified; the first to take it will let you into the group.`,
      });
    }
  } else {
    const other = ticket.requester.telegramId === userId ? ticket.partner : ticket.requester;
    await dm(userId, {
      ar: `📨 وصل طلب انضمامك للتذكرة #${ticket.number}.\nننتظر ${plainName(other)} يطلب انضمام هم. إذا ما طلب خلال 15 دقيقة من فتح التذكرة تنلغي.`,
      en: `📨 Your join request for ticket #${ticket.number} arrived.\nWaiting for ${plainName(other)} to ask too. If they don't within 15 minutes of opening, the ticket is cancelled.`,
    });
  }
  return true;
}

/** A middleman pressed "take ticket" in the mediation group. */
export async function takeTicket(ticketId: string, mediator: TelegramBot.User, chatId: number) {
  if (!botRef || !mongoose.isValidObjectId(ticketId)) return { error: 'التذكرة غير موجودة' };
  const member = await botRef.getChatMember(chatId, mediator.id).catch(() => null);
  if (!member || !['administrator', 'creator'].includes(member.status)) return { error: '🚫 استلام التذاكر للوسطاء فقط' };

  const ticket = await MediationTicket.findOneAndUpdate(
    { _id: ticketId, status: 'waiting_mediator' },
    {
      $set: {
        status: 'in_progress',
        mediatorTelegramId: mediator.id,
        mediatorUsername: mediator.username ?? null,
        mediatorName: mediator.first_name ?? null,
        takenAt: new Date(),
      },
    },
    { new: true }
  );
  if (!ticket) return { error: 'هذي التذكرة استلمها وسيط ثاني أو انتهت' };

  for (const p of [ticket.requester, ticket.partner]) {
    await botRef.approveChatJoinRequest(chatId, p.telegramId).catch((err) => logger.warn({ err, ticket: ticket.number }, 'failed to approve join request'));
  }
  const med = { telegramId: mediator.id, username: mediator.username, name: mediator.first_name };
  await botRef
    .sendMessage(
      chatId,
      `🤝 <b>التذكرة #${ticket.number}</b>\n\n` +
        `${mention(ticket.requester)} و ${mention(ticket.partner)}\n` +
        `راح يتوسطلكم: ${mention(med)}\n\n` +
        `📌 على الوسيط كتابة الآتي:\n<b>ش</b>\n\nوبعد إكمال التبادل يكتب:\n<b>م</b> أو <b>م2</b>`,
      { parse_mode: 'HTML', disable_web_page_preview: true }
    )
    .catch((err) => logger.warn({ err }, 'failed to post mediator assignment'));
  for (const p of [ticket.requester, ticket.partner]) {
    await dm(p.telegramId, {
      ar: `🤝 الوسيط ${plainName(med)} استلم تذكرتك #${ticket.number} وتم قبولكم بالكروب.\nتعامل وياه داخل الكروب فقط، ولا تثق بأي شخص يراسلك بالخاص باسم الوسيط.`,
      en: `🤝 Middleman ${plainName(med)} took your ticket #${ticket.number} and you're in the group.\nDeal with them inside the group only; don't trust anyone messaging you privately in their name.`,
    });
  }
  return { ticket };
}

/** The middleman typed "م" / "م2" in the group: their latest ticket there is done. */
export async function completeByMediatorMessage(chatId: number, mediatorId: number, text: string) {
  if (!COMPLETE_WORDS.has(text.trim())) return null;
  const settings = await getSettings();
  if (!settings.mediationChatId || chatId !== settings.mediationChatId) return null;
  return MediationTicket.findOneAndUpdate(
    { chatId, mediatorTelegramId: mediatorId, status: 'in_progress' },
    { $set: { status: 'completed', completedAt: new Date(), closedAt: new Date() } },
    { sort: { takenAt: -1 }, new: true }
  );
}

/** Tickets where someone didn't ask to join within 15 minutes are cancelled. */
export async function expireMediationTickets(now = new Date()) {
  const due = await MediationTicket.find({ status: 'waiting_join', expiresAt: { $lte: now } }).limit(100);
  for (const tk of due) {
    const res = await MediationTicket.updateOne({ _id: tk._id, status: 'waiting_join' }, { $set: { status: 'expired', closedAt: now } });
    if (res.modifiedCount === 0) continue;
    await declinePending(tk);
    const missing = [tk.requester, tk.partner].filter((p) => !p.requestedAt).map(plainName).join(' و ');
    for (const p of [tk.requester, tk.partner]) {
      await dm(p.telegramId, {
        ar: `⏰ انتهى وقت التذكرة #${tk.number} وتم إلغاؤها لأن ${missing} ما طلب انضمام خلال 15 دقيقة.\nتگدر تطلب وسيط من جديد من قسم الوساطة.`,
        en: `⏰ Ticket #${tk.number} expired and was cancelled because ${missing} didn't ask to join within 15 minutes.\nYou can request a middleman again from the mediation section.`,
      });
    }
  }
  return due.length;
}

/** /setmediation sent inside a group by a developer links that group. */
export async function linkMediationGroup(chatId: number) {
  const settings = await getSettings();
  settings.mediationChatId = chatId;
  await settings.save();
  return settings;
}

export async function getMediationAdminStats() {
  const since = new Date(Date.now() - 7 * 24 * 3600e3);
  const [open, completed, completedWeek, expired] = await Promise.all([
    MediationTicket.countDocuments({ status: { $in: OPEN_MEDIATION_STATUSES } }),
    MediationTicket.countDocuments({ status: 'completed' }),
    MediationTicket.countDocuments({ status: 'completed', completedAt: { $gte: since } }),
    MediationTicket.countDocuments({ status: 'expired' }),
  ]);
  const top = await MediationTicket.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: '$mediatorTelegramId', username: { $last: '$mediatorUsername' }, name: { $last: '$mediatorName' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);
  return {
    open,
    completed,
    completedWeek,
    expired,
    topMediators: top.map((m) => ({ telegramId: m._id, name: m.username ? '@' + m.username : m.name || String(m._id), count: m.count })),
  };
}
