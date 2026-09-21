import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { UserPrize } from '../models/UserPrize';
import { ClaimTask } from '../models/ClaimTask';
import { requestClaim } from '../services/withdrawal.service';
import { buildTaskLink } from '../services/claimTask.service';
import { prizeImageUrl } from '../services/prize.service';
import { getSettings } from '../models/Settings';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { getDeliveryContactLink } from '../services/deliveryAccount.service';

export const listMyInventory = asyncHandler(async (req: Request, res: Response) => {
  const items = await UserPrize.find({ telegramId: req.telegramId, status: { $ne: 'expired' } })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('prize', 'key icon hasImage');

  const claimableItemIds = items.filter((i) => i.source === 'wheel' || i.source === 'daily').map((i) => i._id);
  const tasks = await ClaimTask.find({ userPrize: { $in: claimableItemIds } });
  const taskByUserPrize = new Map(tasks.map((t) => [String(t.userPrize), t]));

  res.json({
    ok: true,
    items: items.map((i) => {
      const task = (i.source === 'wheel' || i.source === 'daily') ? taskByUserPrize.get(String(i._id)) : undefined;
      const prize = i.prize as unknown as { key?: string; icon?: string; hasImage?: boolean } | null;
      return {
        id: i._id,
        prizeName: i.prizeNameSnapshot,
        icon: prize?.icon ?? '🎁',
        imageUrl: prize?.key && prize.hasImage ? prizeImageUrl(prize.key, true) : null,
        source: i.source,
        wonAt: i.wonAt,
        expiresAt: i.expiresAt,
        status: i.status,
        task: task
          ? {
              link: buildTaskLink(task.token),
              requiredCount: task.requiredCount,
              creditedCount: task.creditedCount,
              status: task.status,
            }
          : null,
      };
    }),
  });
});

export const claimPrize = asyncHandler(async (req: Request, res: Response) => {
  const { userPrizeId } = req.body as { userPrizeId?: string };
  if (!userPrizeId) throw new AppError('userPrizeId is required', 422, 'VALIDATION_ERROR');

  let withdrawal;
  try {
    withdrawal = await requestClaim(req.telegramId!, userPrizeId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'DELIVERY_CONTACT_REQUIRED') {
      const deliveryContact = await getDeliveryContactLink();
      throw new AppError(
        deliveryContact.link
            ? `قبل الاستلام أضف حساب التسليم إلى جهات اتصالك: ${deliveryContact.link}، ثم اضغط تحقق.`
            : 'قبل الاستلام أضف حساب التسليم إلى جهات اتصالك، ثم اضغط تحقق.',
        409,
        'DELIVERY_CONTACT_REQUIRED'
      );
    }
    throw err;
  }
  res.json({ ok: true, withdrawal });
});

/**
 * Builds the "share your prize" card as a Telegram *prepared inline message* — a photo +
 * caption + inline button (or text + button if no image is configured). This is the Bot
 * API's purpose-built mechanism for exactly this use case: the client then calls
 * Telegram.WebApp.shareMessage(id) which opens Telegram's own native "choose chat(s) to
 * send to" picker, letting the user pick one or several chats in one action and send the
 * exact same rich card to each — nothing goes through the user's own DM with the bot first.
 *
 * (savePreparedInlineMessage is a newer Bot API method not yet wrapped by the
 * node-telegram-bot-api library, so this calls Telegram's HTTP API directly.)
 */
export const shareCard = asyncHandler(async (req: Request, res: Response) => {
  const { userPrizeId } = req.body as { userPrizeId?: string };
  if (!userPrizeId) throw new AppError('userPrizeId is required', 422, 'VALIDATION_ERROR');

  const userPrize = await UserPrize.findOne({ _id: userPrizeId, telegramId: req.telegramId });
  if (!userPrize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
  if (userPrize.source !== 'wheel') {
    throw new AppError('This prize has no referral link to share', 422, 'VALIDATION_ERROR');
  }

  const task = await ClaimTask.findOne({ userPrize: userPrize._id });
  if (!task) throw new AppError('No referral task found for this prize', 404, 'NOT_FOUND');

  const link = buildTaskLink(task.token);
  if (!link) throw new AppError('BOT_USERNAME is not configured on the server', 500, 'CONFIG_ERROR');

  const caption =
    `🎉 ربحت ${userPrize.prizeNameSnapshot} من بوت روليت MF\n\n` +
    `سارع في الحصول على جائزتك قبل أن تذهب، الجوائز محدودة ⏳\n\n` +
    `رابط البوت: ${link}`;

  const replyMarkup = { inline_keyboard: [[{ text: '🚀 ابدأ الربح الآن', url: link }]] };
  const settings = await getSettings();

  // Resolve the photo URL (if any) up front — a config problem here is distinct from an
  // actual Telegram API failure and deserves its own clear error, not the generic one.
  let photoUrl: string | null = null;
  if (settings.hasShareImage) {
    if (!env.MINI_APP_URL) {
      throw new AppError('MINI_APP_URL يجب أن يكون معبّى بالسيرفر عشان يرسل صور المشاركة', 500, 'CONFIG_ERROR');
    }
    photoUrl = `${env.MINI_APP_URL.replace(/\/$/, '')}/api/settings/share-image`;
  }

  const result: Record<string, unknown> = photoUrl
    ? {
        type: 'photo',
        id: '1',
        photo_url: photoUrl,
        thumbnail_url: photoUrl,
        caption,
        reply_markup: replyMarkup,
      }
    : {
        type: 'article',
        id: '1',
        title: `ربحت ${userPrize.prizeNameSnapshot} 🎉`,
        input_message_content: { message_text: caption },
        reply_markup: replyMarkup,
      };

  let preparedMessageId: string;
  try {
    const apiRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: req.telegramId,
        result,
        allow_user_chats: true,
        allow_group_chats: true,
        allow_channel_chats: false,
        allow_bot_chats: false,
      }),
    });
    const data = (await apiRes.json()) as { ok: boolean; result?: { id: string }; description?: string };
    if (!data.ok || !data.result) {
      throw new Error(data.description || 'savePreparedInlineMessage failed');
    }
    preparedMessageId = data.result.id;
  } catch (err) {
    logger.error({ err, telegramId: req.telegramId }, 'failed to prepare share card');
    throw new AppError('تعذر تجهيز بطاقة المشاركة، حاول مرة ثانية', 502, 'SEND_FAILED');
  }

  res.json({ ok: true, preparedMessageId });
});
