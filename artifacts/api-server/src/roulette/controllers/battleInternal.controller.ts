import crypto from 'crypto';
import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { battleIdentityData, recordBattleMatchById, rewardBattleKill } from '../services/battle.service';
import { reportLeaders } from '../services/battleAdmin.service';

/**
 * Calls from the MF Battle game server on Cloudflare (not from players): it signs players
 * in, pays kill rewards and records finished lives here. Guarded by BATTLE_INTERNAL_KEY.
 */
function checkKey(req: Request) {
  const expected = env.BATTLE_INTERNAL_KEY;
  const got = String(req.header('X-Battle-Key') || '');
  if (!expected || expected.length < 24) throw new AppError('Battle game server is not set up', 404, 'NOT_FOUND');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new AppError('Forbidden', 403, 'FORBIDDEN');
}

const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError('Bad telegramId', 400, 'BAD_REQUEST');
  return n;
};

export const postInternalIdentity = asyncHandler(async (req: Request, res: Response) => {
  checkKey(req);
  res.json({ ok: true, data: await battleIdentityData(String(req.body?.initData || '')) });
});

export const postInternalKill = asyncHandler(async (req: Request, res: Response) => {
  checkKey(req);
  res.json({ ok: true, data: await rewardBattleKill(id(req.body?.telegramId), Number(req.body?.mass) || 0) });
});

export const postInternalRecord = asyncHandler(async (req: Request, res: Response) => {
  checkKey(req);
  await recordBattleMatchById(id(req.body?.telegramId), { mass: Number(req.body?.mass) || 0, seconds: Number(req.body?.seconds) || 0 });
  res.json({ ok: true, data: null });
});

/** Every few seconds: who led the room (for tournaments) and how many are playing. */
export const postInternalLeaders = asyncHandler(async (req: Request, res: Response) => {
  checkKey(req);
  res.json({ ok: true, data: await reportLeaders(req.body ?? {}) });
});
