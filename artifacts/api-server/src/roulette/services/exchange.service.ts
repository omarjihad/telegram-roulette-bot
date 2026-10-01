import mongoose, { HydratedDocument, Types } from 'mongoose';
import type TelegramBot from 'node-telegram-bot-api';
import { IUser, User } from '../models/User';
import { getSettings, ISettings } from '../models/Settings';
import { EXCHANGE_CURRENCIES, ExchangeCurrency, ExchangeListing, ExchangeMode, IExchangeListing } from '../models/ExchangeListing';
import { ExchangeImage } from '../models/ExchangeImage';
import { ExchangeReport, REPORT_REASONS, ReportReason } from '../models/ExchangeReport';
import { writeAudit } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { t } from '../i18n';
import { listAllAdminTelegramIds } from './admin.service';
import { banUser } from './ban.service';
import { createNotification } from './notification.service';

export const MAX_LISTING_IMAGES = 7;
/** Active listings one member may have at a time (developers get more room for testing). */
export const MAX_ACTIVE_LISTINGS = 5;
const MAX_ACTIVE_LISTINGS_ADMIN = 20;
const PAGE_SIZE = 20;
const MAX_PRICE = 100_000_000;

export type ExchangeSection = 'trade' | 'buy';

/** Arabic labels used in the developers' bot messages. */
const REASON_AR: Record<ReportReason, string> = {
  scammer: 'سرّاق / نصّاب',
  no_middleman: 'لا يقبل وسيط',
  not_owner: 'ليس حسابه',
  fake_info: 'معلومات أو صور مزيفة',
  other: 'سبب آخر',
};
const MODE_AR: Record<ExchangeMode, string> = { trade: 'تبديل فقط', sell: 'بيع', both: 'يقبل بدل وبيع' };

export function exchangeAllowed(settings: Pick<ISettings, 'exchangePublic'>, adminRole: string | null) {
  return settings.exchangePublic || adminRole !== null;
}

async function assertAllowed(adminRole: string | null) {
  const settings = await getSettings();
  if (!exchangeAllowed(settings, adminRole)) throw new AppError(t('قريباً', 'Coming soon'), 403, 'EXCHANGE_COMING_SOON');
  return settings;
}

function parseObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(t('المنشور غير موجود', 'Post not found'), 404, 'NOT_FOUND');
  return new Types.ObjectId(id);
}

export function exchangeImageUrl(id: Types.ObjectId | string) {
  return `/api/exchange/images/${String(id)}`;
}

export function profileLink(p: { username?: string | null; telegramId: number }) {
  return p.username ? `https://t.me/${p.username}` : `tg://user?id=${p.telegramId}`;
}

/** Deep link that opens the Mini App straight on a listing (used in the developers' report alerts). */
export function buildListingLink(listingId: string) {
  if (!env.BOT_USERNAME) return null;
  return env.MINI_APP_SHORT_NAME
    ? `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=listing_${listingId}`
    : `https://t.me/${env.BOT_USERNAME}?start=listing_${listingId}`;
}

function sectionModes(section: ExchangeSection): ExchangeMode[] {
  return section === 'trade' ? ['trade', 'both'] : ['sell', 'both'];
}

function summary(l: IExchangeListing) {
  return {
    id: String(l._id),
    mode: l.mode,
    details: l.details.length > 160 ? l.details.slice(0, 160) + '…' : l.details,
    price: l.price,
    currency: l.currency,
    pinned: l.pinned,
    status: l.status,
    coverUrl: l.images[0] ? exchangeImageUrl(l.images[0]) : null,
    imageCount: l.images.length,
    ownerName: l.ownerUsername ? '@' + l.ownerUsername : l.ownerName || null,
    createdAt: l.createdAt,
  };
}

export async function getExchangeStatus(user: HydratedDocument<IUser>, adminRole: string | null) {
  const settings = await getSettings();
  const myActive = await ExchangeListing.countDocuments({ ownerTelegramId: user.telegramId, status: 'active' });
  return {
    allowed: exchangeAllowed(settings, adminRole),
    comingSoon: !settings.exchangePublic,
    isAdmin: adminRole !== null,
    middlemanGroup: settings.exchangeMiddlemanGroup || 'MF_MMMM',
    currencies: EXCHANGE_CURRENCIES,
    reasons: REPORT_REASONS,
    maxImages: MAX_LISTING_IMAGES,
    maxActive: adminRole ? MAX_ACTIVE_LISTINGS_ADMIN : MAX_ACTIVE_LISTINGS,
    myActive,
  };
}

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

