import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  buySize,
  buySkin,
  buyThrow,
  equipSkin,
  getBattleHome,
  getLeaderboard,
  getSharedLayout,
  saveLayout,
  saveSettings,
  shareLayout,
  throwAd,
} from '../services/battle.service';

const role = (req: Request) => req.adminRole ?? null;

export const getBattle = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getBattleHome(req.dbUser!, role(req))) });
});

export const postBattleBuySkin = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await buySkin(req.dbUser!, role(req), String(req.params.id))) });
});

export const postBattleEquipSkin = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await equipSkin(req.dbUser!, role(req), String(req.params.id))) });
});

export const putBattleSettings = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await saveSettings(req.dbUser!, role(req), req.body)) });
});

export const putBattleLayout = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await saveLayout(req.dbUser!, role(req), (req.body as { layout?: unknown })?.layout)) });
});

export const postBattleLayoutShare = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await shareLayout(req.dbUser!, role(req), (req.body ?? {}) as { layout?: unknown; image?: unknown })) });
});

export const getBattleLayoutCode = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getSharedLayout(role(req), String(req.params.code))) });
});

export const getBattleLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await getLeaderboard(req.dbUser!, role(req), String(req.query.type ?? 'mass'))) });
});

export const postBattleBuyThrow = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await buyThrow(req.dbUser!, role(req), Number(req.params.level))) });
});

export const postBattleThrowAd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await throwAd(req.dbUser!, role(req), Number(req.params.level))) });
});

export const postBattleBuySize = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, ...(await buySize(req.dbUser!, role(req), Number(req.params.index))) });
});
