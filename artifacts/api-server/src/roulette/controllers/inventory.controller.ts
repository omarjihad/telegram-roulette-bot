import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { UserPrize } from '../models/UserPrize';
import { ClaimTask } from '../models/ClaimTask';
import { requestClaim } from '../services/withdrawal.service';
import {
  assertCanShare,
  buildTaskLink,
  CLAIM_SHARES_REQUIRED,
  completeClaimAdStep,
  confirmShareSent,
  currentStep,
  rememberSharePrepared,
  shareCount,
} from '../services/claimTask.service';
import { nanoid } from 'nanoid';
import { prepareShareCard } from '../services/shareCard.service';
import { prizeImageUrl } from '../services/prize.service';
import { getSettings } from '../models/Settings';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { getDeliveryContactLink } from '../services/deliveryAccount.service';
import { t } from '../i18n';

export const listMyInventory = asyncHandler(async (req: Request, res: Response) => {
  const items = await UserPrize.find({ telegramId: req.telegramId, status: { $ne: 'expired' } })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('prize', 'key icon hasImage');

  const claimableItemIds = items.filter((i) => i.source === 'wheel' || i.source === 'daily').map((i) => i._id);
  const tasks = await ClaimTask.find({ userPrize: { $in: claimableItemIds } });
  const taskByUserPrize = new Map(tasks.map((t) => [String(t.userPrize), t]));
  const settings = await getSettings();

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
              // Step-by-step claim: 1 ad, 2 share with friends, 3 invites (4 = all done).
              steps: task.steps,
              step: currentStep(task),
              adDone: Boolean(task.adWatchedAt),
              shares: shareCount(task),
              sharesRequired: task.shareRequired ?? CLAIM_SHARES_REQUIRED,
              adBlockId: settings.adsgramBlockId,
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
            ? t(`قبل الاستلام أضف حساب التسليم إلى جهات اتصالك: ${deliveryContact.link}، ثم اضغط تحقق.`, `Before claiming, add the delivery account to your contacts: ${deliveryContact.link}, then tap verify.`)
            : t('قبل الاستلام أضف حساب التسليم إلى جهات اتصالك، ثم اضغط تحقق.', 'Before claiming, add the delivery account to your contacts, then tap verify.'),
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
  if (userPrize.source !== 'wheel' && userPrize.source !== 'daily') {
    throw new AppError('This prize has no referral link to share', 422, 'VALIDATION_ERROR');
  }

  // Sharing is step 2: it opens after the ad (step 1).
  const task = await assertCanShare(req.telegramId!, userPrizeId);
  // Each share window gets its own id, so Telegram's report of where it was sent
  // (chosen_inline_result "cs_<token>_<nonce>") can be matched back to this task.
  const resultId = `cs_${task.token}_${nanoid(8)}`;

  const link = buildTaskLink(task.token);
  if (!link) throw new AppError('BOT_USERNAME is not configured on the server', 500, 'CONFIG_ERROR');

  const caption =
    t(
      `🎉 ربحت ${userPrize.prizeNameSnapshot} من بوت روليت MF\n\nسارع في الحصول على جائزتك قبل أن تذهب، الجوائز محدودة ⏳\n\nرابط البوت: ${link}`,
      `🎉 I won ${userPrize.prizeNameSnapshot} on the MF Roulette bot\n\nGrab your prize before it’s gone — prizes are limited ⏳\n\nBot link: ${link}`
    );

  let preparedMessageId: string;
  try {
    preparedMessageId = await prepareShareCard({
      userId: req.telegramId!,
      resultId,
      title: t(`ربحت ${userPrize.prizeNameSnapshot} 🎉`, `I won ${userPrize.prizeNameSnapshot} 🎉`),
      caption,
      buttonText: t('🚀 ابدأ الربح الآن', '🚀 Start winning now'),
      link,
    });
    await rememberSharePrepared(task._id as never, preparedMessageId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, telegramId: req.telegramId }, 'failed to prepare share card');
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 120);
    throw new AppError(
      t(`تعذر تجهيز بطاقة المشاركة، حاول مرة ثانية (${reason})`, `Could not prepare the share card, please try again (${reason})`),
      502,
      'SHARE_PREP_FAILED'
    );
  }

  res.json({ ok: true, preparedMessageId });
});

/** Step 1 of claiming: an ad watched to the end. */
export const postClaimAdStep = asyncHandler(async (req: Request, res: Response) => {
  const { userPrizeId } = req.body as { userPrizeId?: string };
  res.json({ ok: true, ...(await completeClaimAdStep(req.telegramId!, String(userPrizeId ?? ''))) });
});

/** Step 2: Telegram confirmed (in the Mini App) that the share window was sent. */
export const postClaimShareSent = asyncHandler(async (req: Request, res: Response) => {
  const { userPrizeId, preparedMessageId } = req.body as { userPrizeId?: string; preparedMessageId?: string };
  res.json({ ok: true, ...(await confirmShareSent(req.telegramId!, String(userPrizeId ?? ''), String(preparedMessageId ?? ''))) });
});
