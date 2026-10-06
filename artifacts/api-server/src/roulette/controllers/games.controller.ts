import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  claimAdTask,
  finishSnakeRound,
  getGamesAdminSettings,
  getGamesStatus,
  recordAdsgramReward,
  startSnakeRound,
  startZigguratRound,
  finishZigguratRound,
  updateGamesAdminSettings,
} from '../services/games.service';

export const getGames = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getGamesStatus(req.dbUser!, req.adminRole ?? null)) });
});

export const postAdTaskClaim = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await claimAdTask(req.dbUser!, req.adminRole ?? null)) });
});

export const postSnakeStart = asyncHandler(async (req: Request, res: Response) => {
  const mode = (req.body as { mode?: string }).mode;
  if (mode !== 'free' && mode !== 'ad') throw new AppError('mode must be free or ad', 422, 'VALIDATION_ERROR');
  res.json({ ok: true, ...(await startSnakeRound(req.dbUser!, req.adminRole ?? null, mode)) });
});

export const postSnakeFinish = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, food, died } = req.body as { sessionId?: string; food?: number; died?: boolean };
  res.json({ ok: true, ...(await finishSnakeRound(req.dbUser!, { sessionId: String(sessionId ?? ''), food: Number(food), died: Boolean(died) })) });
});

export const postZigguratStart = asyncHandler(async (req: Request, res: Response) => {
  const mode = (req.body as { mode?: string }).mode;
  if (mode !== 'free' && mode !== 'ad') throw new AppError('mode must be free or ad', 422, 'VALIDATION_ERROR');
  res.json({ ok: true, ...(await startZigguratRound(req.dbUser!, req.adminRole ?? null, mode)) });
});

export const postZigguratFinish = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, floors } = req.body as { sessionId?: string; floors?: number };
  res.json({ ok: true, ...(await finishZigguratRound(req.dbUser!, { sessionId: String(sessionId ?? ''), floors: Number(floors) })) });
});

/** Adsgram Reward URL, e.g. https://<domain>/api/adsgram/reward?userid=[userId]&key=<ADSGRAM_REWARD_KEY> */
export const getAdsgramReward = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  await recordAdsgramReward(String(q.key ?? ''), String(q.userid ?? q.userId ?? q.user ?? ''));
  res.json({ ok: true });
});

export const adminGetGames = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ ok: true, settings: await getGamesAdminSettings() });
});

export const adminUpdateGames = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, settings: await updateGamesAdminSettings((req.body ?? {}) as Record<string, unknown>) });
});
