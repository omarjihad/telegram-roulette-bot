import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { addDeveloper, removeDeveloper, removeAllDevelopers, listDevelopers } from '../services/admin.service';
import { findUserByLookup, resolveUserLookup } from '../services/user.service';
import { AppError } from '../utils/AppError';
import { writeAudit } from '../models/AuditLog';
import { env } from '../config/env';

export const adminListDevelopers = asyncHandler(async (req: Request, res: Response) => {
  const devs = await listDevelopers();
  // The Owner is a config value (OWNER_ID), never a row in the Admin collection — surface it
  // here too so the admin list actually shows everyone, owner included.
  const ownerAlreadyListed = devs.some((d) => d.telegramId === env.OWNER_ID);
  const owner = ownerAlreadyListed
    ? []
    : [{ telegramId: env.OWNER_ID, username: undefined, role: 'owner' as const, createdAt: null }];

  res.json({ ok: true, developers: [...owner, ...devs] });
});

export const adminAddDeveloper = asyncHandler(async (req: Request, res: Response) => {
  const { lookup } = req.body as { lookup?: string };
  if (!lookup) throw new AppError('lookup is required', 422, 'VALIDATION_ERROR');

  const { byTelegramId, byUsername } = resolveUserLookup(lookup);
  let telegramId = byTelegramId;
  let username = byUsername;

  if (telegramId === undefined && byUsername) {
    const user = await findUserByLookup(lookup);
    if (!user) throw new AppError('User must have started the bot at least once', 404, 'USER_NOT_FOUND');
    telegramId = user.telegramId;
    username = user.username;
  }
  if (telegramId === undefined) throw new AppError('Could not resolve target user', 422, 'VALIDATION_ERROR');

  const dev = await addDeveloper(telegramId, username, req.telegramId!);
  await writeAudit({ actorId: req.telegramId!, actorUsername: req.dbUser!.username, action: 'developer.add', target: String(telegramId) });
  res.json({ ok: true, developer: dev });
});

export const adminRemoveDeveloper = asyncHandler(async (req: Request, res: Response) => {
  const telegramId = Number(req.params.telegramId);
  await removeDeveloper(telegramId, req.telegramId!);
  await writeAudit({ actorId: req.telegramId!, actorUsername: req.dbUser!.username, action: 'developer.remove', target: String(telegramId) });
  res.json({ ok: true });
});

export const adminRemoveAllDevelopers = asyncHandler(async (req: Request, res: Response) => {
  await removeAllDevelopers(req.telegramId!);
  await writeAudit({ actorId: req.telegramId!, actorUsername: req.dbUser!.username, action: 'developer.remove_all' });
  res.json({ ok: true });
});
