import { Request, Response } from 'express';
import { requireAd } from '../services/games.service';
import { asyncHandler } from '../utils/asyncHandler';
import { claimDailyLogin, getDailyLoginStatus } from '../services/dailyLogin.service';

export const postDailyLogin = asyncHandler(async (req: Request, res: Response) => {
  // Prize days (5 and 7) need an ad watched to the end before they open.
  const status = await getDailyLoginStatus(req.telegramId!);
  if (status.canClaim && status.reward.adRequired) await requireAd(req.telegramId!, 'daily_prize');
  const result = await claimDailyLogin(req.telegramId!);
  res.json({ ok: true, result });
});

export const getDailyLogin = asyncHandler(async (req: Request, res: Response) => {
  const status = await getDailyLoginStatus(req.telegramId!);
  res.json({ ok: true, status });
});
