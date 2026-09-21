import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { claimDailyLogin } from '../services/dailyLogin.service';

export const postDailyLogin = asyncHandler(async (req: Request, res: Response) => {
  const result = await claimDailyLogin(req.telegramId!);
  res.json({ ok: true, result });
});