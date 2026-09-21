import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { listUserNotifications, markNotificationsRead } from '../services/notification.service';

export const listMyNotifications = asyncHandler(async (req: Request, res: Response) => {
  const items = await listUserNotifications(req.telegramId!);
  res.json({ ok: true, items });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: string[] };
  await markNotificationsRead(req.telegramId!, ids);
  res.json({ ok: true });
});
