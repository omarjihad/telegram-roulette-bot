import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { banUser, unbanUser, listBanned, unbanAll } from '../services/ban.service';
import { AppError } from '../utils/AppError';

export const adminBanUser = asyncHandler(async (req: Request, res: Response) => {
  const { lookup, reason } = req.body as { lookup?: string; reason?: string };
  if (!lookup) throw new AppError('lookup is required', 422, 'VALIDATION_ERROR');
  const user = await banUser(lookup, req.telegramId!, req.dbUser!.username, reason);
  res.json({ ok: true, user });
});

export const adminUnbanUser = asyncHandler(async (req: Request, res: Response) => {
  const { lookup } = req.body as { lookup?: string };
  if (!lookup) throw new AppError('lookup is required', 422, 'VALIDATION_ERROR');
  const user = await unbanUser(lookup, req.telegramId!, req.dbUser!.username);
  res.json({ ok: true, user });
});

export const adminListBanned = asyncHandler(async (req: Request, res: Response) => {
  const users = await listBanned();
  res.json({ ok: true, users });
});

export const adminUnbanAll = asyncHandler(async (req: Request, res: Response) => {
  await unbanAll(req.telegramId!, req.dbUser!.username);
  res.json({ ok: true });
});
