import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { buildGiftLink, createGiftLink, listGiftLinks, revokeGiftLink } from '../services/giftLink.service';

export const adminListGiftLinks = asyncHandler(async (_req: Request, res: Response) => {
  const gifts = await listGiftLinks();
  res.json({
    ok: true,
    gifts: gifts.map((gift) => ({
      ...gift.toObject(),
      link: buildGiftLink(gift.token),
    })),
  });
});

export const adminCreateGiftLink = asyncHandler(async (req: Request, res: Response) => {
  const { rewardType, pointsAmount, prizeKey, expiresInHours, maxRedemptions } = req.body as {
    rewardType?: 'points' | 'daily_spin' | 'prize' | 'guaranteed_daily_prize';
    pointsAmount?: number;
    prizeKey?: string;
    expiresInHours?: number | null;
    maxRedemptions?: number;
  };
  if (!rewardType || !['points', 'daily_spin', 'prize', 'guaranteed_daily_prize'].includes(rewardType)) {
    throw new AppError('rewardType is invalid', 422, 'VALIDATION_ERROR');
  }
  const result = await createGiftLink({
    rewardType,
    pointsAmount,
    prizeKey,
    expiresInHours,
    maxRedemptions,
    createdByTelegramId: req.telegramId!,
  });
  res.json({ ok: true, gift: { ...result.gift.toObject(), link: result.link } });
});

export const adminRevokeGiftLink = asyncHandler(async (req: Request, res: Response) => {
  await revokeGiftLink(req.params.token);
  res.json({ ok: true });
});