export async function createListing(
  user: HydratedDocument<IUser>,
  adminRole: string | null,
  input: { mode?: unknown; details?: unknown; price?: unknown; currency?: unknown },
  files: UploadedFile[]
) {
  await assertAllowed(adminRole);
  const mode = String(input.mode ?? '') as ExchangeMode;
  if (!['trade', 'sell', 'both'].includes(mode)) {
    throw new AppError(t('اختر مكان عرض الحساب', 'Choose where to show the account'), 422, 'VALIDATION_ERROR');
  }
  const details = String(input.details ?? '').trim();
  if (details.length < 10) throw new AppError(t('اكتب تفاصيل الحساب (10 أحرف على الأقل)', 'Write the account details (at least 10 characters)'), 422, 'VALIDATION_ERROR');
  if (details.length > 1500) throw new AppError(t('التفاصيل طويلة جداً (1500 حرف كحد أقصى)', 'Details are too long (1500 characters max)'), 422, 'VALIDATION_ERROR');

  let price: number | null = null;
  let currency: ExchangeCurrency | null = null;
  if (mode !== 'trade') {
    price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      throw new AppError(t('اكتب سعراً صحيحاً', 'Enter a valid price'), 422, 'VALIDATION_ERROR');
    }
    price = Math.round(price * 100) / 100;
    currency = String(input.currency ?? '') as ExchangeCurrency;
    if (!EXCHANGE_CURRENCIES.includes(currency)) throw new AppError(t('اختر العملة', 'Choose the currency'), 422, 'VALIDATION_ERROR');
  }
  if (files.length === 0) throw new AppError(t('أضف صورة واحدة على الأقل للحساب', 'Add at least one photo of the account'), 422, 'VALIDATION_ERROR');
  if (files.length > MAX_LISTING_IMAGES) throw new AppError(t('7 صور كحد أقصى', '7 photos at most'), 422, 'VALIDATION_ERROR');

  const limit = adminRole ? MAX_ACTIVE_LISTINGS_ADMIN : MAX_ACTIVE_LISTINGS;
  const active = await ExchangeListing.countDocuments({ ownerTelegramId: user.telegramId, status: 'active' });
  if (active >= limit) {
    throw new AppError(
      t(`عندك ${limit} منشورات معروضة. احذف منشوراً قديماً أولاً`, `You already have ${limit} active posts. Delete an old one first`),
      409,
      'EXCHANGE_LIMIT'
    );
  }

  const images = await ExchangeImage.insertMany(
    files.map((f) => ({ ownerTelegramId: user.telegramId, data: f.buffer, mimeType: f.mimetype, size: f.size }))
  );
  const listing = await ExchangeListing.create({
    owner: user._id,
    ownerTelegramId: user.telegramId,
    ownerUsername: user.username ?? null,
    ownerName: user.firstName ?? null,
    mode,
    details,
    price,
    currency,
    images: images.map((i) => i._id),
  });
  return { listing: summary(listing) };
}

