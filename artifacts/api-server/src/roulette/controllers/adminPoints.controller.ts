import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { deductUserPoints } from '../services/adminPoints.service';

export const adminDeductUserPoints = asyncHandler(async (req: Request, res: Response) => {
  const { telegramId, amount } = req.body as { telegramId?: number | string; amount?: number | string };
  const parsedTelegramId = typeof telegramId === 'string' ? Number(telegramId.trim()) : telegramId;
  const parsedAmount = typeof amount === 'string' ? Number(amount.trim()) : amount;

  if (!Number.isFinite(parsedTelegramId) || !Number.isFinite(parsedAmount)) {
    throw new AppError('Telegram ID and points amount are required', 422, 'VALIDATION_ERROR');
  }

  const result = await deductUserPoints(
    parsedTelegramId!,
    parsedAmount!,
    req.telegramId!,
    req.dbUser!.username,
  );
  res.json({ ok: true, result });
});