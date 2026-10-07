import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  battleAdminHome,
  battleBroadcast,
  cancelTournament,
  endTournamentNow,
  grantPlayer,
  lookupPlayer,
  setBattlePublic,
  startTournament,
} from '../services/battleAdmin.service';

// MF Battle developer panel (inside the game's lobby). Routes are behind requireAdmin.
const actor = (req: Request) => ({ id: req.telegramId!, username: req.dbUser?.username ?? undefined });

export const getBattleAdmin = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ ok: true, ...(await battleAdminHome()) });
});

export const postBattleTournament = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await startTournament(req.body ?? {}, actor(req))) });
});

export const postBattleTournamentEnd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await endTournamentNow(actor(req))) });
});

export const postBattleTournamentCancel = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await cancelTournament(actor(req))) });
});

export const getBattlePlayer = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await lookupPlayer(req.query.user)) });
});

export const postBattleGrant = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await grantPlayer(req.body ?? {}, actor(req))) });
});

export const postBattleBroadcast = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await battleBroadcast(req.body ?? {}, actor(req))) });
});

export const postBattlePublic = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await setBattlePublic(req.body?.open === true, actor(req))) });
});