export async function listListings(adminRole: string | null, section: string, page = 1) {
  await assertAllowed(adminRole);
  if (section !== 'trade' && section !== 'buy') throw new AppError('section must be trade or buy', 422, 'VALIDATION_ERROR');
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const filter = { status: 'active' as const, mode: { $in: sectionModes(section) } };
  const [items, total] = await Promise.all([
    ExchangeListing.find(filter).sort({ pinned: -1, pinnedAt: -1, createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    ExchangeListing.countDocuments(filter),
  ]);
  return { items: items.map(summary), page: p, hasMore: p * PAGE_SIZE < total, total };
}

export async function listMyListings(user: HydratedDocument<IUser>, adminRole: string | null) {
  await assertAllowed(adminRole);
  const items = await ExchangeListing.find({ ownerTelegramId: user.telegramId, status: 'active' }).sort({ createdAt: -1 });
  return { items: items.map(summary) };
}

export async function getListing(user: HydratedDocument<IUser>, adminRole: string | null, id: string) {
  await assertAllowed(adminRole);
  const listing = await ExchangeListing.findById(parseObjectId(id));
  const isAdmin = adminRole !== null;
  if (!listing || (listing.status !== 'active' && !isAdmin)) {
    throw new AppError(t('هذا المنشور لم يعد موجوداً', 'This post no longer exists'), 404, 'NOT_FOUND');
  }
  const isMine = listing.ownerTelegramId === user.telegramId;
  return {
    listing: {
      ...summary(listing),
      details: listing.details,
      images: listing.images.map(exchangeImageUrl),
      owner: {
        telegramId: listing.ownerTelegramId,
        username: listing.ownerUsername ?? null,
        name: listing.ownerName ?? null,
        profileLink: profileLink({ username: listing.ownerUsername, telegramId: listing.ownerTelegramId }),
      },
      isMine,
      canModerate: isAdmin,
      reportsCount: isAdmin ? listing.reportsCount : undefined,
    },
  };
}

/** Removes a listing (its owner, or a developer). Photos are deleted with it. */
export async function removeListing(
  listingId: string,
  actor: { telegramId: number; username?: string | null; isAdmin: boolean },
  reason?: string
) {
  const listing = await ExchangeListing.findById(parseObjectId(listingId));
  if (!listing || listing.status !== 'active') {
    throw new AppError(t('هذا المنشور محذوف مسبقاً', 'This post is already deleted'), 404, 'NOT_FOUND');
  }
  const isOwner = listing.ownerTelegramId === actor.telegramId;
  if (!isOwner && !actor.isAdmin) throw new AppError(t('لا يمكنك حذف هذا المنشور', "You can't delete this post"), 403, 'FORBIDDEN');

  listing.status = 'removed';
  listing.pinned = false;
  listing.removedAt = new Date();
  listing.removedByTelegramId = actor.telegramId;
  await listing.save();
  await ExchangeImage.deleteMany({ _id: { $in: listing.images } });

  if (!isOwner) {
    await writeAudit({
      actorId: actor.telegramId,
      actorUsername: actor.username ?? undefined,
      action: 'exchange.remove',
      target: String(listing._id),
      metadata: { owner: listing.ownerTelegramId, reason },
    });
    await createNotification({
      userId: listing.owner,
      telegramId: listing.ownerTelegramId,
      type: 'system_announcement',
      title: { ar: '🗑️ تم حذف منشورك من قسم التبادل', en: '🗑️ Your exchange post was removed' },
      body: {
        ar: 'قامت الإدارة بحذف منشورك لأنه يخالف شروط قسم التبادل.' + (reason ? `\nالسبب: ${reason}` : ''),
        en: 'The admins removed your post because it breaks the exchange rules.' + (reason ? `\nReason: ${reason}` : ''),
      },
    }).catch((err) => logger.warn({ err }, 'failed to notify listing owner of removal'));
  }
  return { listing: summary(listing) };
}

export async function deleteListingByUser(user: HydratedDocument<IUser>, adminRole: string | null, id: string) {
  await assertAllowed(adminRole);
  return removeListing(id, { telegramId: user.telegramId, username: user.username, isAdmin: adminRole !== null });
}

export async function setListingPinned(listingId: string, pinned: boolean, actor: { telegramId: number; username?: string | null }) {
  const listing = await ExchangeListing.findById(parseObjectId(listingId));
  if (!listing || listing.status !== 'active') throw new AppError(t('المنشور غير موجود', 'Post not found'), 404, 'NOT_FOUND');
  listing.pinned = pinned;
  listing.pinnedAt = pinned ? new Date() : null;
  await listing.save();
  await writeAudit({
    actorId: actor.telegramId,
    actorUsername: actor.username ?? undefined,
    action: pinned ? 'exchange.pin' : 'exchange.unpin',
    target: String(listing._id),
  });
  return { listing: summary(listing) };
}

/** Bans a listing's owner and takes down all of their exchange posts. */
export async function banListingOwner(listingId: string, actor: { telegramId: number; username?: string | null }) {
  const listing = await ExchangeListing.findById(parseObjectId(listingId));
  if (!listing) throw new AppError('المنشور غير موجود', 404, 'NOT_FOUND');
  const user = await banUser(String(listing.ownerTelegramId), actor.telegramId, actor.username ?? undefined, 'exchange: reported listing');
  const active = await ExchangeListing.find({ ownerTelegramId: listing.ownerTelegramId, status: 'active' });
  for (const l of active) {
    l.status = 'removed';
    l.pinned = false;
    l.removedAt = new Date();
    l.removedByTelegramId = actor.telegramId;
    await l.save();
    await ExchangeImage.deleteMany({ _id: { $in: l.images } });
  }
  return { telegramId: user.telegramId, username: user.username ?? null, removed: active.length };
}

let botRef: TelegramBot | null = null;
export function attachExchangeBot(bot: TelegramBot) {
  botRef = bot;
}

function person(p: { username?: string | null; firstName?: string | null; name?: string | null; telegramId: number }) {
  const name = p.username ? '@' + p.username : p.firstName || p.name || 'بدون اسم';
  return `${name}\nID: ${p.telegramId}\nالبروفايل: ${profileLink(p)}`;
}

export function reportButtons(listingId: string, reportId: string): TelegramBot.InlineKeyboardButton[][] {
  return [
    [
      { text: '🗑️ حذف المنشور', callback_data: `exr_rm_${listingId}` },
      { text: '📌 تثبيت', callback_data: `exr_pin_${listingId}` },
    ],
    [
      { text: '🚫 حظر صاحب المنشور', callback_data: `exr_ban_${listingId}` },
      { text: '✅ تمت المعالجة', callback_data: `exr_ok_${reportId}` },
    ],
  ];
}

export async function reportListing(
  user: HydratedDocument<IUser>,
  adminRole: string | null,
  listingId: string,
  input: { reason?: unknown; description?: unknown },
  files: UploadedFile[]
) {
  await assertAllowed(adminRole);
  const listing = await ExchangeListing.findById(parseObjectId(listingId));
  if (!listing || listing.status !== 'active') throw new AppError(t('هذا المنشور لم يعد موجوداً', 'This post no longer exists'), 404, 'NOT_FOUND');
  if (listing.ownerTelegramId === user.telegramId) throw new AppError(t('لا يمكنك الإبلاغ عن منشورك', "You can't report your own post"), 422, 'VALIDATION_ERROR');

  const reason = String(input.reason ?? '') as ReportReason;
  if (!REPORT_REASONS.includes(reason)) throw new AppError(t('اختر نوع البلاغ', 'Choose the report type'), 422, 'VALIDATION_ERROR');
  const description = String(input.description ?? '').trim();
  if (description.length < 5) throw new AppError(t('اكتب وصفاً للبلاغ', 'Write a description for the report'), 422, 'VALIDATION_ERROR');
  if (description.length > 1000) throw new AppError(t('الوصف طويل جداً (1000 حرف كحد أقصى)', 'The description is too long (1000 characters max)'), 422, 'VALIDATION_ERROR');

  const already = await ExchangeReport.exists({ listing: listing._id, reporterTelegramId: user.telegramId, status: 'open' });
  if (already) throw new AppError(t('أرسلت بلاغاً عن هذا المنشور مسبقاً، الإدارة تراجعه', 'You already reported this post; the admins are reviewing it'), 409, 'ALREADY_REPORTED');

  const report = await ExchangeReport.create({
    listing: listing._id,
    reporter: user._id,
    reporterTelegramId: user.telegramId,
    reason,
    description,
    mediaCount: files.length,
  });
  await ExchangeListing.updateOne({ _id: listing._id }, { $inc: { reportsCount: 1 } });

  await notifyAdminsOfReport(listing, report._id.toString(), { reason, description, reporter: user }, files).catch((err) =>
    logger.warn({ err, listingId }, 'failed to send exchange report to admins')
  );
  return { reportId: String(report._id) };
}

async function notifyAdminsOfReport(
  listing: IExchangeListing,
  reportId: string,
  r: { reason: ReportReason; description: string; reporter: IUser },
  files: UploadedFile[]
) {
  if (!botRef) return;
  const listingId = String(listing._id);
  const link = buildListingLink(listingId);
  const price = listing.price !== null ? `${listing.price} ${listing.currency ?? ''}` : '-';
  const text =
    `🚨 بلاغ جديد في قسم التبادل\n\n` +
    `نوع البلاغ: ${REASON_AR[r.reason]}\n\n` +
    `الوصف:\n${r.description}\n\n` +
    `━━━━━━━━━━\n` +
    `👤 المُبلِّغ:\n${person(r.reporter)}\n\n` +
    `🎯 صاحب المنشور:\n${person({ username: listing.ownerUsername, name: listing.ownerName, telegramId: listing.ownerTelegramId })}\n\n` +
    `━━━━━━━━━━\n` +
    `📄 المنشور #${listingId}\n` +
    `النوع: ${MODE_AR[listing.mode]} • السعر: ${price}\n` +
    `عدد البلاغات عليه: ${listing.reportsCount + 1}\n` +
    (link ? `🔗 رابط المنشور: ${link}\n` : '') +
    (files.length ? `\n📎 مرفقات البلاغ: ${files.length} (بالأسفل)` : '');

  const adminIds = await listAllAdminTelegramIds();
  await Promise.all(
    adminIds.map(async (id) => {
      try {
        const msg = await botRef!.sendMessage(id, text, {
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: reportButtons(listingId, reportId) },
        });
        for (const [i, f] of files.entries()) {
          const opts = { reply_to_message_id: msg.message_id, caption: `📎 ${i + 1}/${files.length}` };
          const fileOpts = { filename: f.originalname || `evidence-${i + 1}`, contentType: f.mimetype };
          if (f.mimetype.startsWith('video/')) await botRef!.sendVideo(id, f.buffer, opts, fileOpts);
          else await botRef!.sendPhoto(id, f.buffer, opts, fileOpts);
        }
      } catch (err) {
        logger.warn({ err, id }, 'failed to deliver exchange report to admin');
      }
    })
  );
}

export async function resolveReport(reportId: string, actor: { telegramId: number }) {
  if (!mongoose.isValidObjectId(reportId)) throw new AppError('البلاغ غير موجود', 404, 'NOT_FOUND');
  const report = await ExchangeReport.findByIdAndUpdate(
    reportId,
    { $set: { status: 'resolved', resolvedByTelegramId: actor.telegramId } },
    { new: true }
  );
  if (!report) throw new AppError('البلاغ غير موجود', 404, 'NOT_FOUND');
  return { id: String(report._id), status: report.status };
}

export async function listReports(status: 'open' | 'resolved' = 'open') {
  const reports = await ExchangeReport.find({ status }).sort({ createdAt: -1 }).limit(50).populate('listing').lean();
  const reporterIds = reports.map((r) => r.reporterTelegramId);
  const reporters = await User.find({ telegramId: { $in: reporterIds } }).select('telegramId username firstName').lean();
  const byId = new Map(reporters.map((u) => [u.telegramId, u]));
  return reports.map((r) => {
    const l = r.listing as unknown as IExchangeListing | null;
    const rep = byId.get(r.reporterTelegramId);
    return {
      id: String(r._id),
      reason: r.reason,
      reasonLabel: REASON_AR[r.reason],
      description: r.description,
      mediaCount: r.mediaCount,
      createdAt: r.createdAt,
      reporter: { telegramId: r.reporterTelegramId, username: rep?.username ?? null, name: rep?.firstName ?? null },
      listing: l
        ? {
            id: String(l._id),
            status: l.status,
            mode: l.mode,
            ownerTelegramId: l.ownerTelegramId,
            ownerUsername: l.ownerUsername ?? null,
            reportsCount: l.reportsCount,
          }
        : null,
    };
  });
}

export async function getExchangeAdminSettings() {
  const settings = await getSettings();
  const [active, pinned, openReports] = await Promise.all([
    ExchangeListing.countDocuments({ status: 'active' }),
    ExchangeListing.countDocuments({ status: 'active', pinned: true }),
    ExchangeReport.countDocuments({ status: 'open' }),
  ]);
  return {
    exchangePublic: settings.exchangePublic,
    exchangeMiddlemanGroup: settings.exchangeMiddlemanGroup,
    counts: { active, pinned, openReports },
  };
}

export async function updateExchangeAdminSettings(input: Record<string, unknown>) {
  const settings = await getSettings();
  if ('exchangePublic' in input) settings.exchangePublic = Boolean(input.exchangePublic);
  if ('exchangeMiddlemanGroup' in input) {
    const group = String(input.exchangeMiddlemanGroup ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
    if (!/^[A-Za-z0-9_]{4,64}$/.test(group)) throw new AppError('يوزر الكروب غير صالح', 422, 'VALIDATION_ERROR');
    settings.exchangeMiddlemanGroup = group;
  }
  await settings.save();
  return getExchangeAdminSettings();
}

export async function getExchangeImage(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return ExchangeImage.findById(id).select('data mimeType');
}